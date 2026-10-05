package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func sourceGit(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func TestProjectSourcesHTTPRealGit(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	router, database := newTestRouterWithDB(t)
	parent := t.TempDir()
	create := func(source, name, remote string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"root_path": parent, "source": source, "name": name, "remote_url": remote})
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body)))
		if recorder.Code != http.StatusCreated {
			t.Fatalf("create %s: %d %s", source, recorder.Code, recorder.Body.String())
		}
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		project, err := database.GetProjectByID(context.Background(), result.ID)
		if err != nil || project.RootPath != filepath.Join(parent, name) {
			t.Fatalf("registered destination: %+v %v", project, err)
		}
		return project.RootPath
	}
	origin := create("new", "New project", "")
	if branch := sourceGit(t, origin, "branch", "--show-current"); branch != "main" {
		t.Fatalf("branch %s", branch)
	}
	head := sourceGit(t, origin, "rev-parse", "HEAD")
	clone := create("clone", "Cloned project", origin)
	if sourceGit(t, clone, "rev-parse", "HEAD") != head {
		t.Fatal("clone lost source identity")
	}
	sourceGit(t, clone, "worktree", "add", "-b", "task-fixture", filepath.Join(parent, "Task checkout"))
	if _, err := os.Stat(filepath.Join(parent, "Task checkout", ".git")); err != nil {
		t.Fatal("new project does not support task worktrees", err)
	}
}

func TestProjectSourceGuardsAndFailedDestinationRetention(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	parent := t.TempDir()
	roots := []string{parent}
	for _, scenario := range []struct{ source, name, remote string }{
		{"new", "../escape", ""}, {"unknown", "Unknown", ""}, {"clone", "Insecure", "http://example.com/repo"},
		{"clone", "Credentials", "https://user:secret@example.com/repo"}, {"clone", "SSHpassword", "ssh://git:secret@example.com/repo"},
	} {
		if _, err := prepareProjectSource(context.Background(), scenario.source, parent, scenario.name, scenario.remote, roots); err == nil {
			t.Fatalf("accepted invalid source %+v", scenario)
		}
	}
	existing := filepath.Join(parent, "Existing")
	if err := os.Mkdir(existing, 0700); err != nil {
		t.Fatal(err)
	}
	valuable := filepath.Join(existing, "valuable.txt")
	if err := os.WriteFile(valuable, []byte("retain"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareProjectSource(context.Background(), "new", parent, "Existing", "", roots); err == nil {
		t.Fatal("overwrote existing destination")
	}
	if value, err := os.ReadFile(valuable); err != nil || string(value) != "retain" {
		t.Fatal("lost existing data")
	}
	notRepo := filepath.Join(parent, "Not a repository")
	if err := os.Mkdir(notRepo, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareProjectSource(context.Background(), "clone", parent, "Failed clone", notRepo, roots); err == nil {
		t.Fatal("clone unexpectedly succeeded")
	}
	if _, err := os.Stat(filepath.Join(parent, "Failed clone")); err != nil {
		t.Fatal("failed destination not retained", err)
	}
	outside := t.TempDir()
	if _, err := prepareProjectSource(context.Background(), "new", outside, "Blocked", "", roots); err == nil {
		t.Fatal("accepted unauthorized parent")
	}
	if _, err := os.Stat(filepath.Join(outside, "Blocked")); !os.IsNotExist(err) {
		t.Fatal("unauthorized destination created")
	}
}
