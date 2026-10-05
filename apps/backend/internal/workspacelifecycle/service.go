// Package workspacelifecycle owns guarded, durable workspace removal requests.
package workspacelifecycle

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
	"regexp"
	"runtime"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

var (
	ErrInvalid   = errors.New("invalid workspace removal request")
	ErrConflict  = errors.New("workspace removal request identity conflicts with an existing request")
	ErrNotFound  = errors.New("workspace or removal receipt not found")
	ErrProtected = errors.New("registered or main worktree cannot be removed")
	ErrBusy      = errors.New("workspace is in use")
	ErrDirty     = errors.New("workspace contains changes or untracked files")
	ErrUnknown   = errors.New("workspace removal outcome is unknown; inspect the project worktree list before retrying")
)

type Receipt struct {
	RequestID   string `json:"request_id"`
	ProjectID   string `json:"project_id"`
	WorkspaceID string `json:"workspace_id"`
	Status      string `json:"status"`
	Path        string `json:"path,omitempty"`
	Branch      string `json:"branch,omitempty"`
	Head        string `json:"head,omitempty"`
	Message     string `json:"message,omitempty"`
}

type BusyCheck func(context.Context, string, workspace.GitWorktree) error

type Service struct {
	db    *db.DB
	roots []string
	mu    sync.Mutex
}

func New(database *db.DB, roots []string) (*Service, error) {
	if database == nil {
		return nil, errors.New("workspace removal storage unavailable")
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS worktree_removal_requests (
		request_id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		workspace_id TEXT NOT NULL,
		digest TEXT NOT NULL,
		receipt TEXT NOT NULL,
		status TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, err
	}
	// An interrupted Git effect is evidence of uncertainty, never permission to replay it.
	if _, err := database.Exec(`UPDATE worktree_removal_requests SET status='unknown', receipt=json_set(receipt,'$.status','unknown','$.message','Backend restarted during removal. Inspect the worktree list before retrying.'), updated_at=CURRENT_TIMESTAMP WHERE status='pending'`); err != nil {
		return nil, err
	}
	// SQLite enforces one unresolved removal per exact workspace even if two
	// backend processes race past their in-memory preflight simultaneously.
	if _, err := database.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_worktree_removal_active_scope
		ON worktree_removal_requests(project_id,workspace_id) WHERE status IN ('pending','unknown')`); err != nil {
		return nil, err
	}
	return &Service{db: database, roots: append([]string(nil), roots...)}, nil
}

func (s *Service) Remove(ctx context.Context, projectID, workspaceID, requestID string, busy BusyCheck) (Receipt, error) {
	if projectID == "" || workspaceID == "" || !validRequestID(requestID) {
		return Receipt{}, ErrInvalid
	}
	digest := digestRequest(projectID, workspaceID)
	s.mu.Lock()
	defer s.mu.Unlock()

	prior, err := s.receipt(ctx, requestID)
	if err == nil {
		var existingDigest string
		if queryErr := s.db.QueryRowContext(ctx, `SELECT digest FROM worktree_removal_requests WHERE request_id=?`, requestID).Scan(&existingDigest); queryErr != nil {
			return Receipt{}, queryErr
		}
		if prior.ProjectID != projectID || prior.WorkspaceID != workspaceID || existingDigest != digest {
			return Receipt{}, ErrConflict
		}
		if prior.Status == "pending" {
			prior.Status = "unknown"
			prior.Message = ErrUnknown.Error()
			_ = s.save(ctx, prior)
		}
		return prior, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, err
	}
	if unresolved, queryErr := s.unresolvedReceipt(ctx, projectID, workspaceID); queryErr != nil {
		return Receipt{}, queryErr
	} else if unresolved.RequestID != "" {
		return unresolved, nil
	}

	project, err := s.db.GetProjectByID(ctx, projectID)
	if err != nil {
		return Receipt{}, ErrNotFound
	}
	if err = workspace.ValidateProjectPath(project.RootPath, s.roots); err != nil {
		return Receipt{}, ErrNotFound
	}
	target, err := workspace.ResolveGitWorktree(ctx, project.ID, project.RootPath, workspaceID, s.roots)
	if err != nil {
		return Receipt{}, ErrNotFound
	}
	receipt := Receipt{RequestID: requestID, ProjectID: project.ID, WorkspaceID: workspaceID, Status: "pending", Path: target.Path, Branch: target.Branch, Head: target.Head}
	if err = s.insert(ctx, digest, receipt); err != nil {
		// A second backend may have won the partial unique index after the
		// preflight query. Return that request's durable identity for polling.
		if unresolved, queryErr := s.unresolvedReceipt(ctx, projectID, workspaceID); queryErr == nil && unresolved.RequestID != "" {
			return unresolved, nil
		}
		return Receipt{}, err
	}
	if target.Primary || target.IsMainWorktree {
		return s.finish(ctx, receipt, "rejected", ErrProtected.Error(), ErrProtected)
	}
	if target.Locked || target.Prunable {
		return s.finish(ctx, receipt, "rejected", "Locked or prunable worktrees cannot be removed.", ErrInvalid)
	}
	if busy != nil {
		if err = busy(ctx, project.ID, target); err != nil {
			return s.finish(ctx, receipt, "rejected", err.Error(), err)
		}
	}
	if err = assertClean(ctx, target.Path); err != nil {
		return s.finish(ctx, receipt, "rejected", err.Error(), err)
	}

	// Re-resolve project, workspace ID, and canonical path after persisting intent,
	// directly before the Git effect. Concurrent rebinding or replacement fails closed.
	freshProject, freshErr := s.db.GetProjectByID(ctx, projectID)
	if freshErr != nil {
		return s.finish(ctx, receipt, "rejected", "Registered project changed before removal.", ErrConflict)
	}
	fresh, resolveErr := workspace.ResolveGitWorktree(ctx, projectID, freshProject.RootPath, workspaceID, s.roots)
	if resolveErr != nil || !sameTarget(target, fresh) || canonicalPath(project.RootPath) != canonicalPath(freshProject.RootPath) {
		return s.finish(ctx, receipt, "rejected", "Workspace identity changed before removal.", ErrConflict)
	}
	if busy != nil {
		if err = busy(ctx, project.ID, fresh); err != nil {
			return s.finish(ctx, receipt, "rejected", err.Error(), err)
		}
	}
	effectProject, effectProjectErr := s.db.GetProjectByID(ctx, projectID)
	if effectProjectErr != nil {
		return s.finish(ctx, receipt, "rejected", "Registered project changed before removal.", ErrConflict)
	}
	effectTarget, effectResolveErr := workspace.ResolveGitWorktree(ctx, projectID, effectProject.RootPath, workspaceID, s.roots)
	if effectResolveErr != nil || !sameTarget(fresh, effectTarget) || canonicalPath(freshProject.RootPath) != canonicalPath(effectProject.RootPath) {
		return s.finish(ctx, receipt, "rejected", "Workspace identity changed before removal.", ErrConflict)
	}
	if effectTarget.Primary || effectTarget.IsMainWorktree {
		return s.finish(ctx, receipt, "rejected", ErrProtected.Error(), ErrProtected)
	}
	if effectTarget.Locked || effectTarget.Prunable {
		return s.finish(ctx, receipt, "rejected", "Locked or prunable worktrees cannot be removed.", ErrInvalid)
	}
	if err = assertClean(ctx, effectTarget.Path); err != nil {
		return s.finish(ctx, receipt, "rejected", err.Error(), err)
	}

	// A caller disconnect must not cancel an already accepted filesystem mutation.
	commandCtx := context.WithoutCancel(ctx)
	cmd := exec.CommandContext(commandCtx, "git", "worktree", "remove", "--", effectTarget.Path)
	cmd.Dir = effectProject.RootPath
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		return s.finish(ctx, receipt, "unknown", fmt.Sprintf("Git did not confirm removal: %s", strings.TrimSpace(string(output))), ErrUnknown)
	}
	remaining, listErr := workspace.ListProjectGitWorktrees(commandCtx, project.ID, effectProject.RootPath, s.roots)
	if listErr != nil {
		return s.finish(ctx, receipt, "unknown", "Git returned success, but the worktree registry could not be re-read.", ErrUnknown)
	}
	for _, row := range remaining {
		if row.ID == workspaceID || canonicalPath(row.Path) == canonicalPath(effectTarget.Path) {
			return s.finish(ctx, receipt, "unknown", "Git returned success, but the selected worktree is still registered.", ErrUnknown)
		}
	}
	return s.finish(ctx, receipt, "completed", "Checkout removed. Branch and chat history retained.", nil)
}

func (s *Service) Get(ctx context.Context, projectID, requestID string) (Receipt, error) {
	if projectID == "" || !validRequestID(requestID) {
		return Receipt{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, err := s.receipt(ctx, requestID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && v.ProjectID != projectID) {
		return Receipt{}, ErrNotFound
	}
	if err == nil && v.Status == "unknown" {
		v = s.reconcileUnknown(ctx, v)
	}
	return v, err
}

func (s *Service) reconcileUnknown(ctx context.Context, receipt Receipt) Receipt {
	project, err := s.db.GetProjectByID(ctx, receipt.ProjectID)
	if err != nil || workspace.ValidateProjectPath(project.RootPath, s.roots) != nil {
		return receipt
	}
	rows, err := workspace.ListProjectGitWorktrees(ctx, project.ID, project.RootPath, s.roots)
	if err != nil {
		return receipt
	}
	for _, row := range rows {
		if row.ID == receipt.WorkspaceID && canonicalPath(row.Path) == canonicalPath(receipt.Path) && row.Head == receipt.Head && row.Branch == receipt.Branch {
			if assertClean(ctx, row.Path) == nil {
				receipt.Status = "rejected"
				receipt.Message = "Checkout remains registered and clean. Review it before creating a new removal request."
				_ = s.save(ctx, receipt)
			}
			return receipt
		}
	}
	if _, err := os.Stat(receipt.Path); !errors.Is(err, os.ErrNotExist) {
		return receipt
	}
	if receipt.Branch != "" {
		if !validBranch(receipt.Branch) {
			return receipt
		}
		cmd := exec.CommandContext(ctx, "git", "rev-parse", "--verify", "refs/heads/"+receipt.Branch)
		cmd.Dir = project.RootPath
		head, runErr := cmd.Output()
		if runErr != nil || strings.TrimSpace(string(head)) != receipt.Head {
			return receipt
		}
	}
	receipt.Status = "completed"
	receipt.Message = "Checkout removal confirmed. Branch and chat history retained."
	_ = s.save(ctx, receipt)
	return receipt
}

func (s *Service) receipt(ctx context.Context, requestID string) (Receipt, error) {
	var raw string
	var v Receipt
	err := s.db.QueryRowContext(ctx, `SELECT receipt FROM worktree_removal_requests WHERE request_id=?`, requestID).Scan(&raw)
	if err != nil {
		return Receipt{}, err
	}
	if err = json.Unmarshal([]byte(raw), &v); err != nil {
		return Receipt{}, err
	}
	return v, nil
}

func (s *Service) unresolvedReceipt(ctx context.Context, projectID, workspaceID string) (Receipt, error) {
	var requestID string
	err := s.db.QueryRowContext(ctx, `SELECT request_id FROM worktree_removal_requests WHERE project_id=? AND workspace_id=? AND status IN ('pending','unknown') ORDER BY updated_at LIMIT 1`, projectID, workspaceID).Scan(&requestID)
	if errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, nil
	}
	if err != nil {
		return Receipt{}, err
	}
	return s.receipt(ctx, requestID)
}

func (s *Service) insert(ctx context.Context, digest string, receipt Receipt) error {
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO worktree_removal_requests(request_id,project_id,workspace_id,digest,receipt,status) VALUES(?,?,?,?,?,'pending')`, receipt.RequestID, receipt.ProjectID, receipt.WorkspaceID, digest, string(encoded))
	if err != nil {
		return err
	}
	return nil
}

func (s *Service) finish(ctx context.Context, receipt Receipt, status, message string, cause error) (Receipt, error) {
	receipt.Status = status
	receipt.Message = message
	if err := s.save(ctx, receipt); err != nil {
		return Receipt{RequestID: receipt.RequestID, ProjectID: receipt.ProjectID, WorkspaceID: receipt.WorkspaceID, Status: "unknown", Path: receipt.Path, Branch: receipt.Branch, Message: ErrUnknown.Error()}, ErrUnknown
	}
	return receipt, cause
}

func (s *Service) save(ctx context.Context, receipt Receipt) error {
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE worktree_removal_requests SET receipt=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND project_id=? AND workspace_id=?`, string(encoded), receipt.Status, receipt.RequestID, receipt.ProjectID, receipt.WorkspaceID)
	return err
}

func assertClean(ctx context.Context, path string) error {
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("%w: Git status could not be confirmed", ErrBusy)
	}
	if len(output) > 0 {
		return ErrDirty
	}
	return nil
}

func sameTarget(before, after workspace.GitWorktree) bool {
	return before.ID == after.ID && canonicalPath(before.Path) == canonicalPath(after.Path) && before.Head == after.Head && before.Branch == after.Branch && before.Primary == after.Primary && before.IsMainWorktree == after.IsMainWorktree && before.Locked == after.Locked && before.Prunable == after.Prunable
}

func canonicalPath(value string) string {
	path := filepath.Clean(value)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = filepath.Clean(resolved)
	}
	if runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

func validRequestID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed != uuid.Nil && parsed.String() == value
}

var branchPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

func validBranch(value string) bool {
	return value != "" && !strings.HasPrefix(value, "-") && branchPattern.MatchString(value) && !strings.Contains(value, "..") && !strings.Contains(value, "//") && !strings.HasSuffix(value, ".")
}

func digestRequest(projectID, workspaceID string) string {
	data, _ := json.Marshal(struct {
		Operation   string `json:"operation"`
		ProjectID   string `json:"project_id"`
		WorkspaceID string `json:"workspace_id"`
	}{"remove_worktree", projectID, workspaceID})
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
