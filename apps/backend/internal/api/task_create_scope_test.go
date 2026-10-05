package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
	"github.com/rs/zerolog"
)

type createScopeClient struct {
	tracker.Client
	creates int
}

func (c *createScopeClient) CreateIssue(context.Context, string, string, string, int, string, string, string, []string) (*tracker.Issue, error) {
	c.creates++
	return nil, fmt.Errorf("global tracker must not be called")
}

type createScopeAdapter struct {
	tracker.Adapter
	result           *tracker.Issue
	updated          *tracker.Issue
	creates, updates int
}

func (a *createScopeAdapter) Create(context.Context, tracker.WorkItem) (*tracker.WorkItem, error) {
	a.creates++
	return a.result, nil
}

func (a *createScopeAdapter) Update(context.Context, string, map[string]any) (*tracker.WorkItem, error) {
	a.updates++
	return a.updated, nil
}

func TestPostIssueProjectCreationFailsClosed(t *testing.T) {
	for _, scenario := range []string{"missing_registry", "failed_factory", "missing_config", "missing_project", "foreign_project", "foreign_source", "nil_result", "foreign_update", "local_success"} {
		t.Run(scenario, func(t *testing.T) {
			database, err := db.Connect(filepath.Join(t.TempDir(), "create.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			pid, err := database.UpsertProject(t.Context(), t.TempDir(), "")
			if err != nil {
				t.Fatal(err)
			}
			if scenario != "local_success" {
				if err := database.UpdateProjectIssueSource(t.Context(), pid, "github", "owner/repo", ""); err != nil {
					t.Fatal(err)
				}
			}
			service := orchestrator.NewService()
			service.SetDB(database)
			global := &createScopeClient{}
			service.SetTrackerClient(global)
			adapter := &createScopeAdapter{result: &tracker.Issue{ID: "1", Identifier: "owner/repo#1", ProjectID: pid, Source: "github"}}
			if scenario == "missing_config" {
				if _, err := database.Exec("UPDATE projects SET issue_source_type='', tracker_config_id='missing' WHERE id=?", pid); err != nil {
					t.Fatal(err)
				}
			}
			if scenario != "missing_registry" {
				service.SetTrackerRegistry(trackerregistry.NewWithFactory(database, func(*db.TrackerConfig, string) (tracker.Adapter, error) {
					if scenario == "failed_factory" {
						return nil, fmt.Errorf("injected adapter failure")
					}
					return adapter, nil
				}))
			}
			switch scenario {
			case "foreign_project":
				adapter.result.ProjectID = "another-project"
			case "foreign_source":
				adapter.result.Source = "linear"
			case "nil_result":
				adapter.result = nil
			case "foreign_update":
				adapter.updated = &tracker.Issue{ID: "another-id", Identifier: "owner/repo#2", ProjectID: pid, Source: "github", RuntimeTarget: "LOCAL"}
			}
			server := &Server{logger: zerolog.Nop(), orchestrator: service, db: database}
			requestPID := pid
			if scenario == "missing_project" {
				requestPID = "unregistered-project"
			}
			body := fmt.Sprintf(`{"title":"Scoped task","state":"Backlog","project_id":%q,"runtime_target":"LOCAL"}`, requestPID)
			rec := httptest.NewRecorder()
			server.PostIssue(rec, httptest.NewRequest(http.MethodPost, "/api/v1/issues", strings.NewReader(body)))
			want, code := http.StatusServiceUnavailable, "project_tracker_unavailable"
			if scenario == "foreign_project" || scenario == "foreign_source" || scenario == "nil_result" || scenario == "foreign_update" {
				want, code = http.StatusConflict, "creation_unconfirmed"
			}
			if scenario == "local_success" {
				want, code = http.StatusCreated, pid
			}
			if rec.Code != want || !strings.Contains(rec.Body.String(), code) {
				t.Fatalf("response %d %s", rec.Code, rec.Body.String())
			}
			if global.creates != 0 {
				t.Fatal("creation fell back globally")
			}
			wantCreates := 0
			if want == http.StatusConflict {
				wantCreates = 1
			}
			if adapter.creates != wantCreates {
				t.Fatalf("configured tracker creates %d, want %d", adapter.creates, wantCreates)
			}
			if scenario == "foreign_update" && adapter.updates != 1 {
				t.Fatal("missing follow-up fixture effect")
			}
			if scenario != "foreign_update" && adapter.updates != 0 {
				t.Fatal("patched an unconfirmed task")
			}
			var count int
			if err := database.QueryRow("SELECT COUNT(*) FROM issues WHERE project_id=?", pid).Scan(&count); err != nil {
				t.Fatal(err)
			}
			wantRows := 0
			if scenario == "local_success" {
				wantRows = 1
			}
			if count != wantRows {
				t.Fatalf("local rows %d, want %d", count, wantRows)
			}
		})
	}
}
