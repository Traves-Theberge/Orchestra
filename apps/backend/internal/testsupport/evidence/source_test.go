package evidence_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/ade"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/evidence"
)

func sourceFixture(t *testing.T) (*ade.Fixture, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	f, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.Close(); err != nil {
			t.Error(err)
		}
	})
	return f, ctx
}

func TestFingerprintIgnoresAmbientGitOverridesAndGlobalConfig(t *testing.T) {
	f, ctx := sourceFixture(t)
	root := f.Manifest.Repository
	before, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "untracked.go"), []byte("package fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	wanted, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if before == wanted {
		t.Fatal("untracked source was not hashed")
	}
	global := filepath.Join(f.Manifest.Home, "ambient.gitconfig")
	ignore := filepath.Join(f.Manifest.Home, "ambient-ignore")
	if err := os.WriteFile(ignore, []byte("untracked.go\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(global, []byte("[core]\n\texcludesFile = "+filepath.ToSlash(ignore)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"GIT_DIR": f.Manifest.Remote, "GIT_WORK_TREE": f.Manifest.Worktree, "GIT_INDEX_FILE": filepath.Join(f.Manifest.Root, "invalid-index"), "GIT_OBJECT_DIRECTORY": filepath.Join(f.Manifest.Root, "invalid-objects"), "GIT_CONFIG_GLOBAL": global, "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.excludesFile", "GIT_CONFIG_VALUE_0": ignore} {
		t.Setenv(key, value)
	}
	actual, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if actual != wanted {
		t.Fatalf("ambient Git overrides changed source identity: %+v != %+v", actual, wanted)
	}
}

func TestFingerprintHandlesDeletedTrackedParent(t *testing.T) {
	f, ctx := sourceFixture(t)
	root := f.Manifest.Repository
	dir := filepath.Join(root, "tracked")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "code.go"), []byte("package fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Git(ctx, root, "add", "tracked/code.go"); err != nil {
		t.Fatal(err)
	}
	before, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	// Explicit file and empty directory removal avoids recursive computed deletion.
	if err := os.Remove(filepath.Join(dir, "code.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	after, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if after == before {
		t.Fatal("tracked parent deletion was omitted")
	}
}

func TestFingerprintRejectsSymlinkAncestorEscapeAndHashesLeafLinks(t *testing.T) {
	f, ctx := sourceFixture(t)
	root := f.Manifest.Repository
	dir := filepath.Join(root, "tracked")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "code.go"), []byte("package fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Git(ctx, root, "add", "tracked/code.go"); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "code.go"), []byte("outside payload"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "code.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, dir); err != nil {
		t.Skipf("symlink privilege unavailable: %v", err)
	}
	if _, err := evidence.Fingerprint(ctx, root); err == nil {
		t.Fatal("fingerprint followed an outside ancestor")
	}
	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "leaf-link")
	target := filepath.Join(outside, "code.go")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	before, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("changed outside payload"), 0600); err != nil {
		t.Fatal(err)
	}
	after, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("leaf symlink target content was dereferenced")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "another-target"), link); err != nil {
		t.Fatal(err)
	}
	changed, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if changed == after {
		t.Fatal("leaf symlink identity omitted")
	}
}

func TestFingerprintIncludesExecutableBits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows chmod does not expose POSIX executable bits")
	}
	f, ctx := sourceFixture(t)
	script := filepath.Join(f.Manifest.Repository, "check.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before, err := evidence.Fingerprint(ctx, f.Manifest.Repository)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(script, 0700); err != nil {
		t.Fatal(err)
	}
	after, err := evidence.Fingerprint(ctx, f.Manifest.Repository)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("executable mode change omitted")
	}
}
