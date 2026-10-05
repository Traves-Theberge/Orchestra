// Package worktreejobs persists bounded, read-reconcilable Git workspace creation.
// It never creates a task, queues a worker, or submits an agent message.
package worktreejobs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

var ErrInvalid = errors.New("invalid workspace creation request")
var ErrConflict = errors.New("workspace creation identity conflicts with an existing request")
var ErrNotFound = errors.New("workspace creation request not found in this project")

type Request struct {
	RequestID      string `json:"request_id"`
	Name           string `json:"name"`
	Branch         string `json:"branch"`
	BaseRef        string `json:"base_ref"`
	Provider       string `json:"provider,omitempty"`
	RequestedModel string `json:"requested_model,omitempty"`
	TaskID         string `json:"task_id,omitempty"`
}

type Job struct {
	Request
	ProjectID string                 `json:"project_id"`
	Status    string                 `json:"status"`
	Phase     string                 `json:"phase"`
	Message   string                 `json:"message"`
	Path      string                 `json:"path,omitempty"`
	BaseSHA   string                 `json:"base_sha,omitempty"`
	Workspace *workspace.GitWorktree `json:"workspace,omitempty"`
	Root      string                 `json:"-"`
}

type Service struct {
	db           *db.DB
	root         string
	roots        []string
	mu           sync.Mutex
	slots        chan struct{}
	validateTask func(context.Context, string, string) error
}

func New(database *db.DB, root string, roots []string, validateTask func(context.Context, string, string) error) (*Service, error) {
	if database == nil {
		return nil, errors.New("workspace job storage unavailable")
	}
	_, err := database.Exec(`CREATE TABLE IF NOT EXISTS worktree_creation_jobs(request_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,digest TEXT NOT NULL,job TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
	if err != nil {
		return nil, err
	}
	// Interruptions are observations, not permission to replay Git effects.
	rows, err := database.Query(`SELECT job FROM worktree_creation_jobs WHERE status IN ('queued','preparing','checking_out')`)
	if err != nil {
		return nil, err
	}
	interrupted := []Job{}
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			rows.Close()
			return nil, err
		}
		job, err := decode(encoded)
		if err != nil {
			rows.Close()
			return nil, err
		}
		interrupted = append(interrupted, job)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	s := &Service{db: database, root: root, roots: append([]string(nil), roots...), slots: make(chan struct{}, 2), validateTask: validateTask}
	for _, job := range interrupted {
		job.Status = "unknown"
		job.Message = "Backend restarted during setup. Recheck this request; do not create it again."
		if err := s.save(job); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Service) Submit(ctx context.Context, projectID string, req Request) (Job, error) {
	identity, err := uuid.Parse(req.RequestID)
	if err != nil || identity == uuid.Nil || identity.String() != req.RequestID {
		return Job{}, ErrInvalid
	}
	if req.Name == "" || len(req.Name) > 128 || strings.TrimSpace(req.Name) != req.Name || req.Name == "." || req.Name == ".." || strings.ContainsAny(req.Name, "/\\<>:\"|?*\x00\r\n") || strings.HasSuffix(req.Name, ".") {
		return Job{}, ErrInvalid
	}
	if req.Branch == "" || len(req.Branch) > 256 || strings.HasPrefix(req.Branch, "-") || strings.TrimSpace(req.Branch) != req.Branch || req.BaseRef == "" || len(req.BaseRef) > 1024 || strings.HasPrefix(req.BaseRef, "-") || strings.ContainsAny(req.BaseRef, "\x00\r\n") || len(req.Provider) > 128 || len(req.RequestedModel) > 256 {
		return Job{}, ErrInvalid
	}
	args, _ := json.Marshal(req)
	hash := sha256.Sum256(args)
	digest := hex.EncodeToString(hash[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	var priorDigest, priorProject, encoded string
	err = s.db.QueryRowContext(ctx, `SELECT project_id,digest,job FROM worktree_creation_jobs WHERE request_id=?`, req.RequestID).Scan(&priorProject, &priorDigest, &encoded)
	if err == nil {
		if priorProject != projectID || priorDigest != digest {
			return Job{}, ErrConflict
		}
		// Replays observe the current receipt/workspace; they never replay Git.
		return s.Get(ctx, projectID, req.RequestID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Job{}, err
	}
	var pending int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM worktree_creation_jobs WHERE status IN ('queued','preparing','checking_out')`).Scan(&pending); err != nil {
		return Job{}, err
	}
	if pending >= 32 {
		return Job{}, fmt.Errorf("%w: workspace setup queue is full", ErrConflict)
	}
	project, err := s.db.GetProjectByID(ctx, projectID)
	if err != nil {
		return Job{}, ErrNotFound
	}
	if err := workspace.ValidateProjectPath(project.RootPath, s.roots); err != nil {
		return Job{}, fmt.Errorf("%w: registered project unavailable", ErrInvalid)
	}
	if req.TaskID != "" {
		if s.validateTask == nil {
			return Job{}, fmt.Errorf("%w: task linking unavailable", ErrInvalid)
		}
		if err := s.validateTask(ctx, projectID, req.TaskID); err != nil {
			return Job{}, fmt.Errorf("%w: %v", ErrInvalid, err)
		}
	}
	parent := s.root
	if parent == "" {
		parent = filepath.Join(project.RootPath, ".orchestra", "worktrees")
	}
	destination := filepath.Join(parent, projectID, req.Name)
	if !filepath.IsAbs(destination) || workspace.ValidateProjectPath(destination, s.roots) != nil {
		return Job{}, fmt.Errorf("%w: worktree destination is outside allowed roots", ErrInvalid)
	}
	job := Job{Request: req, ProjectID: projectID, Status: "queued", Phase: "queued", Message: "Workspace setup queued; no agent message will be sent.", Path: destination, Root: project.RootPath}
	// Store the original root separately inside the durable envelope.
	data, err := encode(job)
	if err != nil {
		return Job{}, err
	}
	if _, err = s.db.ExecContext(ctx, `INSERT INTO worktree_creation_jobs(request_id,project_id,digest,job,status) VALUES(?,?,?,?,?)`, req.RequestID, projectID, digest, data, job.Status); err != nil {
		return Job{}, err
	}
	go s.run(job)
	return job, nil
}

func encode(job Job) (string, error) {
	data, err := json.Marshal(struct {
		Job
		RegisteredRoot string `json:"registered_root"`
	}{job, job.Root})
	return string(data), err
}
func decode(encoded string) (Job, error) {
	var data struct {
		Job
		RegisteredRoot string `json:"registered_root"`
	}
	err := json.Unmarshal([]byte(encoded), &data)
	data.Job.Root = data.RegisteredRoot
	return data.Job, err
}
func (s *Service) save(job Job) error {
	encoded, err := encode(job)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE worktree_creation_jobs SET job=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND project_id=?`, encoded, job.Status, job.RequestID, job.ProjectID)
	return err
}

func (s *Service) Get(ctx context.Context, pid, rid string) (Job, error) {
	var encoded string
	if err := s.db.QueryRowContext(ctx, `SELECT job FROM worktree_creation_jobs WHERE project_id=? AND request_id=?`, pid, rid).Scan(&encoded); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Job{}, ErrNotFound
		}
		return Job{}, err
	}
	job, err := decode(encoded)
	if err != nil {
		return Job{}, err
	}
	if job.Status == "unknown" && job.Phase == "checking_out" {
		if row, err := s.observeCreated(ctx, job, true); err == nil {
			job.Status = "completed"
			job.Phase = "completed"
			job.Message = "Created workspace confirmed from its Git ownership lock."
			job.Workspace = &row
			if err := s.save(job); err != nil {
				return Job{}, err
			}
			s.unlock(job)
		}
	}
	if job.Status == "completed" && job.Workspace != nil {
		if row, err := workspace.ResolveGitWorktree(ctx, pid, job.Root, job.Workspace.ID, s.roots); err == nil {
			job.Workspace = &row
		} else {
			job.Workspace = nil
			job.Message = "Workspace was created but is currently unavailable. Refresh the Git registry before opening it."
		}
	}
	return job, nil
}

func command(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	data, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("Git operation failed: %w", err)
	}
	return strings.TrimSpace(string(data)), nil
}

func (s *Service) run(job Job) {
	s.slots <- struct{}{}
	defer func() { <-s.slots }()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	fail := func(status, message string) { job.Status = status; job.Message = message; _ = s.save(job) }
	job.Status = "preparing"
	job.Phase = "preparing"
	job.Message = "Validating destination, branch and base commit."
	if s.save(job) != nil {
		return
	}
	project, err := s.db.GetProjectByID(ctx, job.ProjectID)
	if err != nil || project.RootPath != job.Root {
		fail("failed", "Registered project changed during setup; no checkout was created.")
		return
	}
	if workspace.ValidateProjectPath(job.Root, s.roots) != nil || workspace.ValidateProjectPath(job.Path, s.roots) != nil {
		fail("failed", "Project or destination is no longer authorized.")
		return
	}
	if _, err := os.Lstat(job.Path); !os.IsNotExist(err) {
		fail("failed", "Destination already exists or cannot be inspected; it was not overwritten.")
		return
	}
	if _, err := command(ctx, job.Root, "check-ref-format", "refs/heads/"+job.Branch); err != nil {
		fail("failed", "Choose a valid new Git branch name.")
		return
	}
	if _, err := command(ctx, job.Root, "show-ref", "--verify", "refs/heads/"+job.Branch); err == nil {
		fail("failed", "Target branch already exists. Choose a new branch; existing checkouts were not changed.")
		return
	}
	base, err := command(ctx, job.Root, "rev-parse", "--verify", "--end-of-options", job.BaseRef+"^{commit}")
	if err != nil {
		fail("failed", "Base reference is unavailable; no checkout was created.")
		return
	}
	job.BaseSHA = base
	if err := os.MkdirAll(filepath.Dir(job.Path), 0700); err != nil {
		fail("failed", "Cannot prepare the owned worktree parent directory.")
		return
	}
	// Persist the irreversible-effect boundary before invoking Git. A restart
	// only observes its request-specific lock; it does not run worktree add again.
	job.Status = "checking_out"
	job.Phase = "checking_out"
	job.Message = "Creating the isolated Git checkout."
	if s.save(job) != nil {
		return
	}
	_, checkoutErr := command(ctx, job.Root, "-c", "core.hooksPath="+os.DevNull, "worktree", "add", "--lock", "--reason", "orchestra-create:"+job.RequestID, "-b", job.Branch, job.Path, job.BaseSHA)
	row, observeErr := s.observeCreated(ctx, job, true)
	if observeErr != nil {
		message := "Checkout outcome is unconfirmed. Destination retained; recheck this request before retrying."
		if checkoutErr != nil {
			message += " Git did not confirm completion."
		}
		fail("unknown", message)
		return
	}
	job.Status = "completed"
	job.Phase = "completed"
	job.Message = "Workspace created. Agent conversation and task execution have not been started."
	job.Workspace = &row
	if s.save(job) != nil {
		return
	}
	s.unlock(job)
}

func (s *Service) observeCreated(ctx context.Context, job Job, owned bool) (workspace.GitWorktree, error) {
	canonical, err := filepath.EvalSymlinks(job.Path)
	if err != nil {
		return workspace.GitWorktree{}, err
	}
	rows, err := workspace.ListProjectGitWorktrees(ctx, job.ProjectID, job.Root, s.roots)
	if err != nil {
		return workspace.GitWorktree{}, err
	}
	for _, row := range rows {
		if row.ID != workspace.IDForGitWorktree(job.ProjectID, canonical) {
			continue
		}
		if row.Branch != job.Branch || row.Head != job.BaseSHA || row.Prunable || (owned && row.LockReason != "orchestra-create:"+job.RequestID) {
			return workspace.GitWorktree{}, errors.New("workspace ownership or checkout identity unconfirmed")
		}
		status, err := command(ctx, row.Path, "status", "--porcelain", "--untracked-files=no")
		if err != nil || status != "" {
			return workspace.GitWorktree{}, errors.New("checkout materialization unconfirmed")
		}
		return row, nil
	}
	return workspace.GitWorktree{}, errors.New("created checkout not found")
}

func (s *Service) unlock(job Job) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, _ = command(ctx, job.Root, "worktree", "unlock", job.Path)
}
