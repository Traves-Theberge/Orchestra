package workspacechat

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
)

// This lock is independent of Service.mu: provider callbacks and tool execution
// can occur while a request holds the conversation ownership lock.
type diagnosticTurn struct {
	mu               sync.Mutex
	ctx              context.Context
	root, provider   *diagnostics.Span
	fields           diagnostics.Fields
	turnID           string
	items, approvals map[string]*diagnostics.Span
	usage            *agents.TokenUsage
}

func (s *Service) beginDiagnosticTurn(ctx context.Context, sess Session, turn agents.TurnRequest) *diagnosticTurn {
	fields := diagnostics.Fields{ProjectID: sess.ProjectID, SessionID: sess.ID, RunID: turn.SessionID, Provider: sess.Provider, Model: turn.RequestedModel, Attempt: 1}
	ctx, root := s.diagnostics.Start(ctx, "chat.turn", fields)
	ctx, provider := s.diagnostics.Start(ctx, "provider.turn", fields)
	current := &diagnosticTurn{ctx: ctx, root: root, provider: provider, fields: fields, items: map[string]*diagnostics.Span{}, approvals: map[string]*diagnostics.Span{}}
	s.diagnosticTurns.Store(sess.ID, current)
	root.Event("chat.accepted", "info")
	root.Event("feature.chat.send", "info")
	return current
}
func (s *Service) endDiagnosticTurn(id string, current *diagnosticTurn, status string) {
	s.diagnosticTurns.CompareAndDelete(id, current)
	current.mu.Lock()
	defer current.mu.Unlock()
	for _, span := range current.items {
		span.End("unknown")
	}
	for _, span := range current.approvals {
		span.End("unknown")
	}
	if current.usage != nil {
		current.provider.Usage(current.usage.InputTokens, current.usage.OutputTokens)
	}
	switch status {
	case "error":
		current.root.Event("chat.failed", "error")
	case "cancelled":
		current.root.Event("chat.cancelled", "warn")
	case "unknown":
		current.root.Event("chat.unknown", "warn")
	default:
		current.root.Event("chat.completed", "info")
	}
	current.provider.End(status)
	current.root.End(status)
}
func (s *Service) diagnosticNativeEvent(id string, e agents.NativeEvent) {
	value, ok := s.diagnosticTurns.Load(id)
	if !ok {
		return
	}
	current := value.(*diagnosticTurn)
	current.mu.Lock()
	defer current.mu.Unlock()
	if e.Type == "turn/started" && e.TurnID != "" && current.turnID == "" {
		current.turnID = e.TurnID
	}
	if e.TurnID != "" && (current.turnID == "" || current.turnID != e.TurnID) {
		return
	}
	if e.Usage != nil {
		usage := e.Usage.Last
		current.usage = &usage
	}
	var payload struct {
		Method string `json:"method"`
		Item   struct {
			ID, Type, Status string
			ExitCode         *int `json:"exitCode"`
		} `json:"item"`
	}
	if len(e.Payload) > 0 {
		_ = json.Unmarshal(e.Payload, &payload)
	}
	itemID := e.ItemID
	if itemID == "" {
		itemID = payload.Item.ID
	}
	switch e.Type {
	case "item/started":
		switch payload.Item.Type {
		case "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall":
		default:
			return
		}
		if itemID != "" && current.items[itemID] == nil {
			_, span := s.diagnostics.Start(current.ctx, "provider.tool", current.fields)
			current.items[itemID] = span
			span.Event("tool.started", "info")
		}
	case "item/completed":
		if span := current.items[itemID]; span != nil {
			status := "unknown"
			switch payload.Item.Status {
			case "completed":
				status = "ok"
			case "failed", "error":
				status = "error"
			case "cancelled", "interrupted":
				status = "cancelled"
			}
			if payload.Item.ExitCode != nil {
				status = "ok"
				if *payload.Item.ExitCode != 0 {
					status = "error"
				}
			}
			span.End(status)
			delete(current.items, itemID)
		}
	case "server_request":
		switch payload.Method {
		case "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/tool/requestUserInput":
		default:
			return
		}
		if e.RequestID != "" && current.approvals[e.RequestID] == nil {
			_, span := s.diagnostics.Start(current.ctx, "approval.wait", current.fields)
			current.approvals[e.RequestID] = span
			span.Event("approval.requested", "info")
		}
	}
}
func (s *Service) diagnosticApprovalAnswered(id, requestID, status string) {
	value, ok := s.diagnosticTurns.Load(id)
	if !ok {
		return
	}
	current := value.(*diagnosticTurn)
	current.mu.Lock()
	defer current.mu.Unlock()
	if span := current.approvals[requestID]; span != nil {
		span.Event("approval.responded", "info")
		span.End(status)
		delete(current.approvals, requestID)
	}
}

// Native processes reuse this executor across turns. Resolve the current turn
// at invocation instead of retaining the first request's trace context.
func (s *Service) diagnosticToolExecutor(id string, execute agents.ToolExecutor) agents.ToolExecutor {
	if execute == nil {
		return nil
	}
	return func(ctx context.Context, name string, args map[string]any) map[string]any {
		value, ok := s.diagnosticTurns.Load(id)
		if !ok {
			return execute(ctx, name, args)
		}
		current := value.(*diagnosticTurn)
		ctx = diagnostics.ContextWithParent(ctx, current.ctx)
		ctx, span := s.diagnostics.Start(ctx, "tool.execute", current.fields)
		status := "unknown"
		defer func() { span.End(status) }()
		result := execute(ctx, name, args)
		status = "unknown"
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
func diagnosticOutcome(ctx context.Context, status string) string {
	if ctx.Err() != nil || status == "cancelled" || status == "interrupted" {
		return "cancelled"
	}
	switch status {
	case "completed", "idle":
		return "ok"
	case "failed":
		return "error"
	default:
		return "unknown"
	}
}
