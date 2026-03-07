package workspace

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWorkspacePath_SanitizesIdentifier(t *testing.T) {
	root := t.TempDir()
	path, err := WorkspacePath(root, "MT/Det")
	if err != nil {
		t.Fatalf("expected workspace path, got err=%v", err)
	}

	if filepath.Base(path) != "MT_Det" {
		t.Fatalf("expected sanitized identifier MT_Det, got=%q", filepath.Base(path))
	}
}

func TestValidateWorkspacePath_RejectsRoot(t *testing.T) {
	root := t.TempDir()
	if err := ValidateWorkspacePath(root, root); err == nil {
		t.Fatalf("expected root rejection")
	}
}

func TestValidateWorkspacePath_RejectsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(filepath.Dir(root), "outside-workspace")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}

	if err := ValidateWorkspacePath(root, outside); err == nil {
		t.Fatalf("expected outside-root rejection")
	}
}

func TestValidateWorkspacePath_RejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink behavior differs on windows")
	}

	root := t.TempDir()
	outside := t.TempDir()
	candidate := filepath.Join(root, "MT-SYM")

	if err := os.Symlink(outside, candidate); err != nil {
		t.Fatalf("create symlink: %v", err)
	}

	if err := ValidateWorkspacePath(root, candidate); err == nil {
		t.Fatalf("expected symlink escape rejection")
	}
}
