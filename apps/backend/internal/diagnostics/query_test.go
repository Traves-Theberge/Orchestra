package diagnostics

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestFiltersPaginationAndTraceOutcomes(t *testing.T) {
	s := openTest(t, Options{})
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		rootCtx, root := s.Start(ctx, "task.run", Fields{ProjectID: "project-a", TaskID: fmt.Sprintf("task-%d", i)})
		_, child := s.Start(rootCtx, "provider.call", Fields{Provider: "CODEX"})
		child.Event("provider.ready", "info")
		child.End("ok")
		if i == 2 {
			root.End("error")
		} else {
			root.End("ok")
		}
	}
	flushTest(t, s)
	page, err := s.ListTraces(ctx, Filter{Provider: "CODEX", ProjectID: "project-a", Limit: 2, Offset: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 5 || len(page.Items) != 2 || page.Limit != 2 || page.Offset != 2 {
		t.Fatal(page)
	}
	errorsPage, err := s.ListTraces(ctx, Filter{Status: "error"})
	if err != nil {
		t.Fatal(err)
	}
	if errorsPage.Total != 1 || errorsPage.Items[0].TaskID != "task-2" {
		t.Fatal(errorsPage)
	}
	queryPage, err := s.ListTraces(ctx, Filter{Query: "task-3"})
	if err != nil {
		t.Fatal(err)
	}
	if queryPage.Total != 1 || queryPage.Items[0].TaskID != "task-3" {
		t.Fatal(queryPage)
	}
	logs, err := s.Logs(ctx, Filter{TaskID: "task-2", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if logs.Total != 1 || logs.Items[0].TaskID != "task-2" {
		t.Fatal(logs)
	}
	overview, err := s.Overview(ctx, Filter{TaskID: "task-2"})
	if err != nil {
		t.Fatal(err)
	}
	if !overview.DetailedScope || overview.TotalTraces != 1 || overview.FailedTraces != 1 || len(overview.Operations) != 2 {
		t.Fatal(overview)
	}
	for _, filter := range []Filter{{Limit: -1}, {Offset: -1}, {Offset: 1000001}, {Since: "bad"}, {Until: "bad"}, {Since: time.Now().Add(time.Hour).Format(time.RFC3339), Until: time.Now().Format(time.RFC3339)}, {Status: "invented"}} {
		if _, err := s.ListTraces(ctx, filter); !errors.Is(err, ErrInvalid) {
			t.Fatalf("filter %+v: %v", filter, err)
		}
	}
}

func seedRecord(t testing.TB, s *Service, index int, when time.Time) {
	t.Helper()
	end := when.Add(time.Second)
	input, output := int64(10), int64(5)
	record := SpanRecord{Fields: Fields{ProjectID: "project-a", TaskID: "task-a", Provider: "CODEX"}, TraceID: fmt.Sprintf("%032x", index+1), SpanID: fmt.Sprintf("%016x", index+1), Name: "provider.call", StartTime: when, EndTime: &end, DurationMS: 1000, Status: "ok", InputTokens: &input, OutputTokens: &output}
	s.dbMu.Lock()
	err := s.store.write(write{span: &record, final: true})
	s.dbMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
}
func TestRetentionKeepsIndependentMetrics(t *testing.T) {
	s := openTest(t, Options{})
	seedRecord(t, s, 1, time.Now().AddDate(0, 0, -10))
	seedRecord(t, s, 2, time.Now().AddDate(0, 0, -40))
	flushTest(t, s)
	traces, err := s.ListTraces(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if traces.Total != 0 {
		t.Fatal(traces)
	}
	overview, err := s.Overview(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Operations) != 1 || overview.Operations[0].Count != 1 || overview.Usage[0].InputTokens != 10 {
		t.Fatalf("independent aggregates %+v", overview)
	}
	scoped, err := s.Overview(context.Background(), Filter{TaskID: "task-a"})
	if err != nil {
		t.Fatal(err)
	}
	if !scoped.DetailedScope || len(scoped.Operations) != 0 {
		t.Fatal(scoped)
	}
}
func TestSettingsPersistAndDisableStopsExistingSpans(t *testing.T) {
	path := filepath.Join(t.TempDir(), "diagnostics.db")
	s, err := Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	ctx, span := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	settings, _ := s.Settings(context.Background())
	settings.Enabled = false
	settings.RetentionDays = 2
	settings.MetricsRetentionDays = 8
	settings.MaxStorageMB = 2
	if err = s.UpdateSettings(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	span.Event("provider.ready", "info")
	span.End("ok")
	flushTest(t, s)
	traces, _ := s.ListTraces(context.Background(), Filter{})
	if traces.Items[0].Status != "unknown" {
		t.Fatalf("disabled active operation should be unknown: %+v", traces)
	}
	logs, _ := s.Logs(context.Background(), Filter{})
	if logs.Total != 0 {
		t.Fatal("disabled recorded late event")
	}
	settings.Enabled = true
	if err = s.UpdateSettings(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	_, child := s.Start(ctx, "provider.call", Fields{})
	child.End("ok")
	flushTest(t, s)
	traces, _ = s.ListTraces(context.Background(), Filter{})
	if traces.Items[0].SpanCount != 1 {
		t.Fatal("re-enable resurrected active child")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	actual, err := s.Settings(context.Background())
	if err != nil || actual != settings {
		t.Fatalf("settings: %+v %v", actual, err)
	}
}
func TestQueueSaturationAndStoreFailureDoNotBlockProducer(t *testing.T) {
	s := openTest(t, Options{QueueSize: 1})
	s.dbMu.Lock()
	started := time.Now()
	for i := 0; i < 100; i++ {
		_, span := s.Start(context.Background(), "task.run", Fields{})
		span.Event("provider.ready", "info")
		span.End("ok")
	}
	duration := time.Since(started)
	s.dbMu.Unlock()
	if duration > time.Second {
		t.Fatalf("producer blocked: %s", duration)
	}
	flushTest(t, s)
	overview, err := s.Overview(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if overview.DroppedRecords == 0 {
		t.Fatal("overflow not disclosed")
	}
	// Read-only mode forces actual SQLite write failures without closing the reader.
	if _, err = s.store.db.Exec(`PRAGMA query_only=ON`); err != nil {
		t.Fatal(err)
	}
	_, span := s.Start(context.Background(), "task.run", Fields{})
	span.End("ok")
	if err = s.Flush(context.Background()); err == nil {
		t.Fatal("store failure not surfaced")
	}
	if _, err = s.store.db.Exec(`PRAGMA query_only=OFF`); err != nil {
		t.Fatal(err)
	}
	overview, err = s.Overview(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if overview.DroppedRecords < 2 {
		t.Fatal("store failure not counted")
	}
}
func TestSmallStorageBudgetReclaimsFilesAndDisclosesEviction(t *testing.T) {
	settings := defaultSettings()
	settings.MaxStorageMB = 1
	s := openTest(t, Options{Settings: &settings})
	for i := 0; i < 1600; i++ {
		seedRecord(t, s, i, time.Now())
	}
	flushTest(t, s)
	overview, err := s.Overview(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if overview.StorageBytes > 1024*1024 {
		t.Fatalf("over budget: %d", overview.StorageBytes)
	}
	if overview.DroppedRecords == 0 || overview.TotalTraces >= 1600 {
		t.Fatalf("eviction undisclosed: %+v", overview)
	}
	if len(overview.Operations) != 1 || overview.Operations[0].Count != 1600 {
		t.Fatal("budget erased aggregates before detail")
	}
}
func TestLargeHistoryQueriesAndExportAreBounded(t *testing.T) {
	s := openTest(t, Options{})
	for i := 0; i < 10000; i++ {
		seedRecord(t, s, i, time.Now())
	}
	flushTest(t, s)
	page, err := s.ListTraces(context.Background(), Filter{Limit: 500, Offset: 9500})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 10000 || len(page.Items) != 500 {
		t.Fatal(page)
	}
	exported, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if !exported.Truncated || len(exported.Traces) != 500 || len(exported.Spans) > exportLimit || len(exported.Logs) > exportLimit {
		t.Fatal("unbounded export")
	}
}
func TestTraceDetailIsBoundedAndMissingParentIsPartial(t *testing.T) {
	s := openTest(t, Options{QueueSize: 8192})
	ctx, parent := s.Start(context.Background(), "task.run", Fields{})
	for i := 0; i < 1200; i++ {
		_, child := s.Start(ctx, "provider.call", Fields{})
		child.End("ok")
	}
	parent.End("ok")
	flushTest(t, s)
	page, _ := s.ListTraces(context.Background(), Filter{})
	detail, err := s.Trace(context.Background(), page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	if !detail.Partial || len(detail.Spans) != detailLimit {
		t.Fatalf("unbounded detail: spans=%d partial=%v", len(detail.Spans), detail.Partial)
	}
}

func BenchmarkStartEnd(b *testing.B) {
	s, err := Open(filepath.Join(b.TempDir(), "diagnostics.db"), Options{QueueSize: 4096})
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, span := s.Start(ctx, "task.attempt", Fields{ProjectID: "benchmark", TaskID: "task", Provider: "CODEX", Attempt: 1})
		span.End("ok")
		if i%256 == 255 {
			b.StopTimer()
			if err := s.Flush(ctx); err != nil {
				b.Fatal(err)
			}
			b.StartTimer()
		}
	}
	b.StopTimer()
	if err := s.Flush(ctx); err != nil {
		b.Fatal(err)
	}
	b.ReportMetric(float64(s.dropped.Load()), "dropped")
}

func BenchmarkListTraces10k(b *testing.B) {
	s, err := Open(filepath.Join(b.TempDir(), "diagnostics.db"), Options{})
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 10000; i++ {
		seedRecord(b, s, i, time.Now())
	}
	if err = s.Flush(context.Background()); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		page, err := s.ListTraces(context.Background(), Filter{TaskID: "task-a", Limit: 100})
		if err != nil || page.Total != 10000 || len(page.Items) != 100 {
			b.Fatalf("query result %+v %v", page, err)
		}
	}
}

func TestCredentialLikeMetadataIsRejected(t *testing.T) {
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "secret.operation", Fields{ProjectID: "secret-marker", TaskID: "ghp_credentialmarker", RunID: "access-token-marker", SessionID: "sk-marker", Provider: "Bearer:credentialmarker", Model: "api_key_marker"})
	span.Event("secret.event", "info")
	span.End("ok")
	flushTest(t, s)
	export, err := s.Export(context.Background(), Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(export.Traces) != 1 || export.Traces[0].Name != "operation" || export.Traces[0].Fields != (Fields{}) || len(export.Logs) != 0 {
		t.Fatalf("credential-like metadata persisted: %+v", export)
	}
}

func TestSummaryUsesObservedChildIdentityUnderHTTPRoot(t *testing.T) {
	s := openTest(t, Options{})
	ctx, request := s.Start(context.Background(), "http.request", Fields{})
	_, turn := s.Start(ctx, "chat.turn", Fields{ProjectID: "project-a", TaskID: "task-a", SessionID: "session-a", RunID: "run-a", Provider: "CODEX"})
	request.End("ok")
	turn.End("ok")
	flushTest(t, s)
	page, err := s.ListTraces(context.Background(), Filter{TaskID: "task-a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].SessionID != "session-a" || page.Items[0].ProjectID != "project-a" || page.Items[0].Provider != "CODEX" {
		t.Fatalf("observed child identity missing: %+v", page)
	}
	detail, err := s.Trace(context.Background(), page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Trace.SessionID != "session-a" {
		t.Fatal("detail summary lost observed identity")
	}
	found := false
	for _, span := range detail.Spans {
		if span.SpanID == request.id {
			found = true
			if span.Name != "http.request" || span.SessionID != "" {
				t.Fatal("summary changed recorded root span")
			}
		}
	}
	if !found {
		t.Fatal("root span missing")
	}
}
