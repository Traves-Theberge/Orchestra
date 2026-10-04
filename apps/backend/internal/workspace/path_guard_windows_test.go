package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsShortAndLongWorkspaceRoots(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Long workspace directory")
	child := filepath.Join(root, "task")
	if err := os.MkdirAll(child, 0755); err != nil {
		t.Fatal(err)
	}
	rootPtr, err := windows.UTF16PtrFromString(root)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]uint16, 32768)
	n, err := windows.GetShortPathName(rootPtr, &buf[0], uint32(len(buf)))
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 || n >= uint32(len(buf)) {
		t.Fatalf("short path length %d", n)
	}
	short := windows.UTF16ToString(buf[:n])
	if strings.EqualFold(short, root) {
		t.Skip("volume does not expose short names")
	}
	for _, pair := range [][2]string{{short, child}, {root, filepath.Join(short, "task")}} {
		if err := ValidateWorkspacePath(pair[0], pair[1]); err != nil {
			t.Fatal(err)
		}
		if err := ValidateProjectPath(pair[1], []string{pair[0]}); err != nil {
			t.Fatal(err)
		}
	}
	if err := ValidateWorkspacePath(short, root); err == nil {
		t.Fatal("root alias accepted as child")
	}
	if err := ValidateWorkspacePath(short, filepath.Join(short, "..", "outside")); err == nil {
		t.Fatal("traversal accepted")
	}
}
