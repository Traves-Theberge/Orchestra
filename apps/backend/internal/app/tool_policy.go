package app

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// taskToolPolicy restricts Orchestra-owned tool execution. It does not govern
// native provider tools, approval policies, or sandbox permissions.
type taskToolPolicy struct{ disabled map[string]struct{} }

func canonicalTaskToolName(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

func newTaskToolPolicy(disabled []string) taskToolPolicy {
	p := taskToolPolicy{disabled: make(map[string]struct{}, len(disabled))}
	for _, name := range disabled {
		if canonical := canonicalTaskToolName(name); canonical != "" {
			p.disabled[canonical] = struct{}{}
		}
	}
	return p
}

func (p taskToolPolicy) denies(name string) bool {
	_, denied := p.disabled[canonicalTaskToolName(name)]
	return denied
}

func (p taskToolPolicy) filterSpecs(specs []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(specs))
	for _, spec := range specs {
		if name, ok := spec["name"].(string); ok && !p.denies(name) {
			out = append(out, spec)
		}
	}
	return out
}

type mcpToolRoute func(context.Context, string, string, map[string]any) (map[string]any, error)

func (p taskToolPolicy) executor(mcpRoute mcpToolRoute, fallback agents.ToolExecutor) agents.ToolExecutor {
	return func(ctx context.Context, tool string, args map[string]any) map[string]any {
		// Never rely on tool advertisement as a permission boundary: a provider
		// can forge a call for a tool omitted from its specification list.
		if p.denies(tool) {
			return disabledTaskToolResult(tool)
		}
		if mcpRoute != nil && strings.Contains(tool, "_") {
			parts := strings.SplitN(tool, "_", 2)
			if result, err := mcpRoute(ctx, parts[0], parts[1], args); err == nil {
				return result
			}
		}
		return fallback(ctx, tool, args)
	}
}

func disabledTaskToolResult(tool string) map[string]any {
	// Match the existing tracker executor envelope so providers receive a tool
	// failure rather than a successful empty result or a transport failure.
	payload := struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Tool    string `json:"tool"`
		} `json:"error"`
	}{}
	payload.Error.Code = "TOOL_DISABLED"
	payload.Error.Message = "tool is disabled for this task"
	payload.Error.Tool = strings.TrimSpace(tool)
	text, _ := json.MarshalIndent(payload, "", "  ")
	return map[string]any{"success": false, "contentItems": []map[string]any{{"type": "inputText", "text": string(text)}}}
}
