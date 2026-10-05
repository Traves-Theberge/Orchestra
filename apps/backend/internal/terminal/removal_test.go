package terminal

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func TestDirectoryRemovalFenceRejectsActiveTerminalsAndNewSessions(t *testing.T) {
	root := t.TempDir()
	worktree := filepath.Join(root, "checkout")
	manager := NewManager()
	manager.sessions["active"] = &Session{Cmd: exec.Command("bash"), Closed: false}
	manager.sessions["active"].Cmd.Dir = worktree
	if _, err := manager.BeginDirectoryRemoval(worktree); err == nil {
		t.Fatal("active terminal was not detected")
	}
	delete(manager.sessions, "active")
	release, err := manager.BeginDirectoryRemoval(worktree)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err = manager.CreateSession("new", worktree, "bash"); err == nil {
		t.Fatalf("terminal admission during removal = %v", err)
	}
}

func TestActiveDirectoriesReportsOnlyOpenSessionPaths(t *testing.T) {
	manager := NewManager()
	manager.sessions["active"] = &Session{Cmd: exec.Command("bash"), Closed: false}
	manager.sessions["active"].Cmd.Dir = `C:\repo\worktree`
	manager.sessions["closed"] = &Session{Cmd: exec.Command("bash"), Closed: true}
	manager.sessions["closed"].Cmd.Dir = `C:\repo\old`
	got := manager.ActiveDirectories()
	if len(got) != 1 || got[0] != `C:\repo\worktree` {
		t.Fatalf("active directories = %#v", got)
	}
}
