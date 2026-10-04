package fileconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWritePrivateCreateAndReplace(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings", "config.json")
	for _, value := range []string{"first", "replacement"} {
		if err := WritePrivate(path, []byte(value)); err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(path)
		if err != nil || string(got) != value {
			t.Fatalf("read: %q, %v", got, err)
		}
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary files leaked: %v, %v", entries, err)
	}
	if runtime.GOOS != "windows" {
		file, _ := os.Stat(path)
		dir, _ := os.Stat(filepath.Dir(path))
		if file.Mode().Perm() != 0600 || dir.Mode().Perm() != 0700 {
			t.Fatal("config permissions must remain private")
		}
	}
}

func TestWritePrivateFailedReplacementRetainsExistingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(path, "keep.txt")
	if err := os.WriteFile(child, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WritePrivate(path, []byte("bad replacement")); err == nil {
		t.Fatal("expected replacement failure")
	}
	got, err := os.ReadFile(child)
	if err != nil || string(got) != "keep" {
		t.Fatalf("existing data changed: %q, %v", got, err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("temporary file leaked: %v", entries)
	}
}

func TestWritePrivateInvalidParent(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(parent, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WritePrivate(filepath.Join(parent, "config"), []byte("new")); err == nil {
		t.Fatal("expected invalid parent error")
	}
}
