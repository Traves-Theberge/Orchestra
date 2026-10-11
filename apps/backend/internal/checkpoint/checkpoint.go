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

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
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
	// ChangeKeep is a path the checkpoint has but the folder holds a file
	// that no current snapshot records (ignored now, or now over the size
	// cap). Restore leaves it as is: overwriting it could not be undone.
	ChangeKeep ChangeKind = "keep"
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
}

// command builds a git command with the shadow-repo environment. extraEnv is
// appended last (later entries win).
func (g gitRun) command(ctx context.Context, extraEnv []string, args ...string) (*exec.Cmd, error) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
	}
	if onGitSpawn != nil {
		onGitSpawn(args)
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
	cmd.Env = append(env, extraEnv...)
	return cmd, nil
}

// exec runs git and returns stdout, the exit code and stderr. A non-zero exit
// code is not an error; err is set only when git could not be run at all.
func (g gitRun) exec(ctx context.Context, stdin []byte, args ...string) ([]byte, int, string, error) {
	return g.execEnv(ctx, nil, stdin, args...)
}

// execEnv is exec with extra environment entries.
func (g gitRun) execEnv(ctx context.Context, extraEnv []string, stdin []byte, args ...string) ([]byte, int, string, error) {
	cmd, err := g.command(ctx, extraEnv, args...)
	if err != nil {
		return nil, -1, "", err
	}
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
	if resolved, err := workspace.CanonicalPath(p); err == nil {
		return resolved
	}
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

// maxExcludeArgBytes bounds the size of -x arguments passed to ls-files;
// beyond it the patterns go through a temporary --exclude-from file.
const maxExcludeArgBytes = 16 << 10

// listOthers lists the worktree's non-ignored files, never descending into
// the given directory links (git would otherwise follow Windows junctions).
func listOthers(ctx context.Context, g gitRun, dirLinks []string) ([]byte, error) {
	args := []string{"ls-files", "-z", "--others", "--exclude-standard"}
	size := 0
	var pats []string
	for _, l := range dirLinks {
		p := excludePattern(l)
		pats = append(pats, p)
		size += len(p)
	}
	if size <= maxExcludeArgBytes {
		for _, p := range pats {
			args = append(args, "--exclude="+p)
		}
	} else {
		f, err := os.CreateTemp("", "checkpoint-exclude-*")
		if err != nil {
			return nil, err
		}
		defer os.Remove(f.Name())
		_, werr := f.WriteString(strings.Join(pats, "\n") + "\n")
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			return nil, werr
		}
		args = append(args, "--exclude-from="+f.Name())
	}
	return g.run(ctx, nil, args...)
}

// snapshot writes the current folder state into the shadow object store and
// returns the tree plus the paths it excluded for reasons other than ignore
// rules (over-cap files, nested repository roots). Nothing behind a symlink
// or junction is recorded.
func (s *Store) snapshot(ctx context.Context, g gitRun) (Tree, []string, map[string]bool, error) {
	found, dirLinks, err := findRuleFiles(ctx, g)
	if err != nil {
		return Tree{}, nil, nil, err
	}
	out, err := listOthers(ctx, g, dirLinks)
	if err != nil {
		return Tree{}, nil, nil, err
	}
	var tree Tree
	var keep, protected []string
	links := linkCache{}
	for _, p := range splitNul(out) {
		if strings.HasSuffix(p, "/") {
			// Nested repository: protect its root so Restore never deletes it.
			if r := strings.TrimSuffix(p, "/"); r != "" && !isProjectGit(r) {
				protected = append(protected, r)
			}
			continue
		}
		if isProjectGit(p) || links.blocked(g.worktree, p) != "" {
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
	// Self-ignoring rules files (e.g. .venv/.gitignore containing "*") carry
	// rules that Restore needs. Capture those in reachable (non-ignored)
	// directories; they are not counted in Files/Bytes. Restore never deletes
	// them (see plan).
	listed := map[string]bool{}
	for _, p := range keep {
		listed[p] = true
	}
	rules := map[string]bool{}
	for _, p := range found {
		if !listed[p] {
			rules[p] = true
			keep = append(keep, p)
		}
	}
	if len(keep) > 0 {
		if _, err := g.run(ctx, joinNul(keep), "add", "-A", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"); err != nil {
			return Tree{}, nil, nil, err
		}
	}
	h, err := g.run(ctx, nil, "write-tree")
	if err != nil {
		return Tree{}, nil, nil, err
	}
	tree.Hash = strings.TrimSpace(string(h))
	return tree, protected, rules, nil
}

// saveProtected stores the manifest of excluded paths for a tree.
func saveProtected(ctx context.Context, g gitRun, treeHash string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	old, err := loadProtected(ctx, g, treeHash)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, p := range paths {
		seen[p] = true
	}
	for _, p := range old {
		if !seen[p] {
			paths = append(paths, p)
		}
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
	chk, err := startIgnoreChecker(ctx, gitRun{shadow: g.shadow, worktree: tmp, index: g.index})
	if err != nil {
		return nil, err
	}
	defer chk.close()
	flags, err := chk.check(paths)
	if err != nil {
		return nil, err
	}
	for i, p := range paths {
		if flags[i] {
			ignored[p] = true
		}
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
	tree, protected, _, err := s.snapshot(ctx, g)
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
// the restored ignore rules are dropped. Paths that go through a symlink or
// junction (or are themselves a link to a directory) are returned separately
// as blocked: Restore reports them as failures and never touches them.
func (s *Store) plan(ctx context.Context, g gitRun, treeHash string) ([]Change, []FileFailure, error) {
	if err := checkTree(ctx, g, treeHash); err != nil {
		return nil, nil, err
	}
	cur, _, rules, err := s.snapshot(ctx, g)
	if err != nil {
		return nil, nil, err
	}
	if cur.Hash == treeHash {
		return nil, nil, nil
	}
	// Direction cur -> target: what Restore has to do.
	out, err := g.run(ctx, nil, "diff-tree", "-r", "-z", "--no-renames", "--name-status", cur.Hash, treeHash)
	if err != nil {
		return nil, nil, err
	}
	protected, err := loadProtected(ctx, g, treeHash)
	if err != nil {
		return nil, nil, err
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
			if !isProtected(parts[i+1], protected) && !rules[parts[i+1]] {
				delPaths = append(delPaths, parts[i+1])
			}
		default:
			kind = ChangeModify
		}
		all = append(all, Change{Path: parts[i+1], Kind: kind})
	}
	ignored, err := ignoredUnderTarget(ctx, g, treeHash, delPaths)
	if err != nil {
		return nil, nil, err
	}
	changes := make([]Change, 0, len(all))
	var blocked []FileFailure
	links := linkCache{}
	// Deletions that will run, case-folded: on a case-insensitive file system
	// a create may find the old-case file of a case-only rename on disk.
	deleting := map[string]bool{}
	for _, c := range all {
		if c.Kind == ChangeDelete && !isProtected(c.Path, protected) && !ignored[c.Path] && !rules[c.Path] {
			deleting[strings.ToLower(c.Path)] = true
		}
	}
	for _, c := range all {
		if c.Kind == ChangeDelete && (isProtected(c.Path, protected) || ignored[c.Path] || rules[c.Path]) {
			continue
		}
		if why := links.blocked(g.worktree, c.Path); why != "" {
			blocked = append(blocked, FileFailure{Path: c.Path, Reason: why})
			continue
		}
		// A create whose path already holds a file means the current snapshot
		// excluded it (ignored now, or now over the cap). No snapshot holds
		// that content, so overwriting it could not be undone: keep it.
		if c.Kind == ChangeCreate && !deleting[strings.ToLower(c.Path)] {
			if st, err := os.Lstat(filepath.Join(g.worktree, filepath.FromSlash(c.Path))); err == nil && !st.IsDir() {
				c.Kind = ChangeKeep
			}
		}
		changes = append(changes, c)
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	sort.Slice(blocked, func(i, j int) bool { return blocked[i].Path < blocked[j].Path })
	return changes, blocked, nil
}

// Diff reports what Restore(treeHash) would do to the folder. It records no
// checkpoint and does not modify the folder. Files Restore leaves as is
// because no snapshot holds them are listed as ChangeKeep. Paths Restore
// refuses to touch because they go through a symlink or junction are not
// listed.
func (s *Store) Diff(ctx context.Context, worktree, treeHash string) ([]Change, error) {
	if !treeHashRe.MatchString(treeHash) {
		return nil, fmt.Errorf("invalid tree hash %q", treeHash)
	}
	g, done, err := s.open(ctx, worktree)
	if err != nil {
		return nil, err
	}
	defer done()
	changes, _, err := s.plan(ctx, g, treeHash)
	return changes, err
}

const batchSize = 200

// checkoutBatch writes paths from the index into the worktree. Failures are
// attributed per file and appended to res.Failed.
func checkoutBatch(ctx context.Context, g gitRun, res *RestoreResult, paths []string) error {
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
			return ctx.Err()
		}
		for _, p := range batch {
			if _, e := g.run(ctx, joinNul([]string{p}), "checkout-index", "-f", "-z", "--stdin"); e != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				res.Failed = append(res.Failed, FileFailure{Path: p, Reason: e.Error()})
				continue
			}
			res.Written++
		}
	}
	return nil
}

// Restore makes the folder equal to treeHash. Ignored paths and paths that
// were excluded when the checkpoint was taken (over-cap files, nested repos)
// are never deleted. Per-file problems are reported in RestoreResult.Failed.
//
// Order: deletions first, then writes. Deleting first keeps case-only renames
// correct on case-insensitive file systems. A write whose target is still a
// non-empty directory (ignored or protected content remains inside) is
// reported in Failed instead of being passed to git, because checkout-index -f
// would wipe the whole directory.
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
	changes, blocked, err := s.plan(ctx, g, treeHash)
	if err != nil {
		return res, err
	}
	res.Failed = append(res.Failed, blocked...)
	if len(changes) == 0 {
		return res, nil
	}
	if _, err := g.run(ctx, nil, "read-tree", treeHash); err != nil {
		return res, err
	}

	var writes, deletes []string
	for _, c := range changes {
		if c.Kind == ChangeKeep {
			continue
		}
		if c.Kind == ChangeDelete {
			deletes = append(deletes, c.Path)
		} else {
			writes = append(writes, c.Path)
		}
	}

	// Re-check links right before touching anything, so a link created after
	// plan ran is still never followed.
	links := linkCache{}
	var dirs []string
	for _, p := range deletes {
		if why := links.blocked(g.worktree, p); why != "" {
			res.Failed = append(res.Failed, FileFailure{Path: p, Reason: why})
			continue
		}
		full := filepath.Join(g.worktree, filepath.FromSlash(p))
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
			res.Failed = append(res.Failed, FileFailure{Path: p, Reason: err.Error()})
			continue
		}
		res.Deleted++
		dirs = append(dirs, filepath.Dir(full))
	}
	pruneEmptyDirs(g.worktree, dirs)

	links = linkCache{} // deletions and pruning changed the folder
	safe := make([]string, 0, len(writes))
	for _, p := range writes {
		if why := links.blocked(g.worktree, p); why != "" {
			res.Failed = append(res.Failed, FileFailure{Path: p, Reason: why})
			continue
		}
		full := filepath.Join(g.worktree, filepath.FromSlash(p))
		if st, err := os.Lstat(full); err == nil && st.IsDir() {
			if entries, err := os.ReadDir(full); err != nil || len(entries) > 0 {
				res.Failed = append(res.Failed, FileFailure{Path: p, Reason: "a non-empty directory (holding ignored or protected files) is in the way"})
				continue
			}
			if err := os.Remove(full); err != nil {
				res.Failed = append(res.Failed, FileFailure{Path: p, Reason: err.Error()})
				continue
			}
		}
		safe = append(safe, p)
	}
	if err := checkoutBatch(ctx, g, &res, safe); err != nil {
		return res, err
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
			if fi, err := os.Lstat(d); err != nil || isLink(d, fi.Mode()) {
				break // never remove a link (or anything above it)
			}
			if os.Remove(d) != nil { // fails when not empty
				break
			}
			d = filepath.Dir(d)
		}
	}
}

// readDir is swapped in tests to prove ignored trees are never walked.
var readDir = os.ReadDir

// onGitSpawn, when set (tests only), is called with the arguments of every
// git process started.
var onGitSpawn func(args []string)

// findRuleFiles returns the .gitignore files in directories that are not
// themselves ignored by rules from their ancestors, plus the directory links
// (symlinks to directories, junctions) found in those directories. It walks
// level by level and prunes ignored directories, so ignored trees such as
// node_modules are never enumerated; links are never followed. Each level is
// checked in one batch by a single long-lived check-ignore process, so the
// whole walk starts at most one git process however deep the folder is.
func findRuleFiles(ctx context.Context, g gitRun) (found, dirLinks []string, err error) {
	var chk *ignoreChecker
	defer func() { chk.close() }()
	level := []string{""}
	for len(level) > 0 {
		var cands []string
		for _, dir := range level {
			entries, err := readDir(filepath.Join(g.worktree, filepath.FromSlash(dir)))
			if err != nil {
				continue // vanished or unreadable
			}
			for _, e := range entries {
				rel := e.Name()
				if dir != "" {
					rel = dir + "/" + e.Name()
				}
				full := filepath.Join(g.worktree, filepath.FromSlash(rel))
				switch {
				case e.Name() == ".git":
				case isLink(full, e.Type()):
					if isDirLink(full, e.Type()) {
						dirLinks = append(dirLinks, rel)
					}
				case e.IsDir():
					if _, err := os.Lstat(filepath.Join(full, ".git")); err != nil {
						cands = append(cands, rel) // not a nested repository
					}
				case e.Name() == ".gitignore" && e.Type().IsRegular():
					found = append(found, rel)
				}
			}
		}
		level = level[:0]
		if len(cands) == 0 {
			break
		}
		if chk == nil {
			if chk, err = startIgnoreChecker(ctx, g); err != nil {
				return nil, nil, err
			}
		}
		ignored, err := chk.check(cands)
		if err != nil {
			return nil, nil, err
		}
		for i, c := range cands {
			if !ignored[i] {
				level = append(level, c)
			}
		}
	}
	return found, dirLinks, nil
}
