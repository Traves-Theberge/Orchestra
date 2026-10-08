package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// This helper is a subprocess fixture for the documented stream-json boundary;
// it never contacts Antigravity or performs inference.
func TestAntigravityStreamFixtureProcess(t *testing.T) {
	if os.Getenv("ORCHESTRA_AGY_FIXTURE") != "1" {
		return
	}
	verifyNativeFixtureConsole()
	threadID := os.Getenv("ORCHESTRA_AGY_FIXTURE_THREAD")
	if threadID == "" {
		threadID = "agy-fixture-conversation"
	}
	args := os.Args
	has := func(flag, value string) bool {
		for i := 0; i+1 < len(args); i++ {
			if args[i] == flag && args[i+1] == value {
				return true
			}
		}
		return false
	}
	if !has("--input-format", "stream-json") || !has("--output-format", "stream-json") || !has("--agent", "reviewer") {
		os.Exit(2)
	}
	if resume := os.Getenv("ORCHESTRA_AGY_FIXTURE_RESUME"); resume != "" && !has("--conversation", resume) {
		os.Exit(3)
	}
	for _, arg := range args {
		if strings.Contains(strings.ToLower(arg), "dangerously-skip-permissions") {
			os.Exit(4)
		}
	}
	cwd, _ := os.Getwd()
	turnCount, _ := strconv.Atoi(os.Getenv("ORCHESTRA_AGY_FIXTURE_TURN_COUNT"))
	send := func(v any) { raw, _ := json.Marshal(v); fmt.Println(string(raw)) }
	init := map[string]any{"cwd": cwd, "permission_mode": "request-review", "agent": "reviewer"}
	if os.Getenv("ORCHESTRA_AGY_FIXTURE_EMPTY_AGENT") == "1" {
		delete(init, "agent")
	}
	if model := os.Getenv("ORCHESTRA_AGY_FIXTURE_MODEL"); model != "" {
		init["model"] = model
	}
	if agent := os.Getenv("ORCHESTRA_AGY_FIXTURE_AGENT"); agent != "" {
		init["agent"] = agent
	}
	send(map[string]any{"event": "init", "conversation_id": threadID, "init": init})
	if os.Getenv("ORCHESTRA_AGY_FIXTURE_UNSOLICITED_RESULT") == "1" {
		send(map[string]any{"event": "result", "result": map[string]any{"conversation_id": threadID, "status": "SUCCESS", "response": "unexpected", "num_turns": turnCount + 1}})
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message struct {
			Event   string `json:"event"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil || message.Event != "user" || message.Message.Content == "" {
			os.Exit(5)
		}
		response := "agy-ok"
		turnCount++
		if os.Getenv("ORCHESTRA_AGY_FIXTURE_DENIED") == "1" {
			send(map[string]any{"event": "result", "result": map[string]any{"conversation_id": threadID, "status": "SUCCESS", "response": "", "num_turns": turnCount, "denied_actions": []map[string]any{{"action": "read_file", "display_name": "ViewFile"}}}})
			continue
		}
		mode := os.Getenv("ORCHESTRA_AGY_FIXTURE_COUNTER_MODE")
		resultCount := turnCount
		if mode == "skip-first" && turnCount == 1 {
			resultCount++
		}
		if mode == "stale-second" && turnCount == 2 || mode == "duplicate-second" && turnCount == 2 {
			resultCount--
		}
		if mode == "duplicate-second" && turnCount == 2 {
			send(map[string]any{"event": "result", "result": map[string]any{"conversation_id": threadID, "status": "SUCCESS", "response": "stale duplicate", "num_turns": resultCount}})
		}
		send(map[string]any{"event": "step_update", "step_update": map[string]any{"conversation_id": threadID, "step_index": 1, "state": "DONE", "step_type": "agent_response", "text_delta": response}})
		send(map[string]any{"event": "result", "result": map[string]any{"conversation_id": threadID, "status": "SUCCESS", "response": response, "num_turns": resultCount}})
	}
	os.Exit(0)
}

func antigravityFixtureCommand(t *testing.T) (string, []string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return exe, []string{"-test.run=^TestAntigravityStreamFixtureProcess$", "--"}
}

func TestResolveAntigravityExecutableQuotesWindowsPathsWithSpaces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Program Files", "Antigravity CLI.exe")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture executable"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := resolveAntigravityExecutable("\"" + path + "\"")
	if err != nil || filepath.Clean(got) != filepath.Clean(path) {
		t.Fatalf("quoted absolute executable path = %q, %v; want %q", got, err, path)
	}
	if _, err = resolveAntigravityExecutable(path); err == nil {
		t.Fatal("unquoted path with spaces was accepted as a single command")
	}
}

func TestAntigravityNativeStreamTurnsAndExactConversationResume(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	workspace := t.TempDir()
	var events []NativeEvent
	onEvent := func(event NativeEvent) { events = append(events, event) }
	request := TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, SessionID: "fixture", RequestedAgentID: "reviewer"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fixtureEnv := []string{"ORCHESTRA_AGY_FIXTURE=1"}
	session, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, request, "", onEvent, fixtureEnv)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		result, sendErr := session.SendTurn(context.Background(), "marker-only", "")
		if sendErr != nil || result.Status != "completed" || result.Text != "agy-ok" {
			t.Fatalf("stream turn result %#v, %v", result, sendErr)
		}
	}
	threadID := session.ThreadID()
	if threadID != "agy-fixture-conversation" {
		t.Fatalf("thread identity = %q", threadID)
	}
	if info := session.ModelInfo(); info.AgentID != "reviewer" || info.ApprovalPolicy != "request-review" {
		t.Fatalf("init identity/policy not observed: %#v", info)
	}
	if err = session.Close(); err != nil {
		t.Fatal(err)
	}
	resumeEnv := []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_THREAD=" + threadID, "ORCHESTRA_AGY_FIXTURE_RESUME=" + threadID, "ORCHESTRA_AGY_FIXTURE_TURN_COUNT=2"}
	request.ProviderTurnCounter = 2
	resumed, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, request, threadID, onEvent, resumeEnv)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resumed.Close() }()
	result, err := resumed.SendTurn(context.Background(), "resume marker", "")
	if err != nil || result.Status != "completed" || resumed.ThreadID() != threadID {
		t.Fatalf("exact resume result %#v, thread=%q, err=%v", result, resumed.ThreadID(), err)
	}
	if len(events) < 7 {
		t.Fatalf("expected init and turn events to be observed, got %d", len(events))
	}
}

func TestAntigravityNativeRejectsStaleSkippedAndDuplicateCumulativeResults(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	for _, mode := range []string{"skip-first", "stale-second", "duplicate-second"} {
		t.Run(mode, func(t *testing.T) {
			workspace := t.TempDir()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			request := TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"}
			env := []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_COUNTER_MODE=" + mode}
			session, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, request, "", nil, env)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = session.Close() }()
			if mode == "skip-first" {
				_, err = session.SendTurn(ctx, "first", "")
			} else {
				first, firstErr := session.SendTurn(ctx, "first", "")
				if firstErr != nil || first.CumulativeTurnCount != 1 {
					t.Fatalf("first turn = %#v, %v", first, firstErr)
				}
				_, err = session.SendTurn(ctx, "second", "")
			}
			if err == nil {
				t.Fatal("invalid cumulative result was accepted")
			}
		})
	}
}

func TestAntigravityNativeRejectsResultWithoutActiveTurn(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	workspace := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	env := []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_UNSOLICITED_RESULT=1"}
	session, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"}, "", nil, env)
	if err != nil {
		if !strings.Contains(err.Error(), "without an active turn") {
			t.Fatalf("unsolicited result failed for an unrelated reason: %v", err)
		}
		return // Initialization was rejected before a session became available.
	}
	defer func() { _ = session.Close() }()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		session.mu.Lock()
		failure := session.failure
		session.mu.Unlock()
		if failure != nil {
			break
		}
		time.Sleep(time.Millisecond)
	}
	session.mu.Lock()
	failure := session.failure
	session.mu.Unlock()
	if failure == nil || !strings.Contains(failure.Error(), "without an active turn") {
		t.Fatalf("unsolicited result failure = %v", failure)
	}
	if _, err = session.SendTurn(ctx, "must not accept unsolicited result", ""); err == nil {
		t.Fatal("unsolicited result was assigned to a later turn")
	}
}

func TestAntigravityNativeRejectsInteractiveReplies(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	workspace := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"}, "", nil, []string{"ORCHESTRA_AGY_FIXTURE=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Close() }()
	if err = session.RespondRequest(context.Background(), "request", json.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "does not expose") {
		t.Fatalf("interactive reply was fabricated: %v", err)
	}
}

func TestAntigravityNativeRequiresRequestedAgentAndModelConfirmation(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	workspace := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tests := []struct {
		name    string
		request TurnRequest
		env     []string
		want    string
	}{
		{
			name:    "agent absent",
			request: TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"},
			env:     []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_EMPTY_AGENT=1"},
			want:    "did not confirm requested agent",
		},
		{
			name:    "agent differs",
			request: TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"},
			env:     []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_AGENT=planner"},
			want:    `reported "planner"`,
		},
		{
			name:    "model absent",
			request: TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedModel: "model-x", RequestedAgentID: "reviewer"},
			env:     []string{"ORCHESTRA_AGY_FIXTURE=1"},
			want:    "did not confirm requested model",
		},
		{
			name:    "model differs",
			request: TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedModel: "model-x", RequestedAgentID: "reviewer"},
			env:     []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_MODEL=model-y"},
			want:    `reported "model-y"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, tt.request, "", nil, tt.env)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("session init error = %v, want substring %q", err, tt.want)
			}
		})
	}
}

func TestAntigravityNativeReportsDeniedActionsInsteadOfAnEmptyReply(t *testing.T) {
	command, prefixArgs := antigravityFixtureCommand(t)
	workspace := t.TempDir()
	request := TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, SessionID: "fixture", RequestedAgentID: "reviewer"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := newAntigravityNativeSessionWithArgs(ctx, command, prefixArgs, request, "", func(NativeEvent) {}, []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_AGY_FIXTURE_DENIED=1"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Close() }()
	result, err := session.SendTurn(context.Background(), "use a skill", "")
	if err == nil || !strings.Contains(err.Error(), "denied ViewFile") || result.Status != "failed" {
		t.Fatalf("denied-only turn must fail loudly, got result=%#v err=%v", result, err)
	}
}

func TestAntigravityDeniedActionsDeduplicatesAndPrefersDisplayNames(t *testing.T) {
	got := antigravityDeniedActions(json.RawMessage(`[{"action":"read_file","display_name":"ViewFile"},{"action":"read_file","display_name":"ViewFile"},{"action":"run_command"}]`))
	if len(got) != 2 || got[0] != "ViewFile" || got[1] != "run_command" {
		t.Fatalf("got %v", got)
	}
	if antigravityDeniedActions(nil) != nil || antigravityDeniedActions(json.RawMessage("not json")) != nil {
		t.Fatal("malformed input must yield nothing")
	}
}

func TestAntigravityReadableDirsListsOnlyExistingSharedDirs(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if dirs := antigravityReadableDirs(); len(dirs) != 0 {
		t.Fatalf("no dirs exist yet: %v", dirs)
	}
	if err := os.MkdirAll(filepath.Join(home, ".agents", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	dirs := antigravityReadableDirs()
	if len(dirs) != 1 || dirs[0] != filepath.Join(home, ".agents") {
		t.Fatalf("got %v", dirs)
	}
}
