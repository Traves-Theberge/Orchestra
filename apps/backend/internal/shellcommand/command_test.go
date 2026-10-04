package shellcommand

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExecutablePathWithSpaces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test command.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf 'hello'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	cmd, err := CommandContext(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.CombinedOutput()
	if err != nil || string(out) != "hello" {
		t.Fatalf("command: %q, %v", out, err)
	}
}

func TestCancellationStopsDescendants(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cmd, err := CommandContext(ctx, "printf started > started; (sleep 2; printf leaked > leaked) & wait")
	if err != nil {
		t.Fatal(err)
	}
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("expected cancellation: %s", out)
	}
	if _, err := os.Stat(filepath.Join(dir, "started")); err != nil {
		t.Fatalf("fixture did not start: %v", err)
	}
	time.Sleep(2 * time.Second)
	if _, err := os.Stat(filepath.Join(dir, "leaked")); !os.IsNotExist(err) {
		t.Fatalf("descendant survived cancellation: %v", err)
	}
}

func TestUnavailableShellDiagnostic(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	_, err := Resolve()
	if err == nil || !strings.Contains(err.Error(), "POSIX shell unavailable") {
		t.Fatalf("unexpected diagnostic: %v", err)
	}
}
