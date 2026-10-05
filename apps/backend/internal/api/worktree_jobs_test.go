package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/worktreejobs"
)

func TestWorktreeJobProductionRouterCreatesAndScopesDurableReceipt(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	router, pid := newTestRouterWithGitProject(t)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/projects/"+pid+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	rid := uuid.NewString()
	body := `{"request_id":"` + rid + `","name":"new-agent","branch":"agent/new","base_ref":"HEAD"}`
	accepted := request("POST", "/worktree-jobs", body)
	if accepted.Code != 202 {
		t.Fatalf("accept: %d %s", accepted.Code, accepted.Body)
	}
	var job worktreejobs.Job
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		response := request("GET", "/worktree-jobs/"+rid, "")
		if response.Code != 200 {
			t.Fatalf("read: %d %s", response.Code, response.Body)
		}
		if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil {
			t.Fatal(err)
		}
		if job.Status == "completed" || job.Status == "failed" || job.Status == "unknown" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if job.Status != "completed" || job.Workspace == nil || job.Workspace.ID == "" || job.Workspace.Branch != "agent/new" {
		t.Fatalf("checkout: %+v", job)
	}
	status := request("GET", "/git/status?workspace_id="+job.Workspace.ID, "")
	if status.Code != 200 {
		t.Fatalf("created checkout cannot open: %d %s", status.Code, status.Body)
	}
	if replay := request("POST", "/worktree-jobs", body); replay.Code != 202 {
		t.Fatalf("receipt replay: %s", replay.Body)
	}
	if invalid := request("POST", "/worktree-jobs", strings.TrimSuffix(body, "}")+`,"prompt":"auto-send"}`); invalid.Code != 400 {
		t.Fatalf("unknown input accepted: %d", invalid.Code)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/projects/other/worktree-jobs/"+rid, nil))
	if rec.Code != 404 {
		t.Fatalf("receipt crossed project: %d", rec.Code)
	}
}
