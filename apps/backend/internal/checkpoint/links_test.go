package checkpoint

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// makeDirLink creates a directory link at link pointing at target: a real
// junction (mklink /J) on Windows, a symlink elsewhere. Skips if impossible.
func makeDirLink(t *testing.T, link, target string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput()
		if err != nil {
			t.Skipf("cannot create junction: %v %s", err, out)
		}
		return
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
}

// listTree returns the paths recorded in a snapshot tree.
func listTree(t *testing.T, s *Store, wt, hash string) []string {
	t.Helper()
	g, done, err := s.open(context.Background(), wt)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	out, err := g.run(context.Background(), nil, "ls-tree", "-r", "-z", "--name-only", hash)
	if err != nil {
		t.Fatal(err)
	}
	return splitNul(out)
}

// countSpawns runs fn and returns how many git processes it started. A
// fallback from the long-lived check-ignore process fails the test.
func countSpawns(t *testing.T, fn func()) int {
	n := 0
	onGitSpawn = func([]string) { n++ }
	onIgnoreFallback = func(err error) {
		t.Errorf("long-lived check-ignore process died: %v", err)
	}
	defer func() { onGitSpawn, onIgnoreFallback = nil, nil }()
	fn()
	return n
}

func TestFindRuleFilesSpawnsOneGitProcessRegardless(t *testing.T) {
	for _, depth := range []int{1, maxVerboseComponents - 1, 30} {
		t.Run("depth"+strconv.Itoa(depth), func(t *testing.T) {
			wt := newWorktree(t)
			s := newStore(t, 0)
			ctx := context.Background()
			writeFile(t, wt, ".gitignore", "ignored/\n")
			var parts []string
			for i := 0; i < depth; i++ {
				parts = append(parts, "l"+strconv.Itoa(i))
				dir := strings.Join(parts, "/")
				writeFile(t, wt, dir+"/f.txt", "x")
				writeFile(t, wt, dir+"/ignored/g.txt", "x")
			}
			deepest := strings.Join(parts, "/") + "/.gitignore"
			writeFile(t, wt, deepest, "*.log\n")
			g, done, err := s.open(ctx, wt)
			if err != nil {
				t.Fatal(err)
			}
			defer done()
			var found []string
			n := countSpawns(t, func() {
				found, _, err = findRuleFiles(ctx, g)
			})
			if err != nil {
				t.Fatal(err)
			}
			// One long-lived process for every level up to maxVerboseComponents
			// path components; beyond that (git -v bug, see ignoreChecker) one
			// one-shot process per deeper level. Levels here check 1..depth+1
			// components.
			want := 1 + max(0, depth+1-maxVerboseComponents)
			if n != want {
				t.Fatalf("findRuleFiles started %d git processes at depth %d, want %d", n, depth, want)
			}
			sort.Strings(found)
			if len(found) != 2 || found[0] != ".gitignore" || found[1] != deepest {
				t.Fatalf("found %v", found)
			}
		})
	}
}

func TestPathspecLikeFolderNames(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows cannot create these names")
	}
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	names := []string{":(foo)", ":!x", ":^y", ":name"}
	writeFile(t, wt, ".gitignore", "name\n")
	for _, n := range names {
		writeFile(t, wt, n+"/a.txt", "orig "+n)
	}
	// Self-ignoring rules file, only reachable if ":name" is not read as "name".
	writeFile(t, wt, ":name/sub/.gitignore", "*\n")
	writeFile(t, wt, ":name/sub/x.tmp", "x")

	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	found, _, err := findRuleFiles(ctx, g)
	done()
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(found)
	if want := []string{".gitignore", ":name/sub/.gitignore"}; strings.Join(found, "|") != strings.Join(want, "|") {
		t.Fatalf("found %v, want %v", found, want)
	}

	before := readAll(t, wt)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range names {
		writeFile(t, wt, n+"/a.txt", "changed")
	}
	writeFile(t, wt, ":(foo)/new.txt", "new")
	if _, err := s.Diff(ctx, wt, tr.Hash); err != nil {
		t.Fatal(err)
	}
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Failed) != 0 {
		t.Fatalf("failed: %v", res.Failed)
	}
	after := readAll(t, wt)
	if strings.Join(sortedKeys(before), "|") != strings.Join(sortedKeys(after), "|") {
		t.Fatalf("folder differs\nbefore=%v\nafter=%v", before, after)
	}
	for k, v := range before {
		if after[k] != v {
			t.Fatalf("%s = %q, want %q", k, after[k], v)
		}
	}
}

func sortedKeys(m map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestSnapshotDoesNotFollowJunctionsOrSymlinks(t *testing.T) {
	wt := newWorktree(t)
	outside := t.TempDir()
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, outside, "secret.txt", "secret")
	writeFile(t, outside, "sub/deep.txt", "deep")
	writeFile(t, wt, "a.txt", "alpha")
	makeDirLink(t, filepath.Join(wt, "j"), outside)
	// A plain symlink to the outside folder too, where the OS allows it.
	_ = os.Symlink(outside, filepath.Join(wt, "s"))

	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range listTree(t, s, wt, tr.Hash) {
		if p == "j" || p == "s" || strings.HasPrefix(p, "j/") || strings.HasPrefix(p, "s/") {
			t.Fatalf("snapshot recorded %q behind a link", p)
		}
	}
	if tr.Files != 1 || tr.Bytes != int64(len("alpha")) {
		t.Fatalf("unexpected tree %+v", tr)
	}
	changes, err := s.Diff(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatalf("unexpected changes %v", changes)
	}
}

func hasFailure(res RestoreResult, path string) bool {
	for _, f := range res.Failed {
		if f.Path == path && strings.Contains(f.Reason, "link") {
			return true
		}
	}
	return false
}

func TestRestoreNeverWritesOrDeletesThroughALink(t *testing.T) {
	ctx := context.Background()

	t.Run("write", func(t *testing.T) {
		wt := newWorktree(t)
		outside := t.TempDir()
		s := newStore(t, 0)
		writeFile(t, wt, "a.txt", "alpha")
		writeFile(t, wt, "d/canary.txt", "snapshot")
		tr, err := s.Snapshot(ctx, wt)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.RemoveAll(filepath.Join(wt, "d")); err != nil {
			t.Fatal(err)
		}
		writeFile(t, outside, "canary.txt", "outside")
		makeDirLink(t, filepath.Join(wt, "d"), outside)
		changes, err := s.Diff(ctx, wt, tr.Hash)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range changes {
			if strings.HasPrefix(c.Path, "d/") {
				t.Fatalf("Diff lists %v behind a link", c)
			}
		}
		res, err := s.Restore(ctx, wt, tr.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if got := mustRead(t, outside, "canary.txt"); got != "outside" {
			t.Fatalf("canary overwritten through the link: %q", got)
		}
		if !hasFailure(res, "d/canary.txt") {
			t.Fatalf("expected d/canary.txt in Failed, got %+v", res)
		}
	})

	t.Run("delete", func(t *testing.T) {
		wt := newWorktree(t)
		outside := t.TempDir()
		s := newStore(t, 0)
		writeFile(t, wt, "a.txt", "alpha")
		tr, err := s.Snapshot(ctx, wt)
		if err != nil {
			t.Fatal(err)
		}
		writeFile(t, outside, "canary.txt", "outside")
		makeDirLink(t, filepath.Join(wt, "d"), outside)
		writeFile(t, wt, "b.txt", "new")
		changes, err := s.Diff(ctx, wt, tr.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if len(changes) != 1 || changes[0] != (Change{Path: "b.txt", Kind: ChangeDelete}) {
			t.Fatalf("unexpected changes %v", changes)
		}
		res, err := s.Restore(ctx, wt, tr.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if res.Deleted != 1 || len(res.Failed) != 0 {
			t.Fatalf("unexpected result %+v", res)
		}
		if got := mustRead(t, outside, "canary.txt"); got != "outside" {
			t.Fatalf("canary changed: %q", got)
		}
		if _, err := os.Lstat(filepath.Join(wt, "d")); err != nil {
			t.Fatalf("link removed: %v", err)
		}
	})

	t.Run("link replaces a file", func(t *testing.T) {
		wt := newWorktree(t)
		outside := t.TempDir()
		s := newStore(t, 0)
		writeFile(t, wt, "d", "was a file")
		tr, err := s.Snapshot(ctx, wt)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(filepath.Join(wt, "d")); err != nil {
			t.Fatal(err)
		}
		writeFile(t, outside, "canary.txt", "outside")
		makeDirLink(t, filepath.Join(wt, "d"), outside)
		res, err := s.Restore(ctx, wt, tr.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if got := mustRead(t, outside, "canary.txt"); got != "outside" {
			t.Fatalf("canary changed: %q", got)
		}
		if !hasFailure(res, "d") {
			t.Fatalf("expected d in Failed, got %+v", res)
		}
	})
}

func TestJunctionLoopDoesNotInflateSnapshot(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, "a.txt", "alpha")
	writeFile(t, wt, "d/b.txt", "bravo")
	makeDirLink(t, filepath.Join(wt, "d", "loop"), wt)
	tr, err := s.Snapshot(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Files != 2 {
		t.Fatalf("snapshot followed the loop: %+v %v", tr, listTree(t, s, wt, tr.Hash))
	}
	// git itself must not descend into the link either (no inflated listing).
	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	_, dirLinks, err := findRuleFiles(ctx, g)
	if err != nil {
		done()
		t.Fatal(err)
	}
	out, err := listOthers(ctx, g, dirLinks)
	done()
	if err != nil {
		t.Fatal(err)
	}
	if listed := splitNul(out); len(listed) != 2 {
		t.Fatalf("ls-files descended into the loop: %d entries, first %v", len(listed), listed[:min(len(listed), 5)])
	}
	res, err := s.Restore(ctx, wt, tr.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 0 || res.Deleted != 0 || len(res.Failed) != 0 {
		t.Fatalf("unexpected result %+v", res)
	}
}

func BenchmarkSnapshotDeepTree(b *testing.B) {
	if _, err := exec.LookPath("git"); err != nil {
		b.Skip("git not found")
	}
	wt := b.TempDir()
	must := func(err error) {
		if err != nil {
			b.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(wt, ".gitignore"), []byte("target/\n"), 0o644))
	dir := wt
	for i := 0; i < 17; i++ {
		dir = filepath.Join(dir, "l"+strconv.Itoa(i))
		must(os.MkdirAll(filepath.Join(dir, "target"), 0o755))
		for f := 0; f < 3; f++ {
			must(os.WriteFile(filepath.Join(dir, "f"+strconv.Itoa(f)+".java"), []byte("class X {}"), 0o644))
		}
		must(os.WriteFile(filepath.Join(dir, "target", "out.class"), []byte("x"), 0o644))
	}
	s := NewStore(b.TempDir(), 0)
	ctx := context.Background()
	if _, err := s.Snapshot(ctx, wt); err != nil {
		b.Fatal(err)
	}
	b.Run("snapshot", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := s.Snapshot(ctx, wt); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("findRuleFiles", func(b *testing.B) {
		g, done, err := s.open(ctx, wt)
		if err != nil {
			b.Fatal(err)
		}
		defer done()
		for i := 0; i < b.N; i++ {
			if _, _, err := findRuleFiles(ctx, g); err != nil {
				b.Fatal(err)
			}
		}
	})
}

// Runs on every OS: check-ignore does not need the paths to exist, so names
// Windows cannot create are still checked as literal paths.
func TestIgnoreCheckerTreatsPathsLiterally(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, ".gitignore", "name\n!keep.log\n*.log\n")
	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	chk, err := startIgnoreChecker(ctx, g)
	if err != nil {
		t.Fatal(err)
	}
	defer chk.close()
	paths := []string{":(foo)", ":!x", ":^y", ":name", "name", "a.log", "keep.log", "dir/name"}
	want := []bool{false, false, false, false, true, true, true, true}
	for round := 0; round < 3; round++ { // the same process answers every batch
		got, err := chk.check(paths)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("round %d: got %v, want %v", round, got, want)
		}
	}
}

// A batch far larger than the pipe buffers must not deadlock, and a cancelled
// context must stop the long-lived process instead of hanging.
func TestIgnoreCheckerLargeBatchAndCancel(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	writeFile(t, wt, ".gitignore", "*.tmp\n")
	g, done, err := s.open(context.Background(), wt)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	chk, err := startIgnoreChecker(ctx, g)
	if err != nil {
		t.Fatal(err)
	}
	defer chk.close()
	var paths []string
	for i := 0; i < 20000; i++ {
		ext := ".txt"
		if i%2 == 0 {
			ext = ".tmp"
		}
		paths = append(paths, "some/fairly/long/directory/name/file"+strconv.Itoa(i)+ext)
	}
	got, err := chk.check(paths)
	if err != nil {
		t.Fatal(err)
	}
	for i, ig := range got {
		if ig != (i%2 == 0) {
			t.Fatalf("path %d: ignored=%v", i, ig)
		}
	}
	cancel()
	if _, err := chk.check(paths); err == nil {
		t.Fatal("expected an error after cancellation")
	}
}

// A long-lived check-ignore process that dies is not trusted again: this and
// every later batch is answered exactly by one-shot checks.
func TestIgnoreCheckerFallsBackWhenTheProcessDies(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, ".gitignore", "*.tmp\n")
	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	chk, err := startIgnoreChecker(ctx, g)
	if err != nil {
		t.Fatal(err)
	}
	defer chk.close()
	paths := []string{"a.tmp", "b.txt", ":(foo).tmp"}
	want := []bool{true, false, true}
	for round := 0; round < 3; round++ {
		if round == 1 {
			if err := chk.p.cmd.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			// Windows Kill requests termination asynchronously. Reap the process
			// before sending the batch that must exercise the dead-process fallback.
			// Closing stdin also lets a Git for Windows launcher child exit.
			_ = chk.p.stdin.Close()
			if err := chk.p.cmd.Wait(); err == nil {
				t.Fatal("killed check-ignore process unexpectedly succeeded")
			}
		}
		got, err := chk.check(paths)
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("round %d: got %v, want %v", round, got, want)
		}
	}
	if !chk.fellBack || chk.p != nil {
		t.Fatalf("expected one-shot mode after the process died")
	}
}

// Paths deeper than maxVerboseComponents never reach the -v process (git
// prints garbage or crashes for them) and are still answered exactly.
func TestIgnoreCheckerDeepPaths(t *testing.T) {
	wt := newWorktree(t)
	s := newStore(t, 0)
	ctx := context.Background()
	writeFile(t, wt, ".gitignore", "*.tmp\nignored\n")
	g, done, err := s.open(ctx, wt)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	chk, err := startIgnoreChecker(ctx, g)
	if err != nil {
		t.Fatal(err)
	}
	defer chk.close()
	var paths []string
	var want []bool
	for d := 1; d <= 40; d++ {
		dir := strings.Repeat("d/", d-1)
		paths = append(paths, dir+"ignored", dir+"f.txt", dir+"x.tmp")
		want = append(want, true, false, true)
	}
	for round := 0; round < 2; round++ {
		got, err := chk.check(paths)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v", got)
		}
	}
	if chk.fellBack {
		t.Fatal("the long-lived process died")
	}
}
