package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/rs/zerolog"
)

type terminalWorkspaceTracker struct {
	tracker.Client
	issues []tracker.Issue
}

func (client terminalWorkspaceTracker) FetchIssues(context.Context, tracker.IssueFilter) ([]tracker.Issue, error) {
	return client.issues, nil
}

func TestTerminalWorkspaceValidationBeforeUpgrade(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "registered checkout")
	child := filepath.Join(root, "child checkout")
	outside := t.TempDir()
	for _, path := range []string{repo, child} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(root, "regular-file")
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	warehouse, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { warehouse.Close() })
	register := func(path string) string {
		t.Helper()
		id, err := warehouse.UpsertProject(context.Background(), path, "")
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	projectID := register(repo)
	missingProjectID := register(filepath.Join(root, "missing-project"))
	outsideProjectID := register(outside)
	srv := &Server{
		logger: zerolog.Nop(), db: warehouse,
		config:        &config.Config{ProjectRoots: []string{root}},
		workspaceRoot: filepath.Join(outside, "unscoped-default"),
		orchestrator:  orchestrator.NewService(),
		// Deliberately nil: no outcome in this test may call the terminal manager.
		termManager: nil,
	}
	router := chi.NewRouter()
	router.Get("/terminal/{session_id}", srv.TerminalWebSocket)

	cases := []struct {
		name, projectID, cwd, errorCode string
		status                          int
	}{
		{"missing override", projectID, filepath.Join(root, "missing"), "invalid_terminal_cwd", 400},
		{"relative override", projectID, "child checkout", "invalid_terminal_cwd", 400},
		{"file override", projectID, file, "invalid_terminal_cwd", 400},
		{"outside override", projectID, outside, "unauthorized_terminal_path", 403},
		{"unscoped outside override", "", outside, "unauthorized_terminal_path", 403},
		{"unknown project", "unknown-project", "", "project_not_found", 404},
		{"unknown project with valid override", "unknown-project", child, "project_not_found", 404},
		{"outside project", outsideProjectID, "", "unauthorized_project_path", 403},
		{"outside project with valid override", outsideProjectID, child, "unauthorized_project_path", 403},
		{"missing project directory", missingProjectID, "", "invalid_terminal_cwd", 400},
		{"registered project", projectID, "", "", 400},
		{"exact child checkout override", projectID, child, "", 400},
		{"unscoped valid override", "", child, "", 400},
		{"unscoped default preserved", "", "", "", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{}
			if tc.projectID != "" {
				query.Set("project_id", tc.projectID)
			}
			if tc.cwd != "" {
				query.Set("cwd", tc.cwd)
			}
			rec := httptest.NewRecorder()
			// No upgrade headers: valid directories reach the real upgrader's
			// handshake rejection, so no PTY or platform shell is involved.
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/terminal/session?"+query.Encode(), nil))
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.status, rec.Body.String())
			}
			if tc.errorCode == "" {
				if rec.Body.String() != "Bad Request\n" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
					t.Fatalf("valid selection did not reach upgrader: %s", rec.Body.String())
				}
				return
			}
			var body struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("expected pre-upgrade JSON error: %v: %s", err, rec.Body.String())
			}
			if body.Error.Code != tc.errorCode {
				t.Fatalf("error = %q, want %q: %s", body.Error.Code, tc.errorCode, rec.Body.String())
			}
			if rec.Header().Get("Upgrade") != "" {
				t.Fatal("invalid workspace upgraded the connection")
			}
		})
	}

	t.Run("existing issue worktree remains selected", func(t *testing.T) {
		srv.worktreeRoot = filepath.Join(root, "issue-worktrees")
		issuePath := filepath.Join(srv.worktreeRoot, projectID, "task-branch")
		if err := os.MkdirAll(issuePath, 0700); err != nil {
			t.Fatal(err)
		}
		srv.orchestrator.SetTrackerClient(terminalWorkspaceTracker{issues: []tracker.Issue{{Identifier: "TASK-1", BranchName: "task-branch"}}})
		// Removing only the empty primary fixture means a successful validation
		// must have selected the issue checkout rather than the project root.
		if err := os.Remove(repo); err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/terminal/issue-TASK-1?project_id="+url.QueryEscape(projectID), nil))
		if rec.Code != 400 || rec.Body.String() != "Bad Request\n" {
			t.Fatalf("existing issue checkout did not reach upgrader: %d %s", rec.Code, rec.Body.String())
		}
	})
}

func TestTerminalProjectLookupUnavailableBeforeUpgrade(t *testing.T) {
	srv := &Server{logger: zerolog.Nop()}
	router := chi.NewRouter()
	router.Get("/terminal/{session_id}", srv.TerminalWebSocket)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/terminal/session?project_id=registered", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "project_unavailable") {
		t.Fatalf("%d: %s", rec.Code, rec.Body.String())
	}
}
