package presenter

import (
	"fmt"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
)

func StatePayload(snapshot orchestrator.Snapshot) map[string]any {
	running := make([]map[string]any, 0, len(snapshot.Running))
	for _, entry := range snapshot.Running {
		running = append(running, map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"state":            entry.State,
			"session_id":       entry.SessionID,
			"session_log_path": entry.SessionLogPath,
			"turn_count":       entry.TurnCount,
			"last_event":       entry.LastEvent,
			"last_message":     humanizeMessage(entry.LastMessage),
			"last_event_at":    entry.LastEventAt,
			"started_at":       entry.StartedAt,
			"provider":         entry.Provider,
			"disabled_tools":   entry.DisabledTools,
			"tokens": map[string]any{
				"input_tokens":  entry.Tokens.InputTokens,
				"output_tokens": entry.Tokens.OutputTokens,
				"total_tokens":  entry.Tokens.TotalTokens,
			},
		})
	}

	retrying := make([]map[string]any, 0, len(snapshot.Retrying))
	for _, entry := range snapshot.Retrying {
		retrying = append(retrying, map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"state":            entry.State,
			"attempt":          entry.Attempt,
			"due_at":           entry.DueAt,
			"error":            humanizeMessage(entry.Error),
		})
	}

	return map[string]any{
		"generated_at": snapshot.GeneratedAt,
		"counts": map[string]any{
			"running":  snapshot.Counts.Running,
			"retrying": snapshot.Counts.Retrying,
		},
		"running":      running,
		"retrying":     retrying,
		"codex_totals": snapshot.CodexTotals,
		"rate_limits":  snapshot.RateLimits,
	}
}

func IssuePayload(snapshot orchestrator.Snapshot, issueIdentifier string) (map[string]any, bool) {
	runtime, ok := lookupRuntime(snapshot, issueIdentifier)
	if !ok {
		return nil, false
	}

	status := "tracked"
	if runtime["running"] != nil {
		status = "running"
	}
	if runtime["retry"] != nil {
		status = "retrying"
	}

	payload := map[string]any{
		"issue_identifier": runtime["issue_identifier"],
		"issue_id":         runtime["issue_id"],
		"status":           status,
		"running":          runtime["running"],
		"retry":            runtime["retry"],
	}

	return payload, true
}

func lookupRuntime(snapshot orchestrator.Snapshot, issueIdentifier string) (map[string]any, bool) {
	for _, running := range snapshot.Running {
		if running.IssueIdentifier == issueIdentifier {
			return map[string]any{
				"issue_identifier": running.IssueIdentifier,
				"issue_id":         running.IssueID,
				"running": map[string]any{
					"state":            running.State,
					"session_id":       running.SessionID,
					"session_log_path": running.SessionLogPath,
					"turn_count":       running.TurnCount,
					"provider":         running.Provider,
					"disabled_tools":   running.DisabledTools,
				},
				"retry": nil,
			}, true
		}
	}

	for _, retry := range snapshot.Retrying {
		if retry.IssueIdentifier == issueIdentifier {
			return map[string]any{
				"issue_identifier": retry.IssueIdentifier,
				"issue_id":         retry.IssueID,
				"running":          nil,
				"retry": map[string]any{
					"state":          retry.State,
					"attempt":        retry.Attempt,
					"due_at":         retry.DueAt,
					"error":          humanizeMessage(retry.Error),
					"provider":       retry.Provider,
					"disabled_tools": retry.DisabledTools,
				},
			}, true
		}
	}

	return nil, false
}

func humanizeMessage(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= 240 {
		return trimmed
	}
	return fmt.Sprintf("%s...", strings.TrimSpace(trimmed[:237]))
}
