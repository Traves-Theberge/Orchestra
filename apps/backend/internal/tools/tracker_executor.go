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
			"name":        "linear_graphql",
			"description": "Linear-compatible GraphQL adapter. Accepts one query per call and returns tracker-backed results.",
			"inputSchema": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"query"},
				"properties": map[string]any{
					"mode":          map[string]any{"type": "string"},
					"issue_ids":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"states":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"query":         map[string]any{"type": "string"},
					"variables":     map[string]any{"type": []string{"object", "null"}},
					"active_states": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
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
	case "tracker_query", "linear_graphql":
		if name == "linear_graphql" {
			normalized, ok := normalizeLinearGraphQLArguments(arguments)
			if !ok {
				return failureResponse(map[string]any{"error": map[string]any{"message": "`linear_graphql` expects either a GraphQL query string or an object with `query` and optional `variables`."}})
			}
			arguments = normalized
		}

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
			query, _ := arguments["query"].(string)
			if strings.TrimSpace(query) == "" {
				if name == "linear_graphql" {
					return failureResponse(map[string]any{"error": map[string]any{"message": "`linear_graphql` requires a non-empty `query` string."}})
				}
				activeStates := toStringSlice(arguments["active_states"])
				issues, err := e.tracker.FetchCandidateIssues(context.Background(), activeStates)
				if err != nil {
					return failureResponse(map[string]any{"error": map[string]any{"message": "candidate issue lookup failed", "reason": err.Error()}})
				}
				return successResponse(map[string]any{"issues": issues})
			}

			valid, reason := validateSingleGraphQLOperation(query)
			if !valid {
				return failureResponse(map[string]any{"error": map[string]any{"message": reason}})
			}
			if !isObjectOrNil(arguments["variables"]) {
				return failureResponse(map[string]any{"error": map[string]any{"message": "`linear_graphql.variables` must be a JSON object when provided."}})
			}

			if name == "linear_graphql" {
				if payload, routed, err := routeLinearGraphQLQuery(e.tracker, strings.TrimSpace(query), arguments); err != nil {
					return failureResponse(map[string]any{"error": map[string]any{"message": err.Error()}})
				} else if routed {
					return successResponse(payload)
				}
			}

			activeStates := toStringSlice(arguments["active_states"])
			issues, err := e.tracker.FetchCandidateIssues(context.Background(), activeStates)
			if err != nil {
				return failureResponse(map[string]any{"error": map[string]any{"message": "candidate issue lookup failed", "reason": err.Error()}})
			}
			return successResponse(map[string]any{"issues": issues, "query": strings.TrimSpace(query)})
		}
	default:
		return failureResponse(map[string]any{"error": map[string]any{"message": "tool unsupported in current runtime", "tool": name}})
	}
}

func routeLinearGraphQLQuery(client tracker.Client, query string, arguments map[string]any) (map[string]any, bool, error) {
	normalized := strings.ToLower(query)
	variables, _ := arguments["variables"].(map[string]any)

	if strings.Contains(normalized, "issues(ids") {
		ids := toStringSlice(arguments["issue_ids"])
		if len(ids) == 0 {
			ids = toStringSlice(variables["ids"])
		}
		issues, err := client.FetchIssuesByIDs(context.Background(), ids)
		if err != nil {
			return nil, true, err
		}
		return map[string]any{"issues": issues, "query": query}, true, nil
	}

	if strings.Contains(normalized, "issues(states") {
		states := toStringSlice(arguments["states"])
		if len(states) == 0 {
			states = toStringSlice(variables["states"])
		}
		issues, err := client.FetchIssuesByStates(context.Background(), states)
		if err != nil {
			return nil, true, err
		}
		return map[string]any{"issues": issues, "query": query}, true, nil
	}

	return nil, false, nil
}

func normalizeLinearGraphQLArguments(arguments map[string]any) (map[string]any, bool) {
	if arguments == nil {
		return map[string]any{}, true
	}
	if query, ok := arguments["query"].(string); ok {
		return arguments, strings.TrimSpace(query) != ""
	}
	raw, ok := arguments["arguments"]
	if !ok || raw == nil {
		return arguments, true
	}
	if str, ok := raw.(string); ok {
		trimmed := strings.TrimSpace(str)
		if trimmed == "" {
			return nil, false
		}
		return map[string]any{"query": trimmed}, true
	}
	if mapped, ok := raw.(map[string]any); ok {
		return mapped, true
	}
	return nil, false
}

func validateSingleGraphQLOperation(query string) (bool, string) {
	normalized := strings.ToLower(strings.TrimSpace(query))
	if normalized == "" {
		return false, "`linear_graphql` requires a non-empty `query` string."
	}
	queryCount := strings.Count(normalized, "query ")
	mutationCount := strings.Count(normalized, "mutation ")
	total := queryCount + mutationCount
	if total > 1 {
		return false, "`linear_graphql` supports exactly one GraphQL operation per tool call."
	}
	return true, ""
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
