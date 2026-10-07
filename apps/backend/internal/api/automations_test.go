package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/automations"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func newAutomationRouter(t *testing.T) (http.Handler, *observability.PubSub) {
	t.Helper()
	root := t.TempDir()
	warehouse, err := db.Connect(filepath.Join(root, ".orchestra", "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { warehouse.Close() })
	bus := observability.NewPubSub()
	svc, err := automations.New(warehouse, automations.Options{
		Execute: func(ctx context.Context, a automations.Automation, run automations.Run, progress func(automations.Run)) automations.Run {
			run.Status = automations.StatusSucceeded
			run.Output = "ok"
			return run
		},
		Publish: func(r automations.Run) { bus.Publish(observability.Event{Type: "AUTOMATION_RUN_UPDATED", Data: r}) },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	cfg := &config.Config{WorkspaceRoot: root, ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, bus, warehouse, nil, nil, nil, nil, nil, svc)
	return router, bus
}

func automationCall(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAutomationsAPILifecycle(t *testing.T) {
	h, bus := newAutomationRouter(t)
	events, unsubscribe := bus.Subscribe(64)
	defer unsubscribe()

	rec := automationCall(t, h, "POST", "/api/v1/automations", `{"name":"Weekday repo audit","prompt":"Audit.","provider":"claude","schedule":{"kind":"weekdays","time":"09:00","timezone":"America/Edmonton"},"grace_minutes":720,"precheck":{"command":"","timeout_seconds":60},"enabled":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var a map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &a)
	id, _ := a["id"].(string)
	for _, key := range []string{"id", "created_at", "updated_at", "next_run_at", "last_run_at", "last_run_status", "schedule_description", "project_name", "task_identifier", "task_title", "workspace_mode", "base_branch", "grace_minutes", "precheck", "enabled", "model", "reasoning_effort", "project_id", "task_id"} {
		if _, ok := a[key]; !ok {
			t.Fatalf("automation JSON missing %q: %s", key, rec.Body)
		}
	}
	if id == "" || a["schedule_description"] != "Weekdays at 09:00 (America/Edmonton)" || a["next_run_at"] == "" {
		t.Fatalf("create body: %s", rec.Body)
	}

	if rec = automationCall(t, h, "POST", "/api/v1/automations", `{"name":"","prompt":"x","provider":"claude","schedule":{"kind":"daily","time":"09:00"}}`); rec.Code != 400 || !strings.Contains(rec.Body.String(), "invalid_automation") {
		t.Fatalf("invalid create: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "POST", "/api/v1/automations", `{"name":`); rec.Code != 400 {
		t.Fatalf("bad json: %d", rec.Code)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automations", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"automations":[`) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automations/"+id, ""); rec.Code != 200 {
		t.Fatalf("get: %d", rec.Code)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automations/missing", ""); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
	if rec = automationCall(t, h, "PATCH", "/api/v1/automations/"+id, `{"name":"Renamed"}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"name":"Renamed"`) || !strings.Contains(rec.Body.String(), `"prompt":"Audit."`) {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "POST", "/api/v1/automations/"+id+"/pause", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":false`) || !strings.Contains(rec.Body.String(), `"next_run_at":""`) {
		t.Fatalf("pause: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "POST", "/api/v1/automations/"+id+"/resume", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":true`) {
		t.Fatalf("resume: %d %s", rec.Code, rec.Body)
	}

	rec = automationCall(t, h, "POST", "/api/v1/automations/"+id+"/run", "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("run: %d %s", rec.Code, rec.Body)
	}
	var run automations.Run
	_ = json.Unmarshal(rec.Body.Bytes(), &run)
	if run.Trigger != "manual" || run.RunNumber != 1 || run.Title != "Renamed run 1" {
		t.Fatalf("run body: %s", rec.Body)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		rec = automationCall(t, h, "GET", "/api/v1/automation-runs/"+run.ID, "")
		_ = json.Unmarshal(rec.Body.Bytes(), &run)
		if run.Status == "succeeded" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if run.Status != "succeeded" || run.Output != "ok" {
		t.Fatalf("run settle: %s", rec.Body)
	}
	for _, key := range []string{"automation_name", "scheduled_for", "workspace_id", "workspace_path", "branch", "chat_project_id", "chat_session_id", "output_truncated", "precheck", "usage", "occurrence_count"} {
		if !strings.Contains(rec.Body.String(), `"`+key+`"`) {
			t.Fatalf("run JSON missing %q: %s", key, rec.Body)
		}
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automations/"+id+"/runs", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), run.ID) {
		t.Fatalf("runs: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automation-runs?status=succeeded&limit=5", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), run.ID) {
		t.Fatalf("all runs: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automation-runs?status=nope", ""); rec.Code != 400 {
		t.Fatalf("bad status filter: %d", rec.Code)
	}
	if rec = automationCall(t, h, "POST", "/api/v1/automation-runs/"+run.ID+"/cancel", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"succeeded"`) {
		t.Fatalf("cancel finished: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "POST", "/api/v1/automation-runs/missing/cancel", ""); rec.Code != 404 {
		t.Fatalf("cancel missing: %d", rec.Code)
	}

	sawEvent := false
	for len(events) > 0 && !sawEvent {
		e := <-events
		if r, ok := e.Data.(automations.Run); ok && e.Type == "AUTOMATION_RUN_UPDATED" && r.ID == run.ID {
			sawEvent = true
		}
	}
	if !sawEvent {
		t.Fatal("no AUTOMATION_RUN_UPDATED event")
	}

	if rec = automationCall(t, h, "DELETE", "/api/v1/automations/"+id, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body)
	}
	if rec = automationCall(t, h, "GET", "/api/v1/automation-runs/"+run.ID, ""); rec.Code != 404 {
		t.Fatalf("run survived delete: %d", rec.Code)
	}
}

func TestAutomationSchedulePreviewAPI(t *testing.T) {
	h, _ := newAutomationRouter(t)
	rec := automationCall(t, h, "POST", "/api/v1/automations/schedule/preview", `{"schedule":{"kind":"cron","cron":"*/15 9-17 * * 1-5","timezone":"UTC"}}`)
	var p automations.SchedulePreview
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if rec.Code != 200 || !p.Valid || len(p.NextRuns) != 3 || p.Description != "Cron */15 9-17 * * 1-5 (UTC)" {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body)
	}
	rec = automationCall(t, h, "POST", "/api/v1/automations/schedule/preview", `{"schedule":{"kind":"cron","cron":"* *"}}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if rec.Code != 200 || p.Valid || p.Error == "" || !strings.Contains(rec.Body.String(), `"next_runs":[]`) {
		t.Fatalf("invalid preview: %d %s", rec.Code, rec.Body)
	}
}

func TestAutomationsUnavailableWithoutService(t *testing.T) {
	h := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir()})
	if rec := automationCall(t, h, "GET", "/api/v1/automations", ""); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
