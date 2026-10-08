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
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// ErrUnavailable means git is missing or the shadow store is unusable.
var ErrUnavailable = errors.New("checkpoint unavailable")

// ErrUnsafeStore means the shadow store and the worktree overlap, which would
// make snapshots include (and restores delete) the store's own objects.
var ErrUnsafeStore = errors.New("checkpoint store overlaps the worktree")

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

var treeHashRe = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

const protectedRefPrefix = "refs/orchestra/protected/"

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
	noLiteral               bool // check-ignore rejects GIT_LITERAL_PATHSPECS
}

// exec runs git and returns stdout, the exit code and stderr. A non-zero exit
// code is not an error; err is set only when git could not be run at all.
func (g gitRun) exec(ctx context.Context, stdin []byte, args ...string) ([]byte, int, string, error) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, -1, "", fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
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
	if g.noLiteral {
		env = append(env, "GIT_LITERAL_PATHSPECS=0")
	}
	cmd.Env = env
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, -1, "", ctx.Err()
		}
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return nil, -1, "", fmt.Errorf("%w: running git: %v", ErrUnavailable, err)
		}
		return stdout.Bytes(), ee.ExitCode(), strings.TrimSpace(stderr.String()), nil
	}
	return stdout.Bytes(), 0, "", nil
}

// run is exec that treats any non-zero exit as an error.
func (g gitRun) run(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	out, code, stderr, err := g.exec(ctx, stdin, args...)
	if err != nil {
		return nil, err
	}
	if code != 0 {
		return nil, fmt.Errorf("git %s: exit status %d: %s", args[0], code, stderr)
	}
	return out, nil
}

func samePathOrInside(child, parent string) bool {
	if runtime.GOOS == "windows" {
		child, parent = strings.ToLower(child), strings.ToLower(parent)
	}
	if child == parent {
		return true
	}
	return strings.HasPrefix(child, strings.TrimRight(parent, string(filepath.Separator))+string(filepath.Separator))
}

func resolve(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = filepath.Clean(p)
	}
	if r, err := filepath.EvalSymlinks(abs); err == nil {
		return r
	}
	return abs
}

// open validates the paths, prepares the shadow repo for worktree and returns
// a runner that uses a fresh private index (removed by the returned cleanup).
func (s *Store) open(ctx context.Context, worktree string) (gitRun, func(), error) {
	abs := resolve(worktree)
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		return gitRun{}, nil, fmt.Errorf("worktree %q is not a directory", worktree)
	}
	// The store dir may not exist yet; resolve it through its nearest parent.
	storeAbs := resolve(s.dir)
	if samePathOrInside(storeAbs, abs) || samePathOrInside(abs, storeAbs) {
		return gitRun{}, nil, fmt.Errorf("%w: store %q, worktree %q", ErrUnsafeStore, storeAbs, abs)
	}
	if _, err := exec.LookPath("git"); err != nil {
		return gitRun{}, nil, fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
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

// checkTree validates treeHash syntactically and confirms it names a tree
// object in the shadow store.
func checkTree(ctx context.Context, g gitRun, treeHash string) error {
	if !treeHashRe.MatchString(treeHash) {
		return fmt.Errorf("invalid tree hash %q", treeHash)
	}
	out, code, _, err := g.exec(ctx, nil, "cat-file", "-t", treeHash)
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("tree %s does not exist in the checkpoint store", treeHash)
	}
	if t := strings.TrimSpace(string(out)); t != "tree" {
		return fmt.Errorf("object %s is a %s, not a tree", treeHash, t)
	}
	return nil
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
// returns the tree plus the paths it excluded for reasons other than ignore
// rules (over-cap files, nested repository roots).
func (s *Store) snapshot(ctx context.Context, g gitRun) (Tree, []string, error) {
	out, err := g.run(ctx, nil, "ls-files", "-z", "--others", "--exclude-standard")
	if err != nil {
		return Tree{}, nil, err
	}
	var tree Tree
	var keep, protected []string
	for _, p := range splitNul(out) {
		if strings.HasSuffix(p, "/") {
			// Nested repository: protect its root so Restore never deletes it.
			if r := strings.TrimSuffix(p, "/"); r != "" && !isProjectGit(r) {
				protected = append(protected, r)
			}
			continue
		}
		if isProjectGit(p) {
			continue
		}
		st, err := os.Lstat(filepath.Join(g.worktree, filepath.FromSlash(p)))
		if err != nil || st.IsDir() {
			continue // vanished while listing
		}
		if s.maxFileBytes > 0 && st.Mode().IsRegular() && st.Size() > s.maxFileBytes {
			tree.Skipped++
			protected = append(protected, p)
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
			return Tree{}, nil, err
		}
	}
	h, err := g.run(ctx, nil, "write-tree")
	if err != nil {
		return Tree{}, nil, err
	}
	tree.Hash = strings.TrimSpace(string(h))
	return tree, protected, nil
}

// saveProtected stores the manifest of excluded paths for a tree.
func saveProtected(ctx context.Context, g gitRun, treeHash string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	sort.Strings(paths)
	out, err := g.run(ctx, joinNul(paths), "hash-object", "-w", "--stdin")
	if err != nil {
		return err
	}
	_, err = g.run(ctx, nil, "update-ref", protectedRefPrefix+treeHash, strings.TrimSpace(string(out)))
	return err
}

// loadProtected returns the manifest for a tree; a missing manifest means
// there are no protected paths.
func loadProtected(ctx context.Context, g gitRun, treeHash string) ([]string, error) {
	out, code, _, err := g.exec(ctx, nil, "rev-parse", "--verify", "-q", protectedRefPrefix+treeHash)
	if err != nil {
		return nil, err
	}
	if code != 0 {
		return nil, nil
	}
	blob, err := g.run(ctx, nil, "cat-file", "blob", strings.TrimSpace(string(out)))
	if err != nil {
		return nil, err
	}
	return splitNul(blob), nil
}

func isProtected(path string, protected []string) bool {
	for _, p := range protected {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}

// ignoredUnderTarget reports which paths the target tree's own .gitignore
// files (i.e. the ignore rules in force after a restore) would ignore.
func ignoredUnderTarget(ctx context.Context, g gitRun, treeHash string, paths []string) (map[string]bool, error) {
	ignored := map[string]bool{}
	if len(paths) == 0 {
		return ignored, nil
	}
	tmp, err := os.MkdirTemp("", "checkpoint-ignore-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	list, err := g.run(ctx, nil, "ls-tree", "-r", "-z", "--name-only", treeHash)
	if err != nil {
		return nil, err
	}
	for _, p := range splitNul(list) {
		if p != ".gitignore" && !strings.HasSuffix(p, "/.gitignore") {
			continue
		}
		content, err := g.run(ctx, nil, "cat-file", "blob", treeHash+":"+p)
		if err != nil {
			return nil, err
		}
		dst := filepath.Join(tmp, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(dst, content, 0o644); err != nil {
			return nil, err
		}
	}
	tg := gitRun{shadow: g.shadow, worktree: tmp, index: g.index, noLiteral: true}
	out, code, stderr, err := tg.exec(ctx, joinNul(paths), "check-ignore", "--no-index", "-z", "--stdin")
	if err != nil {
		return nil, err
	}
	if code != 0 && code != 1 { // 1 means nothing ignored
		return nil, fmt.Errorf("git check-ignore: exit status %d: %s", code, stderr)
	}
	for _, p := range splitNul(out) {
		ignored[p] = true
	}
	return ignored, nil
}

// Snapshot records the current state of worktree and returns its tree.
func (s *Store) Snapshot(ctx context.Context, worktree string) (Tree, error) {
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return Tree{}, err
	}
	defer done()
	tree, protected, err := s.snapshot(ctx, g)
	if err != nil {
		return Tree{}, err
	}
	if err := saveProtected(ctx, g, tree.Hash, protected); err != nil {
		return Tree{}, err
	}
	return tree, nil
}

// plan computes what Restore(treeHash) will do. Deletions of paths that were
// excluded at checkpoint time (protected manifest) or that are ignored under
// the restored ignore rules are dropped.
func (s *Store) plan(ctx context.Context, g gitRun, treeHash string) ([]Change, error) {
	if err := checkTree(ctx, g, treeHash); err != nil {
		return nil, err
	}
	cur, _, err := s.snapshot(ctx, g)
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
	protected, err := loadProtected(ctx, g, treeHash)
	if err != nil {
		return nil, err
	}
	parts := splitNul(out)
	var all []Change
	var delPaths []string
	for i := 0; i+1 < len(parts); i += 2 {
		var kind ChangeKind
		switch parts[i][0] {
		case 'A':
			kind = ChangeCreate
		case 'D':
			kind = ChangeDelete
			if !isProtected(parts[i+1], protected) {
				delPaths = append(delPaths, parts[i+1])
			}
		default:
			kind = ChangeModify
		}
		all = append(all, Change{Path: parts[i+1], Kind: kind})
	}
	ignored, err := ignoredUnderTarget(ctx, g, treeHash, delPaths)
	if err != nil {
		return nil, err
	}
	changes := make([]Change, 0, len(all))
	for _, c := range all {
		if c.Kind == ChangeDelete && (isProtected(c.Path, protected) || ignored[c.Path]) {
			continue
		}
		changes = append(changes, c)
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	return changes, nil
}

// Diff reports what Restore(treeHash) would do to the folder. It records no
// checkpoint and does not modify the folder.
func (s *Store) Diff(ctx context.Context, worktree, treeHash string) ([]Change, error) {
	if !treeHashRe.MatchString(treeHash) {
		return nil, fmt.Errorf("invalid tree hash %q", treeHash)
	}
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return nil, err
	}
	defer done()
	return s.plan(ctx, g, treeHash)
}

const batchSize = 200

func checkoutBatch(ctx context.Context, g gitRun, res *RestoreResult, paths []string) (failed []string, err error) {
	for start := 0; start < len(paths); start += batchSize {
		end := start + batchSize
		if end > len(paths) {
			end = len(paths)
		}
		batch := paths[start:end]
		if _, e := g.run(ctx, joinNul(batch), "checkout-index", "-f", "-z", "--stdin"); e == nil {
			res.Written += len(batch)
			continue
		} else if ctx.Err() != nil {
			return failed, ctx.Err()
		}
		for _, p := range batch {
			if _, e := g.run(ctx, joinNul([]string{p}), "checkout-index", "-f", "-z", "--stdin"); e != nil {
				if ctx.Err() != nil {
					return failed, ctx.Err()
				}
				failed = append(failed, p)
				continue
			}
			res.Written++
		}
	}
	return failed, nil
}

// Restore makes the folder equal to treeHash. Ignored paths and paths that
// were excluded when the checkpoint was taken (over-cap files, nested repos)
// are never deleted. Per-file problems are reported in RestoreResult.Failed.
func (s *Store) Restore(ctx context.Context, worktree, treeHash string) (RestoreResult, error) {
	res := RestoreResult{Failed: []FileFailure{}}
	if !treeHashRe.MatchString(treeHash) {
		return res, fmt.Errorf("invalid tree hash %q", treeHash)
	}
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return res, err
	}
	defer done()
	changes, err := s.plan(ctx, g, treeHash)
	if err != nil {
		return res, err
	}
	if len(changes) == 0 {
		return res, nil
	}
	if _, err := g.run(ctx, nil, "read-tree", treeHash); err != nil {
		return res, err
	}

	var writes, deletes []string
	for _, c := range changes {
		if c.Kind == ChangeDelete {
			deletes = append(deletes, c.Path)
		} else {
			writes = append(writes, c.Path)
		}
	}

	// Writes first (this brings back the target's .gitignore files); the
	// delete set was already filtered against those rules by plan.
	failedWrites, err := checkoutBatch(ctx, g, &res, writes)
	if err != nil {
		return res, err
	}

	var dirs []string
	for _, p := range deletes {
		full := filepath.Join(g.worktree, filepath.FromSlash(p))
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			res.Failed = append(res.Failed, FileFailure{Path: p, Reason: err.Error()})
			continue
		}
		res.Deleted++
		dirs = append(dirs, filepath.Dir(full))
	}
	pruneEmptyDirs(g.worktree, dirs)

	// A write can be blocked by a directory whose files were just deleted
	// (file/directory swap); retry those once.
	if len(failedWrites) > 0 {
		still, err := checkoutBatch(ctx, g, &res, failedWrites)
		if err != nil {
			return res, err
		}
		for _, p := range still {
			ok, reason, _ := g.checkoutReason(ctx, p)
			if ok {
				res.Written++
				continue
			}
			res.Failed = append(res.Failed, FileFailure{Path: p, Reason: reason})
		}
	}
	return res, nil
}

// checkoutReason re-runs a single checkout to capture git's error text.
func (g gitRun) checkoutReason(ctx context.Context, p string) (bool, string, error) {
	_, err := g.run(ctx, joinNul([]string{p}), "checkout-index", "-f", "-z", "--stdin")
	if err != nil {
		return false, err.Error(), err
	}
	return true, "", nil
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
