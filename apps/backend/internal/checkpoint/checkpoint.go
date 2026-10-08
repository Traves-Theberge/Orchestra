// Package checkpoint snapshots, diffs and restores a working folder using a
// private "shadow" git repository that lives outside the folder. The
// project's own .git directory is never read or written.
package checkpoint

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ErrUnavailable means git is missing or the shadow store is unusable.
var ErrUnavailable = errors.New("checkpoint unavailable")

// Tree describes a recorded snapshot of a folder.
type Tree struct {
	Hash    string `json:"hash"`
	Files   int    `json:"files"`
	Bytes   int64  `json:"bytes"`
	Skipped int    `json:"skipped"`
}

// ChangeKind is what Restore will do to the folder for a path.
type ChangeKind string

const (
	ChangeCreate ChangeKind = "create"
	ChangeModify ChangeKind = "modify"
	ChangeDelete ChangeKind = "delete"
)

// Change is one path Restore would touch. Path is slash-separated and
// relative to the worktree.
type Change struct {
	Path string     `json:"path"`
	Kind ChangeKind `json:"kind"`
}

// FileFailure is a path Restore could not fix.
type FileFailure struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// RestoreResult summarises a Restore call.
type RestoreResult struct {
	Written int           `json:"written"`
	Deleted int           `json:"deleted"`
	Failed  []FileFailure `json:"failed"`
}

// Store keeps shadow repositories, one per worktree, under dir.
type Store struct {
	dir          string
	maxFileBytes int64
}

// NewStore returns a Store. Files larger than maxFileBytes are excluded from
// snapshots (and left alone by Restore); maxFileBytes <= 0 means no cap.
func NewStore(dir string, maxFileBytes int64) *Store {
	return &Store{dir: dir, maxFileBytes: maxFileBytes}
}

var gitConfigArgs = []string{
	"-c", "core.autocrlf=false",
	"-c", "core.safecrlf=false",
	"-c", "core.filemode=false",
	"-c", "core.longpaths=true",
	"-c", "core.quotepath=false",
}

func (s *Store) shadowDir(worktree string) string {
	key := filepath.Clean(worktree)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	sum := sha256.Sum256([]byte(key))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:]))
}

type gitRun struct {
	shadow, worktree, index string
}

func (g gitRun) run(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
	}
	full := append(append([]string{}, gitConfigArgs...), args...)
	cmd := exec.CommandContext(ctx, gitPath, full...)
	cmd.Dir = g.worktree
	null := "/dev/null"
	if runtime.GOOS == "windows" {
		null = "NUL"
	}
	env := append(os.Environ(),
		"GIT_DIR="+g.shadow,
		"GIT_WORK_TREE="+g.worktree,
		"GIT_CONFIG_GLOBAL="+null,
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_LITERAL_PATHSPECS=1",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_AUTHOR_NAME=checkpoint", "GIT_AUTHOR_EMAIL=checkpoint@localhost",
		"GIT_COMMITTER_NAME=checkpoint", "GIT_COMMITTER_EMAIL=checkpoint@localhost",
	)
	if g.index != "" {
		env = append(env, "GIT_INDEX_FILE="+g.index)
	} else {
		env = append(env, "GIT_INDEX_FILE="+filepath.Join(g.shadow, "index"))
	}
	cmd.Env = env
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return nil, fmt.Errorf("%w: running git: %v", ErrUnavailable, err)
		}
		return nil, fmt.Errorf("git %s: %v: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

// open prepares the shadow repo for worktree and returns a runner that uses a
// fresh private index (removed by the returned cleanup).
func (s *Store) open(ctx context.Context, worktree string) (gitRun, func(), error) {
	if _, err := exec.LookPath("git"); err != nil {
		return gitRun{}, nil, fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
	}
	abs, err := filepath.Abs(worktree)
	if err != nil {
		return gitRun{}, nil, err
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		return gitRun{}, nil, fmt.Errorf("worktree %q is not a directory", worktree)
	}
	shadow := s.shadowDir(abs)
	g := gitRun{shadow: shadow, worktree: abs}
	if _, err := os.Stat(filepath.Join(shadow, "HEAD")); err != nil {
		if err := os.MkdirAll(shadow, 0o755); err != nil {
			return gitRun{}, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		if _, err := g.run(ctx, nil, "init", "-q"); err != nil {
			if errors.Is(err, ErrUnavailable) || ctx.Err() != nil {
				return gitRun{}, nil, err
			}
			return gitRun{}, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
	}
	f, err := os.CreateTemp(shadow, "index-*")
	if err != nil {
		return gitRun{}, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	name := f.Name()
	f.Close()
	os.Remove(name) // git wants a missing file, not an empty one
	g.index = name
	return g, func() { os.Remove(name); os.Remove(name + ".lock") }, nil
}

func splitNul(b []byte) []string {
	var out []string
	for _, p := range bytes.Split(b, []byte{0}) {
		if len(p) > 0 {
			out = append(out, string(p))
		}
	}
	return out
}

func joinNul(paths []string) []byte {
	var b bytes.Buffer
	for _, p := range paths {
		b.WriteString(p)
		b.WriteByte(0)
	}
	return b.Bytes()
}

func isProjectGit(p string) bool {
	return p == ".git" || strings.HasPrefix(p, ".git/")
}

// snapshot writes the current folder state into the shadow object store and
// returns the tree. It records nothing else.
func (s *Store) snapshot(ctx context.Context, g gitRun) (Tree, error) {
	out, err := g.run(ctx, nil, "ls-files", "-z", "--others", "--exclude-standard")
	if err != nil {
		return Tree{}, err
	}
	var tree Tree
	var keep []string
	for _, p := range splitNul(out) {
		if strings.HasSuffix(p, "/") || isProjectGit(p) {
			continue // nested repositories and the project's own .git
		}
		st, err := os.Lstat(filepath.Join(g.worktree, filepath.FromSlash(p)))
		if err != nil || st.IsDir() {
			continue // vanished while listing
		}
		if s.maxFileBytes > 0 && st.Mode().IsRegular() && st.Size() > s.maxFileBytes {
			tree.Skipped++
			continue
		}
		keep = append(keep, p)
		tree.Files++
		if st.Mode().IsRegular() {
			tree.Bytes += st.Size()
		}
	}
	if len(keep) > 0 {
		if _, err := g.run(ctx, joinNul(keep), "add", "-A", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"); err != nil {
			return Tree{}, err
		}
	}
	h, err := g.run(ctx, nil, "write-tree")
	if err != nil {
		return Tree{}, err
	}
	tree.Hash = strings.TrimSpace(string(h))
	return tree, nil
}

// Snapshot records the current state of worktree and returns its tree.
func (s *Store) Snapshot(ctx context.Context, worktree string) (Tree, error) {
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return Tree{}, err
	}
	defer done()
	return s.snapshot(ctx, g)
}

func (s *Store) diff(ctx context.Context, g gitRun, treeHash string) ([]Change, error) {
	cur, err := s.snapshot(ctx, g)
	if err != nil {
		return nil, err
	}
	if cur.Hash == treeHash {
		return nil, nil
	}
	// Direction cur -> target: what Restore has to do.
	out, err := g.run(ctx, nil, "diff-tree", "-r", "-z", "--no-renames", "--name-status", cur.Hash, treeHash)
	if err != nil {
		return nil, err
	}
	parts := splitNul(out)
	var changes []Change
	for i := 0; i+1 < len(parts); i += 2 {
		var kind ChangeKind
		switch parts[i][0] {
		case 'A':
			kind = ChangeCreate
		case 'D':
			kind = ChangeDelete
		default:
			kind = ChangeModify
		}
		changes = append(changes, Change{Path: parts[i+1], Kind: kind})
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	return changes, nil
}

// Diff reports what Restore(treeHash) would do to the folder. It records no
// checkpoint and does not modify the folder.
func (s *Store) Diff(ctx context.Context, worktree, treeHash string) ([]Change, error) {
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return nil, err
	}
	defer done()
	return s.diff(ctx, g, treeHash)
}

const batchSize = 200

// Restore makes the folder equal to treeHash (ignored and over-cap files are
// left alone). Per-file problems are reported in RestoreResult.Failed.
func (s *Store) Restore(ctx context.Context, worktree, treeHash string) (RestoreResult, error) {
	res := RestoreResult{Failed: []FileFailure{}}
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return res, err
	}
	defer done()
	changes, err := s.diff(ctx, g, treeHash)
	if err != nil {
		return res, err
	}
	if len(changes) == 0 {
		return res, nil
	}
	if _, err := g.run(ctx, nil, "read-tree", treeHash); err != nil {
		return res, err
	}

	// Deletions first so file/directory swaps can be written afterwards.
	var writes []string
	var dirs []string
	for _, c := range changes {
		if c.Kind != ChangeDelete {
			writes = append(writes, c.Path)
			continue
		}
		full := filepath.Join(g.worktree, filepath.FromSlash(c.Path))
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			res.Failed = append(res.Failed, FileFailure{Path: c.Path, Reason: err.Error()})
			continue
		}
		res.Deleted++
		dirs = append(dirs, filepath.Dir(full))
	}
	pruneEmptyDirs(g.worktree, dirs)

	for start := 0; start < len(writes); start += batchSize {
		end := start + batchSize
		if end > len(writes) {
			end = len(writes)
		}
		batch := writes[start:end]
		if _, err := g.run(ctx, joinNul(batch), "checkout-index", "-f", "-z", "--stdin"); err == nil {
			res.Written += len(batch)
			continue
		} else if ctx.Err() != nil {
			return res, ctx.Err()
		}
		for _, p := range batch {
			if _, err := g.run(ctx, joinNul([]string{p}), "checkout-index", "-f", "-z", "--stdin"); err != nil {
				if ctx.Err() != nil {
					return res, ctx.Err()
				}
				res.Failed = append(res.Failed, FileFailure{Path: p, Reason: err.Error()})
				continue
			}
			res.Written++
		}
	}
	return res, nil
}

// pruneEmptyDirs removes now-empty directories, walking up from each start
// directory but never removing root itself or anything outside it.
func pruneEmptyDirs(root string, starts []string) {
	seen := map[string]bool{}
	for _, d := range starts {
		for d != root && strings.HasPrefix(d, root+string(filepath.Separator)) && !seen[d] {
			seen[d] = true
			if os.Remove(d) != nil { // fails when not empty
				break
			}
			d = filepath.Dir(d)
		}
	}
}
