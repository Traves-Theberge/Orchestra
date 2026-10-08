package checkpoint

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not found in PATH")
	}
}

func newWorktree(t *testing.T) string {
	t.Helper()
	requireGit(t)
	return t.TempDir()
}

func newStore(t *testing.T, cap int64) *Store {
	t.Helper()
	return NewStore(t.TempDir(), cap)
}

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// readAll returns rel path (slash form) -> content for every file and
// "dir/" -> "" for every directory under root, excluding root itself.
func readAll(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			out[rel+"/"] = ""
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[rel] = string(b)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func seed(t *testing.T, wt string) {
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, "dir/b.txt", "bravo")
}

func mutate(t *testing.T, wt string) {
	writeFile(t, wt, "a.txt", "alpha changed")
	if err := os.Remove(filepath.Join(wt, "dir", "b.txt")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "c.txt", "charlie")
	writeFile(t, wt, "dir/new/d.txt", "delta")
}

func TestSnapshotRestoreRoundTrip(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	seed(t, wt)
	before := readAll(t, wt)

	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Hash == "" || tr.Files != 2 || tr.Bytes != int64(len("alpha")+len("bravo")) || tr.Skipped != 0 {
		t.Fatalf("unexpected tree %+v", tr)
	}
	mutate(t, wt)
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 2 || res.Deleted != 2 || len(res.Failed) != 0 {
		t.Fatalf("unexpected result %+v", res)
	}
	if after := readAll(t, wt); !reflect.DeepEqual(before, after) {
		t.Fatalf("folder differs\nbefore=%v\nafter=%v", before, after)
	}
}

func TestDiffDescribesRestore(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	seed(t, wt)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	mutate(t, wt)
	got, err := s.Diff(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	want := []Change{
		{Path: "a.txt", Kind: ChangeModify},
		{Path: "c.txt", Kind: ChangeDelete},
		{Path: "dir/b.txt", Kind: ChangeCreate},
		{Path: "dir/new/d.txt", Kind: ChangeDelete},
	}
	if !sort.SliceIsSorted(got, func(i, j int) bool { return got[i].Path < got[j].Path }) {
		t.Fatalf("not sorted: %v", got)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	// Diff must not modify the folder.
	if b, _ := os.ReadFile(filepath.Join(wt, "a.txt")); string(b) != "alpha changed" {
		t.Fatal("Diff modified the folder")
	}
}

func TestIgnoredFilesAreNotTouched(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, ".gitignore", "node_modules/\n")
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, "node_modules/x", "ignored")
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "a.txt", "changed")
	writeFile(t, wt, "node_modules/x", "ignored but edited")
	changes, err := s.Diff(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Path != "a.txt" {
		t.Fatalf("unexpected changes %v", changes)
	}
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(wt, "node_modules", "x")); string(b) != "ignored but edited" {
		t.Fatalf("ignored file touched: %q", b)
	}
}

func TestFilesOverTheCapAreSkipped(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 100)
	ctx := context.Background()
	big := strings.Repeat("x", 200)
	writeFile(t, wt, "small.txt", "small")
	writeFile(t, wt, "big.bin", big)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Skipped != 1 || tr.Files != 1 {
		t.Fatalf("unexpected tree %+v", tr)
	}
	writeFile(t, wt, "small.txt", "changed")
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(wt, "big.bin")); string(b) != big {
		t.Fatal("big file was not preserved")
	}
	if b, _ := os.ReadFile(filepath.Join(wt, "small.txt")); string(b) != "small" {
		t.Fatal("small file not restored")
	}
}

func hashTree(t *testing.T, root string) map[string][32]byte {
	t.Helper()
	out := map[string][32]byte{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		if d.IsDir() {
			out[rel+"/"] = [32]byte{}
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[rel] = sha256.Sum256(b)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestProjectGitDirIsNeverTouched(t *testing.T) {
	wt := newWorktree(t)
	storeDir := t.TempDir()
	s := NewStore(storeDir, 0)
	ctx := context.Background()
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = wt
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	seed(t, wt)
	gitDir := filepath.Join(wt, ".git")
	before := hashTree(t, gitDir)

	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	mutate(t, wt)
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if after := hashTree(t, gitDir); !reflect.DeepEqual(before, after) {
		t.Fatal(".git directory changed")
	}
	if rel, err := filepath.Rel(wt, storeDir); err == nil && !strings.HasPrefix(rel, "..") {
		t.Fatalf("shadow store must live outside the worktree (rel=%q)", rel)
	}
	// The project .git must not appear inside snapshots either.
	changes, err := s.Diff(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatalf("unexpected changes %v", changes)
	}
}

func TestCRLFFilesAreByteIdentical(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	content := "line1\r\nline2\r\nmixed\n"
	writeFile(t, wt, "crlf.txt", content)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "crlf.txt", "other")
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(wt, "crlf.txt"))
	if !bytes.Equal(b, []byte(content)) {
		t.Fatalf("got %q", b)
	}
}

func TestSpacesAndUnicodeNames(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, "my dir/héllo wörld.txt", "one")
	writeFile(t, wt, "日本語/ファイル[x].txt", "two")
	before := readAll(t, wt)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Files != 2 {
		t.Fatalf("files=%d", tr.Files)
	}
	writeFile(t, wt, "my dir/héllo wörld.txt", "changed")
	_ = os.RemoveAll(filepath.Join(wt, "日本語"))
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if after := readAll(t, wt); !reflect.DeepEqual(before, after) {
		t.Fatalf("differs: %v vs %v", before, after)
	}
}

func TestRestoreReportsLockedFilePerFile(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, "locked.txt", "orig-locked")
	writeFile(t, wt, "free.txt", "orig-free")
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "locked.txt", "changed-locked")
	writeFile(t, wt, "free.txt", "changed-free")
	// Go opens files without FILE_SHARE_DELETE, so delete/replace fails.
	f, err := os.Open(filepath.Join(wt, "locked.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatalf("restore must not fail wholesale: %v", err)
	}
	if len(res.Failed) != 1 || res.Failed[0].Path != "locked.txt" || res.Failed[0].Reason == "" {
		t.Fatalf("unexpected failures %+v", res.Failed)
	}
	if res.Written != 1 {
		t.Fatalf("written=%d", res.Written)
	}
	if b, _ := os.ReadFile(filepath.Join(wt, "free.txt")); string(b) != "orig-free" {
		t.Fatalf("free.txt not restored: %q", b)
	}
}

func TestUnavailableWhenGitMissing(t *testing.T) {
	wt := t.TempDir()
	s := newStore(t, 0)
	t.Setenv("PATH", "")
	_, err := s.Snapshot(context.Background(), wt)
	if err == nil || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestRestoreIsIdempotent(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	seed(t, wt)
	before := readAll(t, wt)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	mutate(t, wt)
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 0 || res.Deleted != 0 || len(res.Failed) != 0 {
		t.Fatalf("second restore did work: %+v", res)
	}
	if after := readAll(t, wt); !reflect.DeepEqual(before, after) {
		t.Fatal("folder differs")
	}
}

func TestEmptyFolderSnapshot(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Hash == "" || tr.Files != 0 || tr.Bytes != 0 {
		t.Fatalf("unexpected %+v", tr)
	}
	seed(t, wt)
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if res.Deleted != 2 || res.Written != 0 {
		t.Fatalf("unexpected %+v", res)
	}
	if got := readAll(t, wt); len(got) != 0 {
		t.Fatalf("folder not empty: %v", got)
	}
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

func mustRead(t *testing.T, root, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

func TestRestoreDoesNotDeleteFilesThatWereIgnoredAtCheckpointTime(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	gi := ".env\nnode_modules/\n"
	writeFile(t, wt, ".gitignore", gi)
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, ".env", "SECRET=1\r\n")
	writeFile(t, wt, "node_modules/pkg/index.js", "module")
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	// An agent rewrites .gitignore so the ignored files become visible.
	writeFile(t, wt, ".gitignore", "")
	writeFile(t, wt, "a.txt", "changed")
	writeFile(t, wt, "new.txt", "new")
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, wt, ".env"); got != "SECRET=1\r\n" {
		t.Fatalf(".env changed: %q", got)
	}
	if got := mustRead(t, wt, "node_modules/pkg/index.js"); got != "module" {
		t.Fatalf("node_modules file changed: %q", got)
	}
	if got := mustRead(t, wt, ".gitignore"); got != gi {
		t.Fatalf(".gitignore not restored: %q", got)
	}
	if got := mustRead(t, wt, "a.txt"); got != "alpha" {
		t.Fatalf("a.txt not restored: %q", got)
	}
	if _, err := os.Stat(filepath.Join(wt, "new.txt")); !os.IsNotExist(err) {
		t.Fatal("new.txt should have been deleted")
	}
}

func TestRestoreDoesNotDeleteAFileThatShrankBelowTheCap(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 100)
	ctx := context.Background()
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, "data.bin", strings.Repeat("x", 200))
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "data.bin", "tiny")
	writeFile(t, wt, "a.txt", "changed")
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, wt, "data.bin"); got != "tiny" {
		t.Fatalf("data.bin was touched: %q", got)
	}
	if got := mustRead(t, wt, "a.txt"); got != "alpha" {
		t.Fatalf("a.txt = %q", got)
	}
}

func TestRestoreDoesNotDeleteANestedRepoThatLostItsGitDir(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, "sub/f.txt", "nested")
	gitIn(t, filepath.Join(wt, "sub"), "init", "-q")
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Files != 1 {
		t.Fatalf("nested repo should be excluded: %+v", tr)
	}
	if err := os.RemoveAll(filepath.Join(wt, "sub", ".git")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, "a.txt", "changed")
	if _, err := s.Restore(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, wt, "sub/f.txt"); got != "nested" {
		t.Fatalf("nested file lost: %q", got)
	}
	if got := mustRead(t, wt, "a.txt"); got != "alpha" {
		t.Fatalf("a.txt = %q", got)
	}
}

func TestDiffMatchesRestoreForProtectedAndIgnoredPaths(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 100)
	ctx := context.Background()
	writeFile(t, wt, ".gitignore", ".env\n")
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, ".env", "S=1")
	writeFile(t, wt, "big.bin", strings.Repeat("x", 200))
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, wt, ".gitignore", "")
	writeFile(t, wt, "big.bin", "tiny")
	writeFile(t, wt, "a.txt", "changed")
	writeFile(t, wt, "extra.txt", "extra")
	changes, err := s.Diff(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	want := []Change{
		{Path: ".gitignore", Kind: ChangeModify},
		{Path: "a.txt", Kind: ChangeModify},
		{Path: "extra.txt", Kind: ChangeDelete},
	}
	if !reflect.DeepEqual(changes, want) {
		t.Fatalf("got %v want %v", changes, want)
	}
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 2 || res.Deleted != 1 || len(res.Failed) != 0 {
		t.Fatalf("restore %+v does not match diff", res)
	}
	if mustRead(t, wt, ".env") != "S=1" || mustRead(t, wt, "big.bin") != "tiny" {
		t.Fatal("protected/ignored file touched")
	}
}

func TestInvalidTreeHashIsRejected(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	seed(t, wt)
	if _, err := s.Snapshot(ctx, wt); err != nil {
		t.Fatal(err)
	}
	gitIn(t, wt, "init", "-q") // gives a branch-like name nothing to do with the store
	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	blob, err := g.run(ctx, []byte("blob"), "hash-object", "-w", "--stdin")
	done()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "x")
	cases := []string{
		"", "-x", "--output=" + marker, "HEAD", "master", "refs/heads/master",
		strings.Repeat("a", 40), strings.TrimSpace(string(blob)), strings.Repeat("A", 40),
	}
	before := readAll(t, wt)
	for _, h := range cases {
		if _, err := s.Diff(ctx, wt, h); err == nil || errors.Is(err, ErrUnavailable) {
			t.Errorf("Diff(%q) err=%v", h, err)
		}
		if _, err := s.Restore(ctx, wt, h); err == nil || errors.Is(err, ErrUnavailable) {
			t.Errorf("Restore(%q) err=%v", h, err)
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("--output option was honoured")
	}
	if after := readAll(t, wt); !reflect.DeepEqual(before, after) {
		t.Fatal("folder changed")
	}
}

func TestShadowStoreInsideWorktreeIsRejected(t *testing.T) {
	requireGit(t)
	ctx := context.Background()
	hash := strings.Repeat("a", 40)
	wt := t.TempDir()
	s := NewStore(filepath.Join(wt, ".store"), 0)
	if _, err := s.Snapshot(ctx, wt); !errors.Is(err, ErrUnsafeStore) {
		t.Fatalf("Snapshot: %v", err)
	}
	if _, err := s.Diff(ctx, wt, hash); !errors.Is(err, ErrUnsafeStore) {
		t.Fatalf("Diff: %v", err)
	}
	if _, err := s.Restore(ctx, wt, hash); !errors.Is(err, ErrUnsafeStore) {
		t.Fatalf("Restore: %v", err)
	}
	// Worktree inside the store directory is rejected too.
	store := t.TempDir()
	inner := filepath.Join(store, "proj")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(store, 0).Snapshot(ctx, inner); !errors.Is(err, ErrUnsafeStore) {
		t.Fatalf("worktree in store: %v", err)
	}
}
