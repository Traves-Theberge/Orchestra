package tools

import (
	"encoding/json"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

func TestExecuteTrackerQueryCandidates(t *testing.T) {
	exec := NewLinearToolExecutor(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}, {ID: "2", Identifier: "ORC-2", State: "Done"}}))

	result := exec.Execute("linear_query", map[string]any{"active_states": []any{"Todo"}})
	if result["success"] != true {
		t.Fatalf("expected success true, got %v", result)
	}
	payload := decodeToolTextPayload(t, result)
	issuesRaw, ok := payload["issues"].([]any)
	if !ok || len(issuesRaw) != 1 {
		t.Fatalf("expected one issue, got %+v", payload)
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
