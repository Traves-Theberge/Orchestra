package git

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCreateBranchFromDoesNotSwitchBeforeRejectedCreation(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git unavailable")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", args...)
		command.Dir = dir
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s: %v", args, output, err)
		}
		return strings.TrimSpace(string(output))
	}
	run("init", "--initial-branch=main")
	run("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--allow-empty", "-m", "base")
	base := run("rev-parse", "HEAD")
	run("checkout", "-b", "feature")
	run("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "--allow-empty", "-m", "feature")
	if err := CreateBranchFrom(context.Background(), dir, "main", "main"); err == nil {
		t.Fatal("existing branch creation succeeded")
	}
	if current := run("branch", "--show-current"); current != "feature" {
		t.Fatalf("failed creation switched branch to %q", current)
	}
	if err := CreateBranchFrom(context.Background(), dir, "new-feature", "main"); err != nil {
		t.Fatal(err)
	}
	if got := run("rev-parse", "HEAD"); got != base {
		t.Fatalf("created from wrong commit: %s", got)
	}
}
