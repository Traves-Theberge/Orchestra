package tools

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type TrackerToolExecutor struct {
	tracker tracker.Client
}

func TrackerToolSpecs() []map[string]any {
	return []map[string]any{
		{
			"name":        "tracker_query",
			"description": "Query issue tracker state for candidate dispatch and state refresh operations.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"mode":          map[string]any{"type": "string"},
					"issue_ids":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"states":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"active_states": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"query":         map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "update_issue",
			"description": "Update an issue's state, priority, or assignee. Use this to transition an issue through the workflow or hand off to another agent.",
			"inputSchema": map[string]any{
				"type": "object",
				"required": []string{"identifier"},
				"properties": map[string]any{
					"identifier":  map[string]any{"type": "string", "description": "The issue identifier (e.g. OPS-123)"},
					"state":       map[string]any{"type": "string", "description": "The new state (e.g. In Progress, In Review, Done)"},
					"assignee_id": map[string]any{"type": "string", "description": "The ID of the agent or user to assign (e.g. agent-claude, agent-codex)"},
					"priority":    map[string]any{"type": "integer", "description": "The priority level (0-4)"},
				},
			},
		},
		{
			"name":        "request_handoff",
			"description": "Explicitly request to hand off the current task to another agent provider. Use this if the task requires a model with different capabilities (e.g. larger context, better reasoning).",
			"inputSchema": map[string]any{
				"type": "object",
				"required": []string{"provider", "reason"},
				"properties": map[string]any{
					"provider": map[string]any{"type": "string", "description": "The target agent provider (e.g. claude, gemini, codex, opencode)"},
					"reason":   map[string]any{"type": "string", "description": "The reason for the handoff request"},
				},
			},
		},
	}
}

func NewTrackerToolExecutor(client tracker.Client) *TrackerToolExecutor {
	return &TrackerToolExecutor{tracker: client}
}

func (e *TrackerToolExecutor) Execute(tool string, arguments map[string]any) map[string]any {
	name := strings.TrimSpace(tool)
	if name == "" {
		return map[string]any{"success": false, "error": "tool name missing"}
	}

	if e.tracker == nil {
		return failureResponse(map[string]any{"error": map[string]any{"message": "tracker unavailable", "tool": name}})
	}

	switch name {
	case "update_issue":
		identifier, _ := arguments["identifier"].(string)
		if strings.TrimSpace(identifier) == "" {
			return failureResponse(map[string]any{"error": map[string]any{"message": "update_issue requires a non-empty `identifier` string."}})
		}

		updates := make(map[string]any)
		if state, ok := arguments["state"].(string); ok && strings.TrimSpace(state) != "" {
			updates["state"] = strings.TrimSpace(state)
		}
		if assignee, ok := arguments["assignee_id"].(string); ok && strings.TrimSpace(assignee) != "" {
			updates["assignee_id"] = strings.TrimSpace(assignee)
		}
		if priority, ok := arguments["priority"].(float64); ok {
			updates["priority"] = int(priority)
		}

		issue, err := e.tracker.UpdateIssue(context.Background(), identifier, updates)
		if err != nil {
			return failureResponse(map[string]any{"error": map[string]any{"message": "issue update failed", "reason": err.Error()}})
		}
		return successResponse(map[string]any{"issue": issue})
	case "request_handoff":
		provider, _ := arguments["provider"].(string)
		reason, _ := arguments["reason"].(string)
		identifier, _ := arguments["identifier"].(string) // Optional, but useful if agent knows it

		if provider == "" || reason == "" {
			return failureResponse(map[string]any{"error": map[string]any{"message": "request_handoff requires `provider` and `reason`."}})
		}

		// If identifier is not provided, we can't easily find the issue from here 
		// without knowing the current session context.
		// However, the agent usually knows its own issue identifier.
		if identifier == "" {
			return failureResponse(map[string]any{"error": map[string]any{"message": "request_handoff requires `identifier` (e.g. OPS-123)."}})
		}

		updates := map[string]any{
			"assignee_id": "agent-" + strings.ToLower(provider),
		}

		issue, err := e.tracker.UpdateIssue(context.Background(), identifier, updates)
		if err != nil {
			return failureResponse(map[string]any{"error": map[string]any{"message": "handoff failed", "reason": err.Error()}})
		}

		return successResponse(map[string]any{
			"status": "handoff_initiated",
			"issue":  issue,
			"note":   "The orchestrator will switch to the new provider on the next turn cycle.",
		})
	case "tracker_query":
		arguments := arguments

		mode, _ := arguments["mode"].(string)
		switch strings.TrimSpace(mode) {
		case "issue_states_by_ids":
			ids := toStringSlice(arguments["issue_ids"])
			states, err := e.tracker.FetchIssueStatesByIDs(context.Background(), ids)
			if err != nil {
				return failureResponse(map[string]any{"error": map[string]any{"message": "issue state lookup failed", "reason": err.Error()}})
			}
			return successResponse(map[string]any{"states": states})
		case "issues_by_ids":
			ids := toStringSlice(arguments["issue_ids"])
			issues, err := e.tracker.FetchIssuesByIDs(context.Background(), ids)
			if err != nil {
				return failureResponse(map[string]any{"error": map[string]any{"message": "issues by ids lookup failed", "reason": err.Error()}})
			}
			return successResponse(map[string]any{"issues": issues})
		case "issues_by_states":
			states := toStringSlice(arguments["states"])
			issues, err := e.tracker.FetchIssuesByStates(context.Background(), states)
			if err != nil {
				return failureResponse(map[string]any{"error": map[string]any{"message": "issues by states lookup failed", "reason": err.Error()}})
			}
			return successResponse(map[string]any{"issues": issues})
		default:
			activeStates := toStringSlice(arguments["active_states"])
			issues, err := e.tracker.FetchCandidateIssues(context.Background(), activeStates)
			if err != nil {
				return failureResponse(map[string]any{"error": map[string]any{"message": "candidate issue lookup failed", "reason": err.Error()}})
			}
			return successResponse(map[string]any{"issues": issues})
		}
	default:
		return failureResponse(map[string]any{"error": map[string]any{"message": "tool unsupported in current runtime", "tool": name}})
	}
}

func successResponse(payload map[string]any) map[string]any {
	return map[string]any{
		"success": true,
		"contentItems": []map[string]any{{
			"type": "inputText",
			"text": encodePayload(payload),
		}},
	}
}

func failureResponse(payload map[string]any) map[string]any {
	return map[string]any{
		"success": false,
		"contentItems": []map[string]any{{
			"type": "inputText",
			"text": encodePayload(payload),
		}},
	}
}

func encodePayload(payload any) string {
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func toStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if stringsValue, okStrings := value.([]string); okStrings {
			return append([]string(nil), stringsValue...)
		}
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			trimmed := strings.TrimSpace(s)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}

func isObjectOrNil(value any) bool {
	if value == nil {
		return true
	}
	_, ok := value.(map[string]any)
	return ok
}
