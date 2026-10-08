package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// This helper is a subprocess fixture for omp's `--mode rpc` protocol, using
// the event shapes recorded from omp 18.7.0. It never runs omp or inference.
func TestOMPRPCFixtureProcess(t *testing.T) {
	if os.Getenv("ORCHESTRA_OMP_FIXTURE") != "1" {
		return
	}
	verifyNativeFixtureConsole()
	args := strings.Join(os.Args, " ")
	if !strings.Contains(args, "--mode rpc") {
		os.Exit(2)
	}
	if resume := os.Getenv("ORCHESTRA_OMP_FIXTURE_RESUME"); resume != "" && !strings.Contains(args, "--resume "+resume) {
		os.Exit(3)
	}
	session := os.Getenv("ORCHESTRA_OMP_FIXTURE_SESSION")
	if session == "" {
		session = "omp-fixture-session"
	}
	var writeMu sync.Mutex
	send := func(v any) {
		raw, _ := json.Marshal(v)
		writeMu.Lock()
		fmt.Println(string(raw))
		writeMu.Unlock()
	}
	send(map[string]any{"type": "ready", "protocolVersion": 1})
	send(map[string]any{"type": "extension_ui_request", "id": "widget", "method": "setWidget", "widgetKey": "noise"})
	model := map[string]any{"id": "m1", "provider": "prov", "contextWindow": 1000}
	turns := 0
	dialogs := make(chan map[string]any, 1)
	aborts := make(chan struct{}, 1)
	scanner := bufio.NewScanner(os.Stdin)
	lines := make(chan map[string]any)
	go func() {
		for scanner.Scan() {
			var command map[string]any
			if json.Unmarshal(scanner.Bytes(), &command) != nil {
				os.Exit(4)
			}
			switch command["type"] {
			case "extension_ui_response":
				dialogs <- command
			case "abort":
				send(map[string]any{"id": command["id"], "type": "response", "command": "abort", "success": true})
				aborts <- struct{}{}
			default:
				lines <- command
			}
		}
		os.Exit(0)
	}()
	for command := range lines {
		id := command["id"]
		respond := func(data any) {
			send(map[string]any{"id": id, "type": "response", "command": command["type"], "success": true, "data": data})
		}
		switch command["type"] {
		case "get_state":
			respond(map[string]any{"model": model, "thinkingLevel": "low", "sessionId": session})
		case "set_model":
			model = map[string]any{"id": command["modelId"], "provider": command["provider"], "contextWindow": 2000}
			respond(model)
		case "set_thinking_level":
			respond(nil)
		case "prompt":
			respond(nil)
			turns++
			message, _ := command["message"].(string)
			update := func(event map[string]any) {
				send(map[string]any{"type": "message_update", "assistantMessageEvent": event})
			}
			send(map[string]any{"type": "agent_start"})
			send(map[string]any{"type": "message_start", "message": map[string]any{"role": "user", "content": []any{}}})
			send(map[string]any{"type": "message_start", "message": map[string]any{"role": "assistant", "content": []any{}}})
			update(map[string]any{"type": "thinking_start", "contentIndex": 0})
			update(map[string]any{"type": "thinking_delta", "contentIndex": 0, "delta": "Planning"})
			update(map[string]any{"type": "thinking_end", "contentIndex": 0, "content": "Planning"})
			send(map[string]any{"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "bash", "args": map[string]any{"command": "echo hi"}})
			send(map[string]any{"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "bash", "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": "hi"}}}, "isError": false})
			reply := fmt.Sprintf("turn-%d", turns)
			status := "completed"
			if strings.Contains(message, "approve") {
				send(map[string]any{"type": "extension_ui_request", "id": "dialog-1", "method": "select", "title": "Allow tool: bash\nCommand: echo hi", "options": []string{"Approve", "Deny"}})
				answer := <-dialogs
				if answer["id"] != "dialog-1" {
					os.Exit(5)
				}
				reply = fmt.Sprintf("answer-%v", answer["value"])
			}
			if strings.Contains(message, "hang") {
				<-aborts
				status = "aborted"
				reply = "partial"
			}
			update(map[string]any{"type": "text_start", "contentIndex": 1})
			update(map[string]any{"type": "text_delta", "contentIndex": 1, "delta": reply})
			update(map[string]any{"type": "text_end", "contentIndex": 1, "content": reply})
			send(map[string]any{"type": "message_end", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": reply}}, "provider": model["provider"], "model": model["id"], "stopReason": "stop", "usage": map[string]any{"input": 10, "output": 2, "cacheRead": 3, "cacheWrite": 0, "totalTokens": 15, "reasoningTokens": 1}}})
			send(map[string]any{"type": "agent_end", "messages": []any{}})
			send(map[string]any{"type": "prompt_result", "id": id, "agentInvoked": true, "status": status, "sessionSettled": true})
			send(map[string]any{"type": "session_settled"})
		default:
			send(map[string]any{"id": id, "type": "response", "command": command["type"], "success": false, "error": "Unknown command"})
		}
	}
}

func ompFixture(t *testing.T) (string, []string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return exe, []string{"-test.run=^TestOMPRPCFixtureProcess$", "--"}
}

type ompEventLog struct {
	mu     sync.Mutex
	events []NativeEvent
}

func (l *ompEventLog) add(e NativeEvent) {
	l.mu.Lock()
	l.events = append(l.events, e)
	l.mu.Unlock()
}

func (l *ompEventLog) types() map[string]int {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := map[string]int{}
	for _, e := range l.events {
		out[e.Type]++
	}
	return out
}

func startOMPFixture(t *testing.T, sessionID string, log *ompEventLog, env ...string) *OMPNativeSession {
	t.Helper()
	command, prefix := ompFixture(t)
	workspace := t.TempDir()
	request := TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, SessionID: "fixture"}
	// The constructor context owns the process lifetime, as in production.
	session, err := newOMPNativeSession(context.Background(), command, prefix, request, sessionID, log.add, append([]string{"ORCHESTRA_OMP_FIXTURE=1"}, env...))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func TestOMPNativeTurnsStreamTextReasoningToolsAndUsage(t *testing.T) {
	log := &ompEventLog{}
	session := startOMPFixture(t, "", log)
	if session.ThreadID() != "omp-fixture-session" {
		t.Fatalf("thread = %q", session.ThreadID())
	}
	if info := session.ModelInfo(); info.Model != "prov/m1" || info.ReasoningEffort != "low" {
		t.Fatalf("initial model info %#v", info)
	}
	first, err := session.SendTurn(context.Background(), "hello", "")
	if err != nil || first.Status != "completed" || first.Text != "turn-1" {
		t.Fatalf("first turn %#v, %v", first, err)
	}
	second, err := session.SendTurnWithOptions(context.Background(), "again", NativeTurnOptions{Model: "other/m2", ReasoningEffort: "high"})
	if err != nil || second.Text != "turn-2" || second.Model != "other/m2" || second.ReasoningEffort != "high" {
		t.Fatalf("second turn %#v, %v", second, err)
	}
	types := log.types()
	for _, want := range []string{"session/initialized", "turn/started", "item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/started", "item/completed", "thread/tokenUsage/updated", "turn/completed"} {
		if types[want] == 0 {
			t.Fatalf("missing %s in %v", want, types)
		}
	}
	if types["server_request"] != 0 {
		t.Fatal("fire-and-forget widget requests must not become server requests")
	}
	var usage *NativeUsage
	var command map[string]any
	log.mu.Lock()
	for _, e := range log.events {
		if e.Type == "thread/tokenUsage/updated" {
			usage = e.Usage
		}
		if e.Type == "item/completed" && e.ItemID == "call-1" {
			var payload struct {
				Item map[string]any `json:"item"`
			}
			_ = json.Unmarshal(e.Payload, &payload)
			command = payload.Item
		}
	}
	log.mu.Unlock()
	if usage == nil || usage.Total.TotalTokens != 30 || usage.Last.InputTokens != 10 || usage.Last.CacheReadTokens != 3 || usage.ModelContextWindow == nil || *usage.ModelContextWindow != 2000 {
		t.Fatalf("usage %#v", usage)
	}
	if command["type"] != "commandExecution" || command["command"] != "echo hi" || command["aggregatedOutput"] != "hi" {
		t.Fatalf("bash tool item %#v", command)
	}
}

func TestOMPNativeResumeRequiresSameSession(t *testing.T) {
	log := &ompEventLog{}
	resumed := startOMPFixture(t, "omp-old", log, "ORCHESTRA_OMP_FIXTURE_SESSION=omp-old", "ORCHESTRA_OMP_FIXTURE_RESUME=omp-old")
	if resumed.ThreadID() != "omp-old" {
		t.Fatalf("resumed thread %q", resumed.ThreadID())
	}
	command, prefix := ompFixture(t)
	workspace := t.TempDir()
	request := TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true}
	_, err := newOMPNativeSession(context.Background(), command, prefix, request, "omp-old", nil, []string{"ORCHESTRA_OMP_FIXTURE=1", "ORCHESTRA_OMP_FIXTURE_SESSION=omp-new", "ORCHESTRA_OMP_FIXTURE_RESUME=omp-old"})
	if err == nil || !strings.Contains(err.Error(), "instead of") {
		t.Fatalf("a different resumed session must be rejected, got %v", err)
	}
}

func TestOMPNativeApprovalDialogRoundTrip(t *testing.T) {
	log := &ompEventLog{}
	session := startOMPFixture(t, "", log)
	answered := make(chan error, 1)
	go func() {
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			log.mu.Lock()
			var request *NativeEvent
			for i := range log.events {
				if log.events[i].Type == "server_request" {
					request = &log.events[i]
				}
			}
			log.mu.Unlock()
			if request != nil {
				var payload struct {
					Method string         `json:"method"`
					Params map[string]any `json:"params"`
				}
				_ = json.Unmarshal(request.Payload, &payload)
				if payload.Method != "item/commandExecution/requestApproval" || !strings.Contains(fmt.Sprint(payload.Params["command"]), "echo hi") {
					answered <- fmt.Errorf("approval request shape %#v", payload)
					return
				}
				answered <- session.RespondRequest(context.Background(), request.RequestID, json.RawMessage(`{"decision":"accept"}`))
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		answered <- fmt.Errorf("no approval request observed")
	}()
	result, err := session.SendTurn(context.Background(), "please approve", "")
	if replyErr := <-answered; replyErr != nil {
		t.Fatal(replyErr)
	}
	if err != nil || result.Text != "answer-Approve" {
		t.Fatalf("approved turn %#v, %v", result, err)
	}
	if err = session.RespondRequest(context.Background(), "dialog-1", json.RawMessage(`{"decision":"accept"}`)); err == nil {
		t.Fatal("an answered dialog must not be answerable again")
	}
}

func TestOMPDialogResponsesMapDecisions(t *testing.T) {
	approval := ompPendingRequest{method: "item/commandExecution/requestApproval", dialog: "select", approve: "Approve", deny: "Deny"}
	for answer, want := range map[string]string{`{"decision":"accept"}`: `{"value":"Approve"}`, `{"decision":"decline"}`: `{"value":"Deny"}`, `{"decision":"cancel"}`: `{"cancelled":true}`} {
		got, err := ompDialogResponse(approval, json.RawMessage(answer))
		raw, _ := json.Marshal(got)
		if err != nil || string(raw) != want {
			t.Fatalf("%s -> %s, %v; want %s", answer, raw, err, want)
		}
	}
	confirm := ompPendingRequest{method: "item/commandExecution/requestApproval", dialog: "confirm"}
	if got, _ := ompDialogResponse(confirm, json.RawMessage(`{"decision":"decline"}`)); got["confirmed"] != false {
		t.Fatalf("confirm decline -> %#v", got)
	}
	question := ompPendingRequest{method: "item/tool/requestUserInput", dialog: "input"}
	if got, err := ompDialogResponse(question, json.RawMessage(`{"answers":{"answer":{"answers":["blue"]}}}`)); err != nil || got["value"] != "blue" {
		t.Fatalf("input answer -> %#v, %v", got, err)
	}
	if _, err := ompDialogResponse(approval, json.RawMessage(`{"decision":"maybe"}`)); err == nil {
		t.Fatal("unknown decision accepted")
	}
}

func TestOMPNativeInterruptAbortsInBand(t *testing.T) {
	log := &ompEventLog{}
	session := startOMPFixture(t, "", log)
	go func() {
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if log.types()["item/completed"] > 0 {
				_ = session.Interrupt(context.Background())
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
	result, err := session.SendTurn(context.Background(), "hang please", "")
	if err != nil || result.Status != "interrupted" {
		t.Fatalf("interrupted turn %#v, %v", result, err)
	}
	next, err := session.SendTurn(context.Background(), "after", "")
	if err != nil || next.Text != "turn-2" {
		t.Fatalf("session must stay usable after abort: %#v, %v", next, err)
	}
	if err = session.Interrupt(context.Background()); err == nil {
		t.Fatal("interrupt without an active turn must fail")
	}
}

func TestOMPNativeRejectsBareModelSwitch(t *testing.T) {
	session := startOMPFixture(t, "", &ompEventLog{})
	if _, err := session.SendTurn(context.Background(), "hi", "opus"); err == nil || !strings.Contains(err.Error(), "provider/model") {
		t.Fatalf("bare model switch must be rejected, got %v", err)
	}
	if result, err := session.SendTurn(context.Background(), "hi", "prov/m1"); err != nil || result.Text != "turn-1" {
		t.Fatalf("session must remain usable: %#v, %v", result, err)
	}
}

func TestParseOMPModelsKeepsChatSelectorsAndThinking(t *testing.T) {
	raw := []byte(`{"models":[
	 {"provider":"openai-codex","kind":"chat","id":"gpt-x","selector":"openai-codex/gpt-x","name":"GPT X","contextWindow":272000,"thinking":["low","high"],"input":["text","image"]},
	 {"provider":"google-antigravity","kind":"chat","id":"claude-y","selector":"google-antigravity/claude-y","name":"Claude Y","thinking":[]},
	 {"provider":"other","kind":"chat","id":"claude-y","name":"Claude Y"},
	 {"provider":"other","kind":"image","id":"img","name":"Image"}]}`)
	models, err := parseOMPModels(raw)
	if err != nil || len(models) != 3 {
		t.Fatalf("models %#v, %v", models, err)
	}
	if models[0].Model != "openai-codex/gpt-x" || len(models[0].SupportedReasoningEfforts) != 2 || models[0].SupportedReasoningEfforts[1].ReasoningEffort != "high" || models[0].Description != "openai-codex · 272K context" {
		t.Fatalf("first model %#v", models[0])
	}
	if models[2].Model != "other/claude-y" || models[2].DisplayName != "Claude Y (other)" {
		t.Fatalf("selector fallback / duplicate naming %#v", models[2])
	}
	if _, err = parseOMPModels([]byte(`{"nope":1}`)); err == nil {
		t.Fatal("malformed catalog accepted")
	}
}

func TestOMPModelsCachesCatalog(t *testing.T) {
	original := runOMPModels
	defer func() { runOMPModels = original }()
	calls := 0
	runOMPModels = func(context.Context, string) ([]byte, error) {
		calls++
		return []byte(`{"models":[{"provider":"p","kind":"chat","id":"m","name":"M"}]}`), nil
	}
	exe, _ := os.Executable()
	ompCatalog.Lock()
	ompCatalog.models = nil
	ompCatalog.Unlock()
	for i := 0; i < 2; i++ {
		models, err := ompModels(context.Background(), exe)
		if err != nil || len(models) != 1 || models[0].Model != "p/m" {
			t.Fatalf("models %#v, %v", models, err)
		}
	}
	if calls != 1 {
		t.Fatalf("catalog command ran %d times", calls)
	}
}

func TestOMPJSONEventCountsAssistantUsageOnly(t *testing.T) {
	user := parseLineToEvent(ProviderOMP, "stdout", `{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"question"}]}}`)
	if user.Message != "" || user.Usage != (TokenUsage{}) {
		t.Fatalf("user echo must not count: %#v", user)
	}
	assistant := parseLineToEvent(ProviderOMP, "stdout", `{"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"answer"}],"usage":{"input":8166,"output":1,"cacheRead":4,"cacheWrite":0,"totalTokens":8171,"reasoningTokens":2}}}`)
	if assistant.Kind != "message_end/stop" || assistant.Message != "answer" || assistant.Usage.InputTokens != 8166 || assistant.Usage.TotalTokens != 8171 || assistant.Usage.CacheReadTokens != 4 || assistant.Usage.ThinkingTokens != 2 {
		t.Fatalf("assistant event %#v", assistant)
	}
	delta := parseLineToEvent(ProviderOMP, "stdout", `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"hel"}}`)
	if delta.Kind != "message_update/text_delta" || delta.Message != "hel" {
		t.Fatalf("delta event %#v", delta)
	}
	turnEnd := parseLineToEvent(ProviderOMP, "stdout", `{"type":"turn_end","message":{"role":"assistant","usage":{"input":5,"output":5}}}`)
	if turnEnd.Usage != (TokenUsage{}) {
		t.Fatalf("turn_end repeats message usage and must not count: %#v", turnEnd)
	}
}

func TestOMPRunnerValidatesModels(t *testing.T) {
	runner := NewOMPRunner("omp -p --mode json {{prompt}}")
	for _, ok := range []string{"opus", "openai-codex/gpt-6.1-sol", "google-antigravity/gemini-3.8-flash:medium"} {
		if err := runner.ValidateRequestedModel(ok); err != nil {
			t.Fatalf("%q rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "--flag", "a b", "x/$(rm)"} {
		if runner.ValidateRequestedModel(bad) == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestOMPAdapterAppliesAgentSkillsMCPAndRestoresWorkspace(t *testing.T) {
	workspace := t.TempDir()
	skill := filepath.Join(t.TempDir(), "lint-rules")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("---\nname: lint-rules\ndescription: d\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	agent := orchestraAgent("reviewer")
	agent.Effort = "high"
	agent.Skills = []ResolvedSkill{{Name: "lint-rules", Path: skill}}
	agent.Permissions = AgentPermissions{Bash: "ask", Edit: "deny"}
	request := TurnRequest{Workspace: workspace, Agent: agent, DeveloperInstructions: "Stay in the project.", RequestedModel: "prov/m1",
		MCPServers: []MCPServerSpec{{Name: "orch", Command: "orch-mcp", Args: []string{"serve"}}}}
	applied, err := applyOMP(request, true, func(...string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	flags := map[string]string{}
	for i := 0; i+1 < len(applied.args); i += 2 {
		flags[applied.args[i]] = applied.args[i+1]
	}
	if flags["--model"] != "prov/m1" || flags["--thinking"] != "high" || flags["--approval-mode"] != "always-ask" {
		t.Fatalf("flags %#v", flags)
	}
	instructions, err := os.ReadFile(flags["--append-system-prompt"])
	if err != nil || !strings.Contains(string(instructions), "Stay in the project.") || !strings.Contains(string(instructions), "You review code.") {
		t.Fatalf("instructions file %q, %v", instructions, err)
	}
	overlay, err := os.ReadFile(flags["--config"])
	if err != nil || !strings.Contains(string(overlay), "customDirectories") {
		t.Fatalf("config overlay %q, %v", overlay, err)
	}
	mcpFile := filepath.Join(workspace, ".omp", "mcp.json")
	raw, err := os.ReadFile(mcpFile)
	if err != nil || !strings.Contains(string(raw), `"orch"`) || !strings.Contains(string(raw), `"stdio"`) {
		t.Fatalf("mcp overlay %q, %v", raw, err)
	}
	if got := applied.receipt.observation(); got != "applied_partial:permissions" {
		t.Fatalf("receipt %q", got)
	}
	applied.cleanup()
	for _, path := range []string{flags["--append-system-prompt"], flags["--config"], mcpFile} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("%s survived cleanup", path)
		}
	}
}

func TestOMPAdapterSelectsNativeAgentToolsAndSkipsRoleModels(t *testing.T) {
	file := filepath.Join(t.TempDir(), "scout.md")
	if err := os.WriteFile(file, []byte("---\nname: scout\ndescription: Finds code\ntools:\n  - read\n  - grep\nmodel:\n  - \"@smol\"\n---\nYou scout.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	agent := &ResolvedAgent{ID: "harness:project:omp:scout", Name: "scout", Source: AgentSourceHarness, Harness: "OMP", Prompt: "You scout.", Model: "@smol", Path: file}
	if err := CanApplyAgent(ProviderOMP, agent); err != nil {
		t.Fatalf("omp agents must be selectable on omp: %v", err)
	}
	applied, err := applyOMP(TurnRequest{Workspace: t.TempDir(), Agent: agent}, false, func(...string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer applied.cleanup()
	joined := strings.Join(applied.args, " ")
	if !strings.Contains(joined, "--tools read,grep") || strings.Contains(joined, "--model") {
		t.Fatalf("args %q", joined)
	}
	if got := applied.receipt.observation(); got != "applied_partial:model" {
		t.Fatalf("receipt %q", got)
	}
}

func TestOMPBatchPlanQuotesFlagsAndKeepsUserChoices(t *testing.T) {
	agent := orchestraAgent("reviewer")
	agent.Model = "prov/agent-model"
	plan, err := planCommandAgent(ProviderOMP, "omp -p --mode json --model prov/user {{prompt}}", TurnRequest{Workspace: t.TempDir(), Agent: agent})
	if err != nil {
		t.Fatal(err)
	}
	defer plan.cleanup()
	if strings.Contains(plan.commandLine, "agent-model") || !strings.Contains(plan.commandLine, "--append-system-prompt '") {
		t.Fatalf("command line %q", plan.commandLine)
	}
	if plan.receipt.observation() != AgentApplied {
		t.Fatalf("receipt %q", plan.receipt.observation())
	}
}
