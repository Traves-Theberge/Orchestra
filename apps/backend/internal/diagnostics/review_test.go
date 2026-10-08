package diagnostics

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestLegacyMetricsMigrationPreservesUnknownModel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "diagnostics.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE metrics (bucket_ns INTEGER NOT NULL,name TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,count INTEGER NOT NULL,errors INTEGER NOT NULL,duration_ms REAL NOT NULL,input_tokens INTEGER,output_tokens INTEGER,known_runs INTEGER NOT NULL,PRIMARY KEY(bucket_ns,name,provider,status)); PRAGMA user_version=1;`)
	if err == nil {
		_, err = db.Exec(`INSERT INTO metrics VALUES(?,?,?,'ok',1,0,2,10,5,1)`, time.Now().Truncate(time.Hour).UnixNano(), "provider.call", "CODEX")
	}
	_ = db.Close()
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, span := s.Start(context.Background(), "provider.call", Fields{Provider: "CODEX", Model: "model-a"})
	span.Usage(20, 10)
	span.End("ok")
	flushTest(t, s)
	out, err := s.Overview(context.Background(), Filter{})
	if err != nil || len(out.Usage) != 2 || out.Usage[0].Model != "" || out.Usage[0].InputTokens != 10 || out.Usage[1].Model != "model-a" || out.Usage[1].InputTokens != 20 {
		t.Fatalf("migration lost evidence: %+v %v", out.Usage, err)
	}
	var version int
	if err = s.store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 2 {
		t.Fatalf("migration version %d %v", version, err)
	}
}

func TestClearFencesPendingUncertainty(t *testing.T) {
	s := openTest(t, Options{})
	_, old := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	// Simulate the separate terminal-loss lane after a persisted start.
	s.markUncertain(write{generation: old.generation, span: &SpanRecord{SpanID: old.id}, final: true})
	s.uncertainAll.Store(old.generation)
	if err := s.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, fresh := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	page, err := s.ListTraces(context.Background(), Filter{})
	if err != nil || page.Total != 1 || page.Items[0].Status != "running" {
		t.Fatalf("stale uncertainty crossed fence: %+v %v", page, err)
	}
	fresh.End("ok")
	flushTest(t, s)
}

func TestTerminalLossReconciliationLaneIsBounded(t *testing.T) {
	s := openTest(t, Options{QueueSize: 1})
	_, span := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	for i := 0; i < 10000; i++ {
		s.markUncertain(write{generation: span.generation, span: &SpanRecord{SpanID: span.id}, final: true})
	}
	if len(s.uncertain) > 1 {
		t.Fatal("unbounded terminal-loss lane")
	}
	flushTest(t, s)
	detail, err := s.Trace(context.Background(), span.traceID)
	if err != nil || detail.Trace.Status != "unknown" || !detail.Partial || detail.Trace.EndTime != nil {
		t.Fatalf("overflow uncertainty: %+v %v", detail, err)
	}
}

func TestUncertaintyBeforeQueuedStartIsPreserved(t *testing.T) {
	s := openTest(t, Options{QueueSize: 2})
	r := SpanRecord{TraceID: "00000000000000000000000000000001", SpanID: "0000000000000001", Name: "task.run", StartTime: time.Now(), Status: "running"}
	s.dbMu.Lock()
	s.markUncertain(write{generation: s.generation.Load(), span: &r, final: true})
	err := s.reconcileLocked()
	if err == nil {
		err = s.store.write(write{span: &r})
	}
	if err == nil {
		err = s.reconcileLocked()
	}
	s.dbMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.Trace(context.Background(), r.TraceID)
	if err != nil || detail.Trace.Status != "unknown" || !detail.Partial {
		t.Fatalf("queued start lost uncertainty: %+v %v", detail, err)
	}
}

func TestFailedClearPreservesActiveCompletion(t *testing.T) {
	for _, mode := range []string{"cancelled", "read-only"} {
		t.Run(mode, func(t *testing.T) {
			s := openTest(t, Options{})
			_, span := s.Start(context.Background(), "task.run", Fields{})
			flushTest(t, s)
			ctx := context.Background()
			if mode == "cancelled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			} else if _, err := s.store.db.Exec(`PRAGMA query_only=ON`); err != nil {
				t.Fatal(err)
			}
			if err := s.Clear(ctx); err == nil {
				t.Fatal("expected failed clear")
			}
			if mode == "read-only" {
				if _, err := s.store.db.Exec(`PRAGMA query_only=OFF`); err != nil {
					t.Fatal(err)
				}
			}
			span.Event("operation.finished", "info")
			span.End("ok")
			flushTest(t, s)
			detail, err := s.Trace(context.Background(), span.traceID)
			if err != nil || detail.Trace.Status != "ok" || detail.Spans[0].EndTime == nil || len(detail.Logs) != 1 {
				t.Fatalf("failed clear invalidated live recorder: %+v %v", detail, err)
			}
		})
	}
}

func TestDisablePublishesSettingsAndGenerationTogether(t *testing.T) {
	s := openTest(t, Options{})
	settings := s.settings
	settings.Enabled = false
	generation := s.generation.Load()

	// Keep the settings publication blocked after its database transaction. A
	// pending writer excludes new readers, so TryRLock identifies that boundary
	// without sleeps or a production-only synchronization hook.
	s.settingsMu.RLock()
	updated := make(chan error, 1)
	go func() { updated <- s.UpdateSettings(context.Background(), settings) }()
	deadline := time.Now().Add(5 * time.Second)
	for s.settingsMu.TryRLock() {
		s.settingsMu.RUnlock()
		if time.Now().After(deadline) {
			s.settingsMu.RUnlock()
			t.Fatal("disable did not reach settings publication")
		}
		runtime.Gosched()
	}
	if got := s.generation.Load(); got != generation {
		t.Errorf("disable exposed generation %d while settings still enabled; want %d", got, generation)
	}
	started := make(chan *Span, 1)
	go func() {
		_, span := s.Start(context.Background(), "task.run", Fields{})
		started <- span
	}()
	s.settingsMu.RUnlock()
	if err := <-updated; err != nil {
		t.Fatal(err)
	}
	span := <-started
	span.Event("operation.finished", "info")
	span.End("ok")
	flushTest(t, s)
	page, err := s.ListTraces(context.Background(), Filter{})
	if err != nil || page.Total != 0 {
		t.Fatalf("start behind disable recorded a trace: %+v %v", page, err)
	}
	if got := s.generation.Load(); got != generation+1 {
		t.Fatalf("disable generation = %d, want %d", got, generation+1)
	}
}

func TestLogSeverityFiltersBeforePagination(t *testing.T) {
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "task.run", Fields{})
	span.Event("operation.failed", "error")
	span.Event("operation.ready", "info")
	span.Event("operation.ready", "info")
	span.End("ok")
	flushTest(t, s)
	page, err := s.Logs(context.Background(), Filter{Severity: "error", Limit: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].Severity != "error" {
		t.Fatalf("severity page: %+v %v", page, err)
	}
	if _, err = s.Logs(context.Background(), Filter{Severity: "invented"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid severity: %v", err)
	}
}

func TestUsageSeparatesModelsAndSurvivesDetailRetention(t *testing.T) {
	s := openTest(t, Options{})
	for _, model := range []string{"model-a", "model-b"} {
		_, span := s.Start(context.Background(), "provider.call", Fields{Provider: "CODEX", Model: model})
		span.Usage(10, 5)
		span.End("ok")
	}
	flushTest(t, s)
	if _, err := s.store.db.Exec(`DELETE FROM spans`); err != nil {
		t.Fatal(err)
	}
	out, err := s.Overview(context.Background(), Filter{})
	if err != nil || len(out.Usage) != 2 {
		t.Fatalf("model usage: %+v %v", out.Usage, err)
	}
	if out.Usage[0].Model != "model-a" || out.Usage[1].Model != "model-b" || out.Usage[0].InputTokens != 10 || out.Usage[1].InputTokens != 10 {
		t.Fatal(out.Usage)
	}
}

func TestTraceOutcomeUsesOperationAuthority(t *testing.T) {
	for _, tc := range []struct{ name, root, operation, outcome string }{{"successful retry", "task.run", "provider.call", "ok"}, {"instrumented task retry", "task.attempt", "provider.call", "ok"}, {"detached chat failure", "http.request", "chat.turn", "error"}} {
		t.Run(tc.name, func(t *testing.T) {
			s := openTest(t, Options{})
			ctx, root := s.Start(context.Background(), tc.root, Fields{})
			_, failed := s.Start(ctx, tc.operation, Fields{})
			failed.Event("operation.failed", "error")
			failed.End("error")
			if tc.outcome == "ok" {
				_, retry := s.Start(ctx, tc.operation, Fields{Attempt: 2})
				retry.End("ok")
			}
			root.End("ok")
			flushTest(t, s)
			page, err := s.ListTraces(context.Background(), Filter{Status: tc.outcome})
			if err != nil || page.Total != 1 {
				t.Fatalf("authoritative outcome: %+v %v", page, err)
			}
			logs, err := s.Logs(context.Background(), Filter{Status: tc.outcome})
			if err != nil || logs.Total != 1 {
				t.Fatalf("logs outcome: %+v %v", logs, err)
			}
			other := "ok"
			if tc.outcome == "ok" {
				other = "error"
			}
			logs, err = s.Logs(context.Background(), Filter{Status: other})
			if err != nil || logs.Total != 0 {
				t.Fatalf("logs matched child rather than outcome: %+v %v", logs, err)
			}
		})
	}
}

func TestDroppedTerminalReconcilesPersistedStart(t *testing.T) {
	s := openTest(t, Options{QueueSize: 1})
	_, span := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	s.dbMu.Lock()
	span.Event("operation.ready", "info")
	deadline := time.Now().Add(time.Second)
	for len(s.queue) != 0 && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	if len(s.queue) != 0 {
		s.dbMu.Unlock()
		t.Fatal("consumer did not receive blocking write")
	}
	span.Event("operation.queued", "info")
	span.End("ok")
	s.dbMu.Unlock()
	flushTest(t, s)
	detail, err := s.Trace(context.Background(), span.traceID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Trace.Status != "unknown" || !detail.Partial || detail.Spans[0].EndTime != nil || detail.Trace.EndTime != nil {
		t.Fatalf("lost completion reported active or fabricated end: %+v", detail)
	}
}

func TestStoreFailureReconcilesPersistedStartAfterRecovery(t *testing.T) {
	s := openTest(t, Options{})
	_, span := s.Start(context.Background(), "task.run", Fields{})
	flushTest(t, s)
	if _, err := s.store.db.Exec(`PRAGMA query_only=ON`); err != nil {
		t.Fatal(err)
	}
	span.End("ok")
	if err := s.Flush(context.Background()); err == nil {
		t.Fatal("expected write failure")
	}
	if _, err := s.store.db.Exec(`PRAGMA query_only=OFF`); err != nil {
		t.Fatal(err)
	}
	flushTest(t, s)
	detail, err := s.Trace(context.Background(), span.traceID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Trace.Status != "unknown" || !detail.Partial || detail.Spans[0].EndTime != nil {
		t.Fatalf("failed completion remains active: %+v", detail)
	}
}
