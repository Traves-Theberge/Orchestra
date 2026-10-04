package app

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/ade"
)

func assertDisabledToolResult(t *testing.T, result map[string]any, tool string) {
	t.Helper()
	if result["success"] != false {
		t.Fatalf("denied result is not failure: %+v", result)
	}
	items, ok := result["contentItems"].([]map[string]any)
	if !ok || len(items) != 1 || items[0]["type"] != "inputText" {
		t.Fatalf("changed tool result convention: %+v", result)
	}
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Tool    string `json:"tool"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(items[0]["text"].(string)), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "TOOL_DISABLED" || payload.Error.Tool != tool || payload.Error.Message == "" {
		t.Fatalf("missing typed policy error: %+v", payload)
	}
}

func TestTaskToolPolicyDeniesBeforeMCPAndFallbackRouting(t *testing.T) {
	disabled := []string{" Update_Issue ", " files_Delete ", ""}
	policy := newTaskToolPolicy(disabled)
	disabled[0] = "allowed"
	var mcpCalls, fallbackCalls int
	executor := policy.executor(func(context.Context, string, string, map[string]any) (map[string]any, error) {
		mcpCalls++
		return nil, errors.New("route missing")
	}, func(context.Context, string, map[string]any) map[string]any {
		fallbackCalls++
		return map[string]any{"success": true}
	})
	for _, tool := range []string{"update_issue", "UPDATE_ISSUE", " update_issue ", "files_delete", " FILES_DELETE "} {
		assertDisabledToolResult(t, executor(context.Background(), tool, map[string]any{"identifier": "other-task"}), strings.TrimSpace(tool))
	}
	if mcpCalls != 0 || fallbackCalls != 0 {
		t.Fatalf("denied calls caused side effects: MCP=%d fallback=%d", mcpCalls, fallbackCalls)
	}
	specs := policy.filterSpecs([]map[string]any{{"name": "UPDATE_ISSUE"}, {"name": " files_delete "}, {"name": "tracker_query"}, {"name": 1}})
	if len(specs) != 1 || specs[0]["name"] != "tracker_query" {
		t.Fatalf("advertisement and policy differ: %+v", specs)
	}
	// A missing downstream executor also cannot turn a denial into a panic.
	assertDisabledToolResult(t, policy.executor(nil, nil)(context.Background(), "update_issue", nil), "update_issue")
}

func TestTaskToolPolicyPreservesPermittedRoutesArgumentsAndContext(t *testing.T) {
	policy := newTaskToolPolicy([]string{"files_delete"})
	type key struct{}
	ctx := context.WithValue(context.Background(), key{}, "context-marker")
	args := map[string]any{"path": "fixture.txt"}
	var mcpCalls, fallbackCalls int
	mcpResult := map[string]any{"content": []any{"unchanged MCP response"}}
	fallbackResult := map[string]any{"success": true, "contentItems": []map[string]any{{"type": "inputText", "text": "unchanged fallback"}}}
	executor := policy.executor(func(got context.Context, server, tool string, arguments map[string]any) (map[string]any, error) {
		mcpCalls++
		if got != ctx || !reflect.DeepEqual(arguments, args) {
			t.Fatal("context or arguments changed")
		}
		if server == "files" && tool == "read" {
			return mcpResult, nil
		}
		return nil, errors.New("server unavailable")
	}, func(got context.Context, tool string, arguments map[string]any) map[string]any {
		fallbackCalls++
		if got != ctx || !reflect.DeepEqual(arguments, args) || (tool != "tracker_query" && tool != "plain") {
			t.Fatal("fallback request changed")
		}
		return fallbackResult
	})
	if got := executor(ctx, "files_read", args); !reflect.DeepEqual(got, mcpResult) {
		t.Fatal("MCP result changed")
	}
	for _, tool := range []string{"tracker_query", "plain"} {
		if got := executor(ctx, tool, args); !reflect.DeepEqual(got, fallbackResult) {
			t.Fatal("fallback result changed")
		}
	}
	if mcpCalls != 2 || fallbackCalls != 2 {
		t.Fatalf("permitted routes MCP=%d fallback=%d", mcpCalls, fallbackCalls)
	}
}

func TestRecordingProviderForgedDisabledToolCannotReachExecutors(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := fixture.Close(); err != nil {
			t.Error(err)
		}
	})
	policy := newTaskToolPolicy([]string{"update_issue", "files_delete"})
	var mcpCalls, fallbackCalls int
	executor := policy.executor(func(context.Context, string, string, map[string]any) (map[string]any, error) {
		mcpCalls++
		return nil, errors.New("server not found")
	}, func(_ context.Context, tool string, _ map[string]any) map[string]any {
		fallbackCalls++
		if tool != "tracker_query" {
			t.Fatalf("forged tool reached fallback: %s", tool)
		}
		return map[string]any{"success": true}
	})
	runner := ade.NewRecordingRunner(fixture, ade.Step{Tool: " update_issue ", Arguments: map[string]any{"identifier": "ADE-OTHER", "state": "Done"}}, ade.Step{Tool: "FILES_DELETE", Arguments: map[string]any{"path": "answer.go"}}, ade.Step{Tool: "tracker_query", Arguments: map[string]any{"mode": "issues_by_ids"}})
	registry := agents.NewRegistry(nil)
	registry.SetRunner("ADE_FIXTURE", runner)
	var events []agents.Event
	req := agents.TurnRequest{Workspace: fixture.Manifest.Worktree, SessionID: "tool-policy-session", ToolExecutor: executor, ToolSpecs: policy.filterSpecs([]map[string]any{{"name": "update_issue"}, {"name": "files_delete"}, {"name": "tracker_query"}})}
	if _, err := registry.RunTurn(ctx, "ADE_FIXTURE", req, func(event agents.Event) { events = append(events, event) }); err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("tool events: %+v", events)
	}
	assertDisabledToolResult(t, events[0].Raw, "update_issue")
	assertDisabledToolResult(t, events[1].Raw, "FILES_DELETE")
	if events[2].Raw["success"] != true || mcpCalls != 1 || fallbackCalls != 1 {
		t.Fatalf("forged requests affected route counts MCP=%d fallback=%d events=%+v", mcpCalls, fallbackCalls, events)
	}
	if calls := runner.Invocations(); len(calls) != 1 || len(calls[0].Request.ToolSpecs) != 1 {
		t.Fatalf("recorded advertised policy: %+v", calls)
	}
	status, err := fixture.Git(ctx, fixture.Manifest.Worktree, "status", "--porcelain")
	if err != nil || status != "" {
		t.Fatalf("forged delete changed worktree: %q %v", status, err)
	}
}
