package workspacechat

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
	"go.opentelemetry.io/otel/trace"
)

func chatDiagnostics(t *testing.T, s *Service) *diagnostics.Service {
	t.Helper()
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "telemetry.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { recorder.Close() })
	s.ConfigureDiagnostics(recorder)
	return recorder
}
func TestChatCloseWaitsForDiagnosticFinalization(t *testing.T) {
	runner := &recordingRunner{block: make(chan struct{}), started: make(chan struct{}, 1)}
	s, _, pid, _ := fixture(t, runner)
	recorder := chatDiagnostics(t, s)
	sess, err := s.Create(context.Background(), pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(context.Background(), pid, sess.ID, SendRequest{ClientMessageID: "close", Text: "private"}); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	value, ok := s.diagnosticTurns.Load(sess.ID)
	if !ok {
		t.Fatal("missing active diagnostic turn")
	}
	current := value.(*diagnosticTurn)
	current.mu.Lock()
	locked := true
	defer func() {
		if locked {
			current.mu.Unlock()
		}
	}()
	returned := make(chan struct{})
	go func() { s.Close(); close(returned) }()
	deadline := time.After(2 * time.Second)
	for {
		if _, active := s.diagnosticTurns.Load(sess.ID); !active {
			break
		}
		select {
		case <-deadline:
			t.Fatal("turn did not reach finalization")
		case <-time.After(time.Millisecond):
		}
	}
	select {
	case <-returned:
		t.Fatal("Close returned before diagnostic finalization")
	case <-time.After(50 * time.Millisecond):
	}
	current.mu.Unlock()
	locked = false
	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not finish")
	}
	if err = recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{})
	if err != nil || page.Total != 1 || page.Items[0].Status == "running" {
		t.Fatalf("final outcome lost: %+v %v", page, err)
	}
}

func TestNativeToolCallbackCannotReviveClearedTrace(t *testing.T) {
	s, _, _, pid := nativeFixture(t)
	recorder := chatDiagnostics(t, s)
	current := s.beginDiagnosticTurn(context.Background(), Session{ID: "callback", ProjectID: pid, Provider: "CODEX"}, agents.TurnRequest{SessionID: "run"})
	defer s.endDiagnosticTurn("callback", current, "unknown")
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := recorder.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	called := false
	execute := s.diagnosticToolExecutor("callback", func(ctx context.Context, _ string, _ map[string]any) map[string]any {
		called = true
		if ctx.Err() != context.Canceled {
			t.Fatal("invocation cancellation was lost")
		}
		return map[string]any{"success": true}
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	execute(ctx, "private tool", map[string]any{"secret": "never persisted"})
	if !called {
		t.Fatal("telemetry changed tool execution")
	}
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{})
	if err != nil || page.Total != 0 {
		t.Fatalf("callback revived cleared history: %+v %v", page, err)
	}
}
func TestChatDiagnosticsKeepsHTTPParentWithoutRequestCancellation(t *testing.T) {
	runner := &recordingRunner{output: "PRIVATE_RESPONSE", block: make(chan struct{}), started: make(chan struct{}, 1)}
	s, _, pid, _ := fixture(t, runner)
	recorder := chatDiagnostics(t, s)
	sess, err := s.Create(context.Background(), pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	parent, httpSpan := recorder.Start(context.Background(), "http.request", diagnostics.Fields{})
	traceID := trace.SpanContextFromContext(parent).TraceID().String()
	ctx, cancel := context.WithCancel(parent)
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "one", Text: "PRIVATE_PROMPT"}); err != nil {
		t.Fatal(err)
	}
	<-runner.started
	cancel()
	httpSpan.End("ok")
	close(runner.block)
	d := awaitIdle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" {
		t.Fatalf("request cancellation stopped async turn: %+v", d.Session)
	}
	s.Close()
	recorder.Flush(context.Background())
	detail, err := recorder.Trace(context.Background(), traceID)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]diagnostics.SpanRecord{}
	for _, span := range detail.Spans {
		names[span.Name] = span
	}
	if len(names) != 3 || names["chat.turn"].ParentSpanID != names["http.request"].SpanID || names["provider.turn"].ParentSpanID != names["chat.turn"].SpanID || names["chat.turn"].Status != "ok" {
		t.Fatalf("trace %+v", detail)
	}
	raw, _ := json.Marshal(detail)
	if strings.Contains(string(raw), "PRIVATE_") {
		t.Fatalf("content leaked: %s", raw)
	}
}

type diagnosticNativeRegistry struct{ fakeNativeRegistry }

type failedDiagnosticNativeRegistry struct{ fakeNativeRegistry }

func (r *failedDiagnosticNativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, _ agents.TurnRequest, _ string, _ agents.NativeEventHandler) (agents.NativeSession, error) {
	return &failedDiagnosticNative{}, nil
}

type failedDiagnosticNative struct{ fakeNative }

func (n *failedDiagnosticNative) SendTurn(context.Context, string, string) (agents.NativeTurnResult, error) {
	return agents.NativeTurnResult{TurnID: "failed-turn", Status: "failed"}, nil
}

func (n *failedDiagnosticNative) SendTurnWithOptions(ctx context.Context, text string, options agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	return n.SendTurn(ctx, text, options.Model)
}

func TestNativeDiagnosticsReportsExplicitProviderFailure(t *testing.T) {
	s, _, _, pid := nativeFixture(t)
	s.registry = &failedDiagnosticNativeRegistry{}
	recorder := chatDiagnostics(t, s)
	sess, err := s.Create(context.Background(), pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(context.Background(), pid, sess.ID, SendRequest{ClientMessageID: "failed", Text: "private prompt"}); err != nil {
		t.Fatal(err)
	}
	detail := awaitIdle(t, s, pid, sess.ID)
	if detail.Session.Status != "failed" {
		t.Fatalf("session outcome: %s", detail.Session.Status)
	}
	s.Close()
	if err = recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{Status: "error"})
	if err != nil || page.Total != 1 {
		t.Fatalf("explicit failed turn must be error, not unknown: %+v %v", page, err)
	}
}

func (r *diagnosticNativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, _ agents.TurnRequest, _ string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.starts = append(r.starts, "start")
	return &diagnosticNative{handler: h}, nil
}

type diagnosticNative struct {
	fakeNative
	handler agents.NativeEventHandler
	turn    int
}

func (n *diagnosticNative) SendTurn(ctx context.Context, _, _ string) (agents.NativeTurnResult, error) {
	n.turn++
	id := []string{"", "first-turn", "second-turn"}[n.turn]
	n.handler(agents.NativeEvent{Type: "turn/started", TurnID: id})
	if n.turn == 2 {
		n.handler(agents.NativeEvent{Type: "item/started", TurnID: "first-turn", ItemID: "late", Payload: json.RawMessage(`{"item":{"id":"late","type":"commandExecution"}}`)})
	}
	n.handler(agents.NativeEvent{Type: "item/started", TurnID: id, ItemID: "tool", Payload: json.RawMessage(`{"item":{"id":"tool","type":"commandExecution","command":"SECRET_COMMAND"}}`)})
	n.handler(agents.NativeEvent{Type: "item/completed", TurnID: id, ItemID: "tool", Payload: json.RawMessage(`{"item":{"id":"tool","type":"commandExecution","status":"completed","output":"SECRET_OUTPUT"}}`)})
	n.handler(agents.NativeEvent{Type: "thread/tokenUsage/updated", TurnID: id, Usage: &agents.NativeUsage{Last: agents.TokenUsage{InputTokens: 10, OutputTokens: 12}}})
	n.handler(agents.NativeEvent{Type: "turn/completed", TurnID: id, Payload: json.RawMessage(`{"turn":{"status":"completed"}}`)})
	return agents.NativeTurnResult{TurnID: id, Status: "completed"}, nil
}
func (n *diagnosticNative) SendTurnWithOptions(ctx context.Context, text string, v agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	return n.SendTurn(ctx, text, v.Model)
}
func TestNativeDiagnosticsReuseCurrentTurnAndRejectLateItems(t *testing.T) {
	s, _, _, pid := nativeFixture(t)
	r := &diagnosticNativeRegistry{}
	s.registry = r
	recorder := chatDiagnostics(t, s)
	sess, err := s.Create(context.Background(), pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		if _, err = s.Send(context.Background(), pid, sess.ID, SendRequest{ClientMessageID: id, Text: "SECRET_PROMPT"}); err != nil {
			t.Fatal(err)
		}
		awaitIdle(t, s, pid, sess.ID)
	}
	s.Close()
	recorder.Flush(context.Background())
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(r.starts) != 1 {
		t.Fatalf("trace/process count %+v %+v", page, r.starts)
	}
	for _, summary := range page.Items {
		detail, err := recorder.Trace(context.Background(), summary.TraceID)
		if err != nil {
			t.Fatal(err)
		}
		tools, usage := 0, 0
		for _, span := range detail.Spans {
			if span.Name == "provider.tool" {
				tools++
				if span.Status != "ok" || span.EndTime == nil {
					t.Fatalf("tool lifetime %+v", span)
				}
			}
			if span.InputTokens != nil {
				usage++
				if *span.InputTokens != 10 || *span.OutputTokens != 12 {
					t.Fatalf("usage %+v", span)
				}
			}
		}
		if tools != 1 || usage != 1 {
			t.Fatalf("current turn correlation: %+v", detail)
		}
		raw, _ := json.Marshal(detail)
		if strings.Contains(string(raw), "SECRET_") {
			t.Fatalf("leaked %s", raw)
		}
	}
	overview, err := recorder.Overview(context.Background(), diagnostics.Filter{})
	if err != nil || len(overview.Usage) != 1 || overview.Usage[0].KnownRuns != 2 || overview.Usage[0].InputTokens != 20 {
		t.Fatalf("usage overview %+v %v", overview, err)
	}
}
