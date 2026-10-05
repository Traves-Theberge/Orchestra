package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestTaskAssignmentExecutableHTTPJourney(t *testing.T) {
	var listQuery string
	var assignment map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer isolated-cli-fixture" {
			t.Errorf("unexpected authorization header")
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects":
			_, _ = w.Write([]byte(`[{"id":"project-1","name":"Fixture"}]`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/issues":
			listQuery = r.URL.RawQuery
			_, _ = w.Write([]byte(`{"issues":[{"id":"task-1","identifier":"FIX-1","project_id":"project-1","title":"Unassigned work","state":"Backlog","assignee_id":"","pr_url":"https://github.com/example/repo/pull/12"}],"total":1}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/orchestrator/control":
			if err := json.NewDecoder(r.Body).Decode(&assignment); err != nil {
				t.Errorf("decode assignment request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"task":{"id":"task-1","identifier":"FIX-1","project_id":"project-1","title":"Unassigned work","state":"Backlog","assignee_id":"worker-7","pr_url":"https://github.com/example/repo/pull/12"},"effect":"assigned","execution":"not_started","provider":"unchanged"}}`))
		default:
			t.Errorf("unexpected CLI request %s %s", r.Method, r.URL.String())
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	name := "orchestra"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join(t.TempDir(), name)
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build Orchestra CLI: %v\n%s", err, output)
	}

	invoke := func(args ...string) string {
		t.Helper()
		cmd := exec.Command(binary, args...)
		cmd.Env = append(os.Environ(), "ORCHESTRA_BASE_URL="+server.URL, "ORCHESTRA_API_TOKEN=isolated-cli-fixture")
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		if err := cmd.Run(); err != nil {
			t.Fatalf("orchestra %s: %v\nstdout: %s\nstderr: %s", strings.Join(args, " "), err, stdout.String(), stderr.String())
		}
		if stderr.Len() != 0 {
			t.Fatalf("orchestra %s wrote stderr: %s", strings.Join(args, " "), stderr.String())
		}
		return stdout.String()
	}

	listed := invoke("task", "list", "--project", "project-1", "--unassigned")
	if !strings.Contains(listed, "FIX-1 — Unassigned work") || !strings.Contains(listed, "Assignee: unassigned") || !strings.Contains(listed, "PR: https://github.com/example/repo/pull/12") || !strings.Contains(listQuery, "unassigned=true") {
		t.Fatalf("unassigned task/PR linkage was not returned by the executable: query=%q output=%q", listQuery, listed)
	}

	assigned := invoke("task", "assign", "--project", "project-1", "--id", "task-1", "--request-id", "bd60e6ec-5c67-4937-9c72-3e46513b5fad", "--assignee", "worker-7")
	if !strings.Contains(assigned, "Task assigned; it remains in Backlog and was not queued.") || !strings.Contains(assigned, "Assignee: worker-7") || !strings.Contains(assigned, "PR: https://github.com/example/repo/pull/12") {
		t.Fatalf("assignment result was not faithfully shown: %q", assigned)
	}
	if assignment["operation"] != "assign" || assignment["expected_state"] != "Backlog" || assignment["project_id"] != "project-1" || assignment["task_id"] != "task-1" || assignment["assignee_id"] != "worker-7" || assignment["provider"] != nil {
		t.Fatalf("CLI sent incorrect assignment intent: %+v", assignment)
	}
}
