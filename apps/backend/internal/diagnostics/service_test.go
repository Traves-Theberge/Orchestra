package diagnostics

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTest(t *testing.T, options Options) *Service {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "diagnostics.db"), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}
func flushTest(t *testing.T, s *Service) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.Flush(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestNestedSpansPersistIdentityAndUsage(t *testing.T) {
	s := openTest(t, Options{})
	ctx := context.Background()
	parentCtx, parent := s.Start(ctx, "task.run", Fields{ProjectID: "project-a", TaskID: "task-a", RunID: "run-a", Provider: "codex"})
	_, child := s.Start(parentCtx, "provider.call", Fields{Model: "model-a", Attempt: 2})
	child.Event("provider.ready", "info")
	child.Usage(10, 3)
	child.End("error")
	child.End("ok")
	parent.End("ok")
	flushTest(t, s)
	page, err := s.ListTraces(ctx, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("traces: %+v", page)
	}
	detail, err := s.Trace(ctx, page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Spans) != 2 || len(detail.Logs) != 1 {
		t.Fatalf("detail: %+v", detail)
	}
	for _, span := range detail.Spans {
		if span.ProjectID != "project-a" || span.TaskID != "task-a" || span.RunID != "run-a" {
			t.Fatalf("identity: %+v", span)
		}
		if span.Name == "provider.call" {
			if span.Status != "error" || span.ParentSpanID != parent.id || span.InputTokens == nil || *span.InputTokens != 10 {
				t.Fatalf("child: %+v", span)
			}
		} else if span.InputTokens != nil {
			t.Fatal("unknown usage became zero")
		}
	}
	overview, err := s.Overview(ctx, Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Usage) != 1 || overview.Usage[0].InputTokens != 10 || overview.Usage[0].KnownRuns != 1 {
		t.Fatalf("usage: %+v", overview)
	}
}
func TestRestartPreservesHistoryAndMarksRunningUnknown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "diagnostics.db")
	s, err := Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	_, span := s.Start(context.Background(), "task.run", Fields{TaskID: "task-a"})
	flushTest(t, s)
	page, _ := s.ListTraces(context.Background(), Filter{})
	if page.Items[0].Status != "running" {
		t.Fatal(page)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	page, err = s.ListTraces(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Status != "unknown" || page.Items[0].EndTime != nil {
		t.Fatalf("recovered: %+v", page)
	}
	span.End("ok")
	flushTest(t, s)
	page, _ = s.ListTraces(context.Background(), Filter{})
	if page.Items[0].Status != "unknown" {
		t.Fatal("late completion changed recovered history")
	}
}
func TestClearCannotResurrectActiveSpans(t *testing.T) {
	s := openTest(t, Options{})
	ctx, parent := s.Start(context.Background(), "task.run", Fields{})
	if err := s.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	parent.Event("task.ready", "info")
	parent.Usage(99, 99)
	parent.End("ok")
	_, child := s.Start(ctx, "provider.call", Fields{})
	child.End("ok")
	flushTest(t, s)
	page, _ := s.ListTraces(context.Background(), Filter{})
	logs, _ := s.Logs(context.Background(), Filter{})
	overview, _ := s.Overview(context.Background(), Filter{})
	if page.Total != 0 || logs.Total != 0 || len(overview.Operations) != 0 {
		t.Fatalf("resurrected: %+v %+v %+v", page, logs, overview)
	}
	_, fresh := s.Start(context.Background(), "task.run", Fields{})
	fresh.End("ok")
	flushTest(t, s)
	page, _ = s.ListTraces(context.Background(), Filter{})
	if page.Total != 1 {
		t.Fatal("clear disabled fresh collection")
	}
}
func TestPrivacySettingsValidationAndNoop(t *testing.T) {
	var nilService *Service
	_, noop := nilService.Start(context.Background(), "task.run", Fields{})
	noop.Event("ready", "info")
	noop.Usage(1, 1)
	noop.End("ok")
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "Authorization: secret", Fields{TaskID: "secret/path", Provider: "bearer secret", Model: "secret\\path"})
	span.Event("prompt secret", "secret severity")
	span.End("secret status")
	flushTest(t, s)
	exported, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(exported)
	if strings.Contains(string(data), "secret") {
		t.Fatalf("sensitive content: %s", data)
	}
	settings, _ := s.Settings(context.Background())
	settings.Enabled = false
	if err := s.UpdateSettings(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	before, _ := s.ListTraces(context.Background(), Filter{})
	_, disabled := s.Start(context.Background(), "task.run", Fields{})
	disabled.End("ok")
	flushTest(t, s)
	after, _ := s.ListTraces(context.Background(), Filter{})
	if before.Total != after.Total {
		t.Fatal("disabled recorded")
	}
	settings.RetentionDays = 0
	if err := s.UpdateSettings(context.Background(), settings); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid settings: %v", err)
	}
	if _, err = s.ListTraces(context.Background(), Filter{Limit: 501}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err = s.Trace(context.Background(), strings.Repeat("a", 32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}
