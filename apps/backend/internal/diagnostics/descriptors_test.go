package diagnostics

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPDescriptorsPersistSearchAndExport(t *testing.T) {
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "http.request", Fields{})
	span.HTTP("GET", "/api/v1/tasks/{task_id}", 404)
	span.Event("http.completed", "error")
	span.End("error")
	flushTest(t, s)
	page, err := s.ListTraces(context.Background(), Filter{Query: "/tasks/{task_id}"})
	if err != nil || page.Total != 1 {
		t.Fatalf("route search: %+v %v", page, err)
	}
	logs, err := s.Logs(context.Background(), Filter{Query: "GET"})
	if err != nil || logs.Total != 1 {
		t.Fatalf("method search: %+v %v", logs, err)
	}
	out, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	r := out.Spans[0]
	l := out.Logs[0]
	if r.HTTPMethod != "GET" || r.HTTPRoute != "/api/v1/tasks/{task_id}" || r.HTTPStatusCode != 404 || r.Label != "GET /api/v1/tasks/{task_id}" {
		t.Fatalf("span: %+v", r)
	}
	if l.HTTPStatusCode != 404 || l.HTTPRoute != r.HTTPRoute || l.HTTPMethod != r.HTTPMethod || l.DurationMS == nil || *l.DurationMS < 0 || !strings.Contains(l.Description, "404") {
		t.Fatalf("log: %+v", l)
	}
	if strings.Contains(l.Description, "success") {
		t.Fatalf("failed response described as successful: %+v", l)
	}
}

func TestHTTPMetadataSurvivesReopenAndRespectsClearDisable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	_, span := s.Start(context.Background(), "http.request", Fields{})
	span.HTTP("POST", "/api/v1/tasks/{task_id}/start", 202)
	span.Event("http.completed", "info")
	span.End("ok")
	flushTest(t, s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	out, err := s.Export(context.Background(), Filter{})
	if err != nil || len(out.Spans) != 1 || out.Spans[0].HTTPStatusCode != 202 || out.Logs[0].HTTPRoute != "/api/v1/tasks/{task_id}/start" || out.Logs[0].DurationMS == nil {
		t.Fatalf("reopened: %+v %v", out, err)
	}
	_, late := s.Start(context.Background(), "http.request", Fields{})
	if err := s.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	late.HTTP("GET", "/health", 200)
	late.Event("http.completed", "info")
	late.End("ok")
	settings, err := s.Settings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	settings.Enabled = false
	if err := s.UpdateSettings(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	_, disabled := s.Start(context.Background(), "http.request", Fields{})
	disabled.HTTP("GET", "/health", 200)
	disabled.Event("http.completed", "info")
	disabled.End("ok")
	flushTest(t, s)
	out, err = s.Export(context.Background(), Filter{})
	if err != nil || len(out.Spans) != 0 || len(out.Logs) != 0 {
		t.Fatalf("fence/disable: %+v %v", out, err)
	}
}

func TestHTTPMetadataDoesNotLeakIntoChildOperations(t *testing.T) {
	s := openTest(t, Options{})
	ctx, parent := s.Start(context.Background(), "http.request", Fields{TaskID: "task-a"})
	parent.HTTP("POST", "/api/v1/tasks/{task_id}/start", 202)
	_, child := s.Start(ctx, "task.attempt", Fields{})
	child.Event("task.failed", "error")
	child.End("error")
	parent.Event("http.completed", "info")
	parent.End("ok")
	flushTest(t, s)
	out, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range out.Spans {
		if r.Name == "task.attempt" {
			found = true
			if r.TaskID != "task-a" || r.HTTPMethod != "" || r.HTTPRoute != "" || r.HTTPStatusCode != 0 || r.Label != "Task attempt" {
				t.Fatalf("child metadata: %+v", r)
			}
		}
	}
	if !found {
		t.Fatal("missing child operation")
	}
	for _, l := range out.Logs {
		if l.Name == "task.failed" && (l.HTTPMethod != "" || l.HTTPRoute != "" || l.HTTPStatusCode != 0 || l.DurationMS != nil) {
			t.Fatalf("child event metadata: %+v", l)
		}
	}
}

func TestHTTPDescriptorsRejectSensitiveValuesAndKeepUnknownHistoricalEvidence(t *testing.T) {
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "http.request", Fields{})
	span.HTTP("Bearer secret", "/api/v1/tasks/{task_id}?password=DO_NOT_STORE", 999)
	span.Event("http.completed", "info")
	span.End("unknown")
	_, historical := s.Start(context.Background(), "http.request", Fields{})
	historical.Event("http.completed", "info")
	historical.End("ok")
	_, unknown := s.Start(context.Background(), "custom.observation", Fields{})
	unknown.Event("custom.event", "info")
	unknown.End("unknown")
	flushTest(t, s)
	out, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "DO_NOT_STORE") || strings.Contains(string(raw), "Bearer") {
		t.Fatalf("privacy: %s", raw)
	}
	for _, r := range out.Spans {
		if r.HTTPMethod != "" || r.HTTPRoute != "" || r.HTTPStatusCode != 0 {
			t.Fatalf("invented HTTP evidence: %+v", r)
		}
		if r.Label == "" || r.Description == "" {
			t.Fatalf("missing descriptor: %+v", r)
		}
	}
	for _, l := range out.Logs {
		if l.Name == "http.completed" && !strings.Contains(l.Description, "not recorded") {
			t.Fatalf("unknown HTTP outcome: %+v", l)
		}
	}
}
