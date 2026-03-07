package tools

import (
	"encoding/json"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

func TestExecuteTrackerQueryCandidates(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}, {ID: "2", Identifier: "ORC-2", State: "Done"}}))

	result := exec.Execute("tracker_query", map[string]any{"active_states": []any{"Todo"}})
	if result["success"] != true {
		t.Fatalf("expected success true, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	issuesRaw, ok := payload["issues"].([]any)
	if !ok || len(issuesRaw) != 1 {
		t.Fatalf("expected one issue, got %+v", payload)
	}
}

func TestExecuteLinearGraphqlAliasIssueStates(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}}))

	result := exec.Execute("linear_graphql", map[string]any{"mode": "issue_states_by_ids", "issue_ids": []any{"1"}})
	if result["success"] != true {
		t.Fatalf("expected success true, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	states, ok := payload["states"].(map[string]any)
	if !ok || states["1"] != "In Progress" {
		t.Fatalf("expected state map with id 1, got %+v", payload)
	}
}

func TestExecuteTrackerQueryIssuesByIDsMode(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}, {ID: "2", Identifier: "ORC-2", State: "Todo"}}))

	result := exec.Execute("tracker_query", map[string]any{"mode": "issues_by_ids", "issue_ids": []any{"2", "1"}})
	if result["success"] != true {
		t.Fatalf("expected success true, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	issuesRaw, ok := payload["issues"].([]any)
	if !ok || len(issuesRaw) != 2 {
		t.Fatalf("expected two issues payload, got %+v", payload)
	}
}

func TestExecuteUnsupportedTool(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient(nil))
	result := exec.Execute("unknown_tool", nil)
	if result["success"] != false {
		t.Fatalf("expected unsupported tool failure, got %v", result)
	}
}

func TestExecuteLinearGraphqlRejectsMultipleOperations(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient(nil))
	result := exec.Execute("linear_graphql", map[string]any{"query": "query One { viewer { id } } mutation Two { noop }"})
	if result["success"] != false {
		t.Fatalf("expected failure for multiple operations, got %v", result)
	}
}

func TestTrackerToolSpecsIncludesTrackerAndLinearTools(t *testing.T) {
	specs := TrackerToolSpecs()
	if len(specs) < 2 {
		t.Fatalf("expected at least two tool specs, got %d", len(specs))
	}

	foundTracker := false
	foundLinear := false
	for _, spec := range specs {
		name, _ := spec["name"].(string)
		if name == "tracker_query" {
			foundTracker = true
		}
		if name == "linear_graphql" {
			foundLinear = true
		}
	}

	if !foundTracker || !foundLinear {
		t.Fatalf("expected tracker_query and linear_graphql specs, got %+v", specs)
	}
}

func TestExecuteLinearGraphqlRejectsNonObjectVariables(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient(nil))
	result := exec.Execute("linear_graphql", map[string]any{"query": "query One { viewer { id } }", "variables": []any{"bad"}})
	if result["success"] != false {
		t.Fatalf("expected failure for invalid variables shape, got %v", result)
	}
}

func TestExecuteLinearGraphqlAcceptsStringArgumentsPayload(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}}))
	result := exec.Execute("linear_graphql", map[string]any{"arguments": "query One { issues { nodes { id } } }", "active_states": []any{"Todo"}})
	if result["success"] != true {
		t.Fatalf("expected success for string arguments payload, got %v", result)
	}
}

func TestExecuteLinearGraphqlAcceptsObjectArgumentsPayload(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}}))
	result := exec.Execute("linear_graphql", map[string]any{"arguments": map[string]any{"query": "query One { issues { nodes { id } } }", "variables": map[string]any{"foo": "bar"}}, "active_states": []any{"Todo"}})
	if result["success"] != true {
		t.Fatalf("expected success for object arguments payload, got %v", result)
	}
}

func TestExecuteLinearGraphqlRejectsInvalidArgumentsShape(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient(nil))
	result := exec.Execute("linear_graphql", map[string]any{"arguments": 42})
	if result["success"] != false {
		t.Fatalf("expected failure for invalid arguments shape, got %v", result)
	}
}

func TestExecuteLinearGraphqlRequiresQuery(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}}))
	result := exec.Execute("linear_graphql", map[string]any{"active_states": []any{"Todo"}})
	if result["success"] != false {
		t.Fatalf("expected failure when linear_graphql query is missing, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	errorNode, _ := payload["error"].(map[string]any)
	message, _ := errorNode["message"].(string)
	if message == "" || message != "`linear_graphql` requires a non-empty `query` string." {
		t.Fatalf("unexpected linear_graphql missing query message: %+v", payload)
	}
}

func TestExecuteLinearGraphqlRoutesIssuesByIDsUsingVariables(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}}))
	result := exec.Execute("linear_graphql", map[string]any{
		"query":     "query One($ids: [ID!]) { issues(ids: $ids) { nodes { id } } }",
		"variables": map[string]any{"ids": []any{"1"}},
	})
	if result["success"] != true {
		t.Fatalf("expected success for issues(ids) routing, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	issuesRaw, ok := payload["issues"].([]any)
	if !ok || len(issuesRaw) != 1 {
		t.Fatalf("expected routed issues payload, got %+v", payload)
	}
}

func TestExecuteLinearGraphqlRoutesIssuesByStatesUsingVariables(t *testing.T) {
	exec := NewTrackerToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Done"}, {ID: "2", Identifier: "ORC-2", State: "Todo"}}))
	result := exec.Execute("linear_graphql", map[string]any{
		"query":     "query One($states: [String!]) { issues(states: $states) { nodes { id } } }",
		"variables": map[string]any{"states": []any{"Done"}},
	})
	if result["success"] != true {
		t.Fatalf("expected success for issues(states) routing, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	issuesRaw, ok := payload["issues"].([]any)
	if !ok || len(issuesRaw) != 1 {
		t.Fatalf("expected routed issues payload, got %+v", payload)
	}
}

func decodeToolTextPayload(t *testing.T, result map[string]any) map[string]any {
	t.Helper()
	contentItems, ok := result["contentItems"].([]map[string]any)
	if !ok || len(contentItems) == 0 {
		itemsAny, okAny := result["contentItems"].([]any)
		if !okAny || len(itemsAny) == 0 {
			t.Fatalf("missing contentItems in result: %v", result)
		}
		first, _ := itemsAny[0].(map[string]any)
		text, _ := first["text"].(string)
		return decodeJSONMap(t, text)
	}
	text, _ := contentItems[0]["text"].(string)
	return decodeJSONMap(t, text)
}

func decodeJSONMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("decode json payload: %v", err)
	}
	return parsed
}
