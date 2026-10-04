package logfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteSessionLogCreatesSessionAndLatest(t *testing.T) {
	root := t.TempDir()
	path, err := WriteSessionLog(root, "ORC-55", "thread-1-turn-1", "hello world")
	if err != nil {
		t.Fatalf("write session log: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected session log path exists: %v", err)
	}

	latestPath := filepath.Join(root, "_logs", "ORC-55", "latest.log")
	content, err := os.ReadFile(latestPath)
	if err != nil {
		t.Fatalf("read latest log: %v", err)
	}
	if string(content) != "hello world" {
		t.Fatalf("unexpected latest log content: %q", string(content))
	}
}

func TestResetLatestLogCreatesWorkingSymlink(t *testing.T) {
	root := t.TempDir()
	issueID := "ORC-10"
	sessionID := "ORC-10-12345"

	_, err := WriteSessionLog(root, issueID, sessionID, "test log content")
	if err != nil {
		t.Fatalf("write session log: %v", err)
	}

	latestPath := filepath.Join(root, "_logs", "ORC-10", "latest.log")
	content, err := os.ReadFile(latestPath)
	if err != nil {
		t.Fatalf("read latest.log via symlink: %v", err)
	}
	if string(content) != "test log content" {
		t.Fatalf("unexpected latest.log content: %q", string(content))
	}

	target, err := os.Readlink(latestPath)
	if err != nil {
		latest, statErr := os.Stat(latestPath)
		if statErr != nil {
			t.Fatal(statErr)
		}
		session, statErr := os.Stat(filepath.Join(filepath.Dir(latestPath), sessionID+".log"))
		if statErr != nil {
			t.Fatal(statErr)
		}
		if !os.SameFile(latest, session) {
			t.Fatal("latest must link to the live session file")
		}
		return
	}
	if filepath.IsAbs(target) {
		t.Fatalf("expected relative symlink target, got %q", target)
	}
}

func TestWriteSessionLogSanitizesPaths(t *testing.T) {
	root := t.TempDir()
	path, err := WriteSessionLog(root, "ORC/55", "thread:1", "ok")
	if err != nil {
		t.Fatalf("write session log: %v", err)
	}

	if filepath.Base(path) != "thread_1.log" {
		t.Fatalf("expected sanitized session id filename, got %s", filepath.Base(path))
	}
}
