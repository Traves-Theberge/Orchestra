package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A separate OS process speaks the protocol; it never executes provider inference.
func TestNativeFixtureProcess(t *testing.T) {
	if os.Getenv("ORCHESTRA_NATIVE_FIXTURE") != "1" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	scan := bufio.NewScanner(os.Stdin)
	turn := 0
	thread := "thread-fixture"
	send := func(v any) { b, _ := json.Marshal(v); fmt.Println(string(b)) }
	event := func(method string, p any) { send(map[string]any{"method": method, "params": p}) }
	complete := func(status string) {
		event("turn/completed", map[string]any{"threadId": thread, "turn": map[string]string{"id": fmt.Sprintf("turn-%d", turn), "status": status}})
	}
	for scan.Scan() {
		var msg nativeRPC
		_ = json.Unmarshal(scan.Bytes(), &msg)
		if strings.HasPrefix(mode, "catalog") {
			f, _ := os.OpenFile("protocol-methods.txt", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if f != nil {
				_, _ = fmt.Fprintln(f, msg.Method)
				_ = f.Close()
			}
		}
		response := func(v any) { send(map[string]any{"id": msg.ID, "result": v}) }
		switch msg.Method {
		case "initialize":
			if mode == "initialize-eof" {
				os.Exit(0)
			}
			response(map[string]bool{"ok": true})
		case "thread/start", "thread/resume":
			if strings.HasPrefix(mode, "catalog") {
				os.Exit(4)
			}
			var p map[string]any
			_ = json.Unmarshal(msg.Params, &p)
			if msg.Method == "thread/resume" {
				thread = p["threadId"].(string)
			}
			if mode == "bad-resume" {
				thread = "wrong-thread"
			}
			response(map[string]any{"thread": map[string]string{"id": thread}, "model": "observed-fixture-model", "reasoningEffort": "medium", "approvalPolicy": "on-request", "sandbox": map[string]string{"type": "workspaceWrite"}})
		case "turn/start":
			if mode == "effort" {
				f, _ := os.OpenFile("turn-params.jsonl", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
				if f != nil {
					_, _ = fmt.Fprintln(f, string(msg.Params))
					_ = f.Close()
				}
			}
			turn++
			if mode == "eof" {
				os.Exit(0)
			}
			response(map[string]any{"turn": map[string]string{"id": fmt.Sprintf("turn-%d", turn)}})
			p := map[string]any{"threadId": thread, "turnId": fmt.Sprintf("turn-%d", turn), "itemId": "item-a"}
			event("turn/completed", map[string]any{"threadId": thread, "turn": map[string]string{"id": "stale-turn", "status": "completed"}})
			switch mode {
			case "interrupt", "cancel":
				event("turn/started", map[string]any{"threadId": thread, "turn": map[string]string{"id": fmt.Sprintf("turn-%d", turn)}})
			case "approval", "question":
				method := "item/commandExecution/requestApproval"
				if mode == "question" {
					method = "item/tool/requestUserInput"
					p["questions"] = []map[string]string{{"id": "choice", "question": "Which?"}}
				}
				send(map[string]any{"id": "provider-request", "method": method, "params": p})
			default:
				p["delta"] = fmt.Sprintf("answer-%d", turn)
				event("item/agentMessage/delta", p)
				usage := map[string]int64{"inputTokens": 20, "outputTokens": 8, "totalTokens": 28, "cachedInputTokens": 6, "cacheWriteInputTokens": 2, "reasoningOutputTokens": 3}
				event("thread/tokenUsage/updated", map[string]any{"threadId": thread, "turnId": fmt.Sprintf("turn-%d", turn), "tokenUsage": map[string]any{"last": usage, "total": usage, "modelContextWindow": 10000}})
				complete("completed")
				if mode == "late" || mode == "late-reentrant" {
					time.Sleep(30 * time.Millisecond)
					lateUsage := map[string]int64{"inputTokens": 100, "outputTokens": 23, "totalTokens": 123, "cachedInputTokens": 8, "cacheWriteInputTokens": 2, "reasoningOutputTokens": 3}
					late := map[string]any{"threadId": thread, "turnId": fmt.Sprintf("turn-%d", turn), "tokenUsage": map[string]any{"last": lateUsage, "total": lateUsage}}
					late["threadId"] = "foreign-thread"
					event("thread/tokenUsage/updated", late)
					late["threadId"] = thread
					late["turnId"] = "unknown-turn"
					event("thread/tokenUsage/updated", late)
					late["turnId"] = fmt.Sprintf("turn-%d", turn)
					event("thread/tokenUsage/updated", late)
					if turn == 1 {
						for i := 0; i < 600; i++ {
							event("thread/status/changed", map[string]any{"threadId": thread, "status": map[string]string{"type": "idle"}})
						}
					}
				}
			}
		case "model/list":
			if mode == "catalog-eof" {
				os.Exit(0)
			}
			if mode == "catalog-malformed" {
				response(map[string]any{})
				continue
			}
			if strings.HasPrefix(mode, "catalog") {
				var params map[string]any
				_ = json.Unmarshal(msg.Params, &params)
				if params["includeHidden"] != false {
					os.Exit(5)
				}
				next := any(nil)
				name := "fixture-model"
				if params["cursor"] != nil {
					name = "fixture-model-next"
				}
				if mode == "catalog-paged" && params["cursor"] == nil || mode == "catalog-loop" {
					next = "next-page"
				}
				response(map[string]any{"data": []map[string]any{{"id": name, "model": name, "displayName": "Fixture model", "description": "Catalog-only", "isDefault": true, "defaultReasoningEffort": "medium", "supportedReasoningEfforts": []map[string]string{{"reasoningEffort": "medium", "description": "Balanced"}}, "inputModalities": []string{"text"}}}, "nextCursor": next})
				continue
			}
			response(map[string]any{"data": []map[string]string{{"id": "fixture-model", "model": "fixture-model", "displayName": "Fixture model"}}, "nextCursor": nil})
		case "turn/interrupt":
			response(map[string]any{})
			complete("interrupted")
		case "":
			if string(msg.ID) == `"provider-request"` {
				if len(msg.Error) > 0 {
					os.Exit(2)
				}
				complete("completed")
			}
		}
	}
	os.Exit(0)
}

func nativeFixture(t *testing.T, mode, thread string, on NativeEventHandler) (NativeSession, error) {
	t.Helper()
	command := nativeFixtureCommand(t, mode)
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	session, err := NewCodexNativeSession(ctx, command, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true}, thread, on)
	if session != nil {
		t.Cleanup(func() { _ = session.Close(); drainNativeEvents(t, session) })
	}
	return session, err
}
func nativeFixtureCommand(t *testing.T, mode string) string {
	t.Helper()
	t.Setenv("ORCHESTRA_NATIVE_FIXTURE", "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := "'" + strings.ReplaceAll(filepath.ToSlash(exe), "'", "'\"'\"'") + "' -test.run=^TestNativeFixtureProcess$ -- " + mode
	return command
}
func TestNativeTwoTurnsSameProcessThreadAndStaleFence(t *testing.T) {
	var events []NativeEvent
	s, err := nativeFixture(t, "normal", "", func(e NativeEvent) { events = append(events, e) })
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		r, err := s.SendTurn(context.Background(), "hello", "")
		if err != nil {
			t.Fatal(err)
		}
		if r.TurnID != fmt.Sprintf("turn-%d", i) || r.Text != fmt.Sprintf("answer-%d", i) || r.Status != "completed" {
			t.Fatalf("wrong turn %+v", r)
		}
		drainNativeEvents(t, s)
	}
	if s.ThreadID() != "thread-fixture" || s.ModelInfo().Model != "observed-fixture-model" {
		t.Fatal("missing observed identity")
	}
	usageEvents := 0
	for _, e := range events {
		if e.TurnID == "stale-turn" {
			t.Fatal("stale event escaped fence")
		}
		if e.Type == "thread/tokenUsage/updated" {
			usageEvents++
			if e.Usage == nil || e.Usage.Last.CacheReadTokens != 6 || e.Usage.Last.CacheWriteTokens != 2 || e.Usage.Last.ThinkingTokens != 3 || e.Usage.Total.TotalTokens != 28 || *e.Usage.ModelContextWindow != 10000 {
				t.Fatalf("bad usage %+v", e.Usage)
			}
		}
	}
	if usageEvents != 2 {
		t.Fatalf("missing usage events %d", usageEvents)
	}
	models, err := s.(NativeModelCatalogProvider).ListModels(context.Background())
	if err != nil || !strings.Contains(string(models), "fixture-model") {
		t.Fatalf("bad catalog %s %v", models, err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SendTurn(context.Background(), "after close", ""); err == nil {
		t.Fatal("closed session accepted turn")
	}
}
func TestNativeResumeAndMismatch(t *testing.T) {
	s, err := nativeFixture(t, "normal", "saved-thread", nil)
	if err != nil {
		t.Fatal(err)
	}
	if s.ThreadID() != "saved-thread" {
		t.Fatal(s.ThreadID())
	}
	if _, err = s.SendTurn(context.Background(), "resume", ""); err != nil {
		t.Fatal(err)
	}
	if s, err = nativeFixture(t, "bad-resume", "saved-thread", nil); err == nil || s != nil {
		t.Fatal("wrong resume accepted")
	}
}
func TestNativeApprovalAndQuestionReplies(t *testing.T) {
	for _, mode := range []string{"approval", "question"} {
		t.Run(mode, func(t *testing.T) {
			var s NativeSession
			var callbackErr error
			s, err := nativeFixture(t, mode, "", func(e NativeEvent) {
				if e.Type != "server_request" {
					return
				}
				if err := s.RespondRequest(context.Background(), e.RequestID, json.RawMessage(`{"decision":"invalid"}`)); err == nil {
					callbackErr = fmt.Errorf("invalid answer accepted")
				}
				answer := json.RawMessage(`{"decision":"decline"}`)
				if mode == "question" {
					answer = json.RawMessage(`{"answers":{"choice":{"answers":["selected"]}}}`)
				}
				if err := s.RespondRequest(context.Background(), e.RequestID, answer); err != nil {
					callbackErr = err
				}
				if err := s.RespondRequest(context.Background(), e.RequestID, answer); err == nil {
					callbackErr = fmt.Errorf("duplicate reply accepted")
				}
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.SendTurn(context.Background(), "prompt", ""); err != nil {
				t.Fatal(err)
			}
			drainNativeEvents(t, s)
			if callbackErr != nil {
				t.Fatal(callbackErr)
			}
		})
	}
}
func TestNativeInterruptKeepsThreadReusable(t *testing.T) {
	var s NativeSession
	var interruptErr error
	s, err := nativeFixture(t, "interrupt", "", func(e NativeEvent) {
		if e.Type == "turn/started" {
			interruptErr = s.Interrupt(context.Background())
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		r, err := s.SendTurn(context.Background(), "wait", "")
		drainNativeEvents(t, s)
		if err != nil || interruptErr != nil || r.Status != "interrupted" {
			t.Fatalf("interrupt %+v %v %v", r, err, interruptErr)
		}
	}
}
func drainNativeEvents(t *testing.T, s NativeSession) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if drain, ok := s.(interface{ DrainEvents(context.Context) error }); ok {
		if err := drain.DrainEvents(ctx); err != nil {
			t.Fatal(err)
		}
	}
}
func TestNativeEOFAndCancellationReap(t *testing.T) {
	for _, mode := range []string{"initialize-eof", "eof", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			s, err := nativeFixture(t, mode, "", nil)
			if mode == "initialize-eof" {
				if err == nil || s != nil {
					t.Fatal("EOF accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			if _, err = s.SendTurn(ctx, "hello", ""); err == nil {
				t.Fatal("failure accepted")
			}
			start := time.Now()
			_ = s.Close()
			if time.Since(start) > 3*time.Second {
				t.Fatal("process was not promptly reaped")
			}
		})
	}
}
func TestNativeRegistryCapability(t *testing.T) {
	batch := "codex exec --dangerously-bypass-approvals-and-sandbox {{prompt}}"
	r := NewRegistry(map[string]string{"CODEX": batch, "CLAUDE": "claude"})
	if !r.SupportsNativeSession(ProviderCodex) || r.SupportsNativeSession(ProviderClaude) {
		t.Fatal("bad capabilities")
	}
	if _, err := r.StartNativeSession(context.Background(), ProviderClaude, TurnRequest{}, "", nil); err == nil {
		t.Fatal("unsupported provider accepted")
	}
	if command, _ := r.NativeCommandFor(ProviderCodex); command != "codex app-server" {
		t.Fatalf("native inherited unsafe batch command %q", command)
	}
	if command, _ := r.CommandFor(ProviderCodex); command != batch {
		t.Fatal("batch semantics changed")
	}
	r.SetNativeCommand(ProviderCodex, "custom-native app-server")
	if command, _ := r.NativeCommandFor(ProviderCodex); command != "custom-native app-server" {
		t.Fatal("custom native override missing")
	}
	r.SetNativeCommand(ProviderCodex, "")
	r.SetCommand(ProviderCodex, "codex app-server --dangerously-bypass-approvals-and-sandbox")
	if r.SupportsNativeSession(ProviderCodex) {
		t.Fatal("batch command re-enabled explicitly disabled native capability")
	}
}
