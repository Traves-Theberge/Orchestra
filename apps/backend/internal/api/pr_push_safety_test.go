package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	"github.com/rs/zerolog"
)

type prSafetyTransport struct{ calls int }

func (transport *prSafetyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	transport.calls++
	return nil, errors.New("hosted HTTP is prohibited in PR push safety tests")
}

func prohibitPRHostedHTTP(t *testing.T) *prSafetyTransport {
	t.Helper()
	transport := &prSafetyTransport{}
	previous := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: transport}
	t.Cleanup(func() { http.DefaultClient = previous })
	return transport
}

func prSafetyGit(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func prSafetyCommit(t *testing.T, directory, message string) {
	t.Helper()
	prSafetyGit(t, directory, "-c", "user.name=PR Safety Test", "-c", "user.email=pr-safety@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message)
}

func prSafetyRequest(t *testing.T, server *Server, identifier, head string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/issues/"+identifier+"/pr", strings.NewReader(`{"title":"Test","owner":"test","repo":"local","token":"isolated-dummy","head":"`+head+`","base":"main"}`))
	params := chi.NewRouteContext()
	params.URLParams.Add("issue_identifier", identifier)
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, params))
	recorder := httptest.NewRecorder()
	server.CreateGitHubPR(recorder, request)
	return recorder
}

func newPRSafetyServer(t *testing.T) (*Server, string, string) {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	root := t.TempDir()
	local := filepath.Join(root, "local")
	remote := filepath.Join(root, "remote.git")
	for _, directory := range []string{local, remote} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	prSafetyGit(t, local, "init")
	prSafetyGit(t, remote, "init", "--bare")
	prSafetyGit(t, local, "checkout", "-b", "task")
	prSafetyCommit(t, local, "initial")
	prSafetyGit(t, local, "remote", "add", "origin", remote)
	prSafetyGit(t, local, "push", "-u", "origin", "task")
	warehouse, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = warehouse.Close() })
	projectID, err := warehouse.UpsertProject(t.Context(), local, "")
	if err != nil {
		t.Fatal(err)
	}
	service := orchestrator.NewService()
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "task-id", Identifier: "SAFE-1", ProjectID: projectID, BranchName: "task"}}))
	return &Server{logger: zerolog.Nop(), orchestrator: service, db: warehouse, config: &config.Config{}}, local, remote
}

func TestCreateGitHubPRRejectsDivergentPushWithoutRewritingRemote(t *testing.T) {
	server, local, remote := newPRSafetyServer(t)
	transport := prohibitPRHostedHTTP(t)
	peer := filepath.Join(filepath.Dir(local), "peer")
	prSafetyGit(t, filepath.Dir(local), "clone", "--branch", "task", remote, peer)
	prSafetyCommit(t, peer, "remote update")
	prSafetyGit(t, peer, "push", "origin", "task")
	// Refreshing the tracking ref means the old automatic force-with-lease
	// retry would succeed and overwrite the independent remote commit.
	prSafetyGit(t, local, "fetch", "origin")
	prSafetyCommit(t, local, "divergent local update")
	before := prSafetyGit(t, remote, "rev-parse", "refs/heads/task")
	recorder := prSafetyRequest(t, server, "SAFE-1", "task")
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "pr_push_failed") {
		t.Fatalf("expected push conflict, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if after := prSafetyGit(t, remote, "rev-parse", "refs/heads/task"); after != before {
		t.Fatalf("remote rewritten: before %s after %s", before, after)
	}
	if transport.calls != 0 {
		t.Fatalf("attempted %d hosted calls after rejected push", transport.calls)
	}
	issue, err := server.orchestrator.FetchIssueByIdentifier(t.Context(), "SAFE-1")
	if err != nil || issue.PRURL != "" {
		t.Fatalf("issue should have no PR link after push failure: %+v, %v", issue, err)
	}
}

func TestCreateGitHubPRRejectsMissingLocalBranchBeforeHostedCreate(t *testing.T) {
	server, _, remote := newPRSafetyServer(t)
	transport := prohibitPRHostedHTTP(t)
	before := prSafetyGit(t, remote, "rev-parse", "refs/heads/task")
	recorder := prSafetyRequest(t, server, "SAFE-1", "missing-branch")
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "pr_push_failed") {
		t.Fatalf("expected local push failure, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if transport.calls != 0 || prSafetyGit(t, remote, "rev-parse", "refs/heads/task") != before {
		t.Fatal("failed local push changed remote or attempted hosted PR creation")
	}
}

func TestCreateGitHubPRRequiresExistingTaskBeforeSideEffects(t *testing.T) {
	transport := prohibitPRHostedHTTP(t)
	service := orchestrator.NewService()
	service.SetTrackerClient(memory.NewClient(nil))
	server := &Server{logger: zerolog.Nop(), orchestrator: service, config: &config.Config{}}
	recorder := prSafetyRequest(t, server, "MISSING-1", "task")
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "issue_not_found") {
		t.Fatalf("expected missing task, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if transport.calls != 0 {
		t.Fatal("missing task attempted hosted PR creation")
	}
}
