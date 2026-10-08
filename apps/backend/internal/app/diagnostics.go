package app

import (
	"context"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
)

// Tool names, arguments and results remain in the execution subsystem. Only
// the observed lifetime and explicit success bit enter diagnostic storage.
func diagnosticTaskToolExecutor(recorder *diagnostics.Service, parent context.Context, fields diagnostics.Fields, execute agents.ToolExecutor) agents.ToolExecutor {
	if execute == nil {
		return nil
	}
	return func(ctx context.Context, name string, args map[string]any) map[string]any {
		ctx = diagnostics.ContextWithParent(ctx, parent)
		ctx, span := recorder.Start(ctx, "tool.execute", fields)
		status := "unknown"
		defer func() { span.End(status) }()
		result := execute(ctx, name, args)
		if success, ok := result["success"].(bool); ok {
			status = "ok"
			if !success {
				status = "error"
			}
		}
		if ctx.Err() != nil {
			status = "cancelled"
		}
		return result
	}
}
