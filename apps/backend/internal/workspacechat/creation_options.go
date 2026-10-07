package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func (s *Service) CreateWithRequest(ctx context.Context, pid string, req CreateRequest) (Session, error) {
	if req.ClientSessionID != "" {
		id, err := uuid.Parse(req.ClientSessionID)
		if err != nil || id == uuid.Nil || len(req.ClientSessionID) != 36 || id.String() != strings.ToLower(req.ClientSessionID) {
			return Session{}, ErrInvalid
		}
		req.ClientSessionID = id.String()
	}
	// Catalog observations may start a disposable runtime and must not hold
	// the service mutex. Existing creation identities use their immutable
	// preferences even if the current provider catalog is unavailable.
	existing := false
	if req.ClientSessionID != "" {
		var id string
		err := s.db.QueryRowContext(ctx, `SELECT id FROM workspace_chat_sessions WHERE id=?`, req.ClientSessionID).Scan(&id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Session{}, err
		}
		existing = err == nil
	}
	if hasAgentIntent(req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat) {
		if existing {
			if err := s.matchAgentIntent(ctx, req.ClientSessionID, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat); err != nil {
				return Session{}, err
			}
		} else if err := s.validateAgentIntent(ctx, pid, req.Provider, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat); err != nil {
			return Session{}, err
		}
	}
	if !existing && (req.RequestedModel != "" || req.RequestedReasoningEffort != "") {
		if err := s.validateCreationOptions(ctx, pid, req); err != nil {
			return Session{}, err
		}
	}
	return s.createWithRequest(ctx, pid, req)
}

func hasAgentIntent(id, scope, hash, format string) bool {
	return id != "" || scope != "" || hash != "" || format != ""
}

func (s *Service) validateAgentIntent(ctx context.Context, pid, provider, id, scope, hash, format string) error {
	_, err := s.resolveAgentIntent(ctx, pid, provider, id, scope, hash, format)
	return err
}

// resolveAgentIntent resolves a selection to the exact profile the harness
// adapter applies, and checks the adapter can apply it. Stable agent ids
// ("<source>:<scope>:<harness|orchestra>:<name>") carry their scope, so scope
// and content hash are optional for them (automations send only the id);
// legacy bare ids still require scope and hash.
func (s *Service) resolveAgentIntent(ctx context.Context, pid, provider, id, scope, hash, format string) (*agents.ResolvedAgent, error) {
	_, parsedScope, _, _, stable := agentcatalog.ParseAgentID(id)
	if id == "" || scope != "" && scope != string(agentcatalog.ScopeProject) && scope != string(agentcatalog.ScopeGlobal) {
		return nil, ErrInvalid
	}
	if !stable && (scope == "" || hash == "") {
		return nil, ErrInvalid
	}
	if stable && scope != "" && agentcatalog.Scope(scope) != parsedScope {
		return nil, ErrInvalid
	}
	if stable {
		scope = string(parsedScope)
	}
	if pid == OrchestratorScope && scope != string(agentcatalog.ScopeGlobal) {
		return nil, ErrForbidden
	}
	if s.agentCatalog == nil {
		return nil, fmt.Errorf("%w: agent catalog is unavailable", ErrUnsupported)
	}
	workspaceID, _, _, err := s.scope(ctx, pid)
	if err != nil {
		return nil, err
	}
	resolved, err := s.agentCatalog.ResolveAgent(ctx, agentcatalog.ResolveRequest{ProjectID: pid, WorkspaceID: workspaceID, Harness: provider, AgentID: id, Scope: scope, Hash: hash, Format: format})
	if err != nil {
		if errors.Is(err, agentcatalog.ErrInvalid) {
			return nil, ErrInvalid
		}
		if errors.Is(err, agentcatalog.ErrForbidden) {
			return nil, ErrForbidden
		}
		if errors.Is(err, agentcatalog.ErrNotFound) || errors.Is(err, agentcatalog.ErrConflict) {
			return nil, fmt.Errorf("%w: %v", ErrConflict, err)
		}
		return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	turn := agents.TurnRequest{ProjectID: pid, RequestedAgentID: id, RequestedAgentScope: scope, RequestedAgentContentHash: hash, RequestedAgentFormat: format, RuntimeTarget: agents.RuntimeLocal, Agent: resolved}
	if err = s.registry.ValidateTurnOptions(agents.NormalizeProvider(provider), turn); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	return resolved, nil
}

func (s *Service) matchAgentIntent(ctx context.Context, sessionID, id, scope, hash, format string) error {
	var storedID, storedScope, storedHash, storedFormat string
	err := s.db.QueryRowContext(ctx, `SELECT requested_agent_id,scope,content_hash,format FROM workspace_chat_agent_selection WHERE session_id=?`, sessionID).Scan(&storedID, &storedScope, &storedHash, &storedFormat)
	if errors.Is(err, sql.ErrNoRows) {
		storedID, storedScope, storedHash, storedFormat = "", "", "", ""
		err = nil
	}
	if err != nil {
		return err
	}
	if storedID != id || storedScope != scope || storedHash != hash || storedFormat != format {
		return ErrConflict
	}
	return nil
}

func (s *Service) validateCreationOptions(ctx context.Context, pid string, req CreateRequest) error {
	if req.RequestedModel == "" || len(req.RequestedModel) > 200 || !s.supportsNative(agents.NormalizeProvider(req.Provider)) {
		return ErrUnsupported
	}
	if req.RequestedReasoningEffort != "" && !effortName.MatchString(req.RequestedReasoningEffort) {
		return ErrUnsupported
	}
	catalog, err := s.Models(ctx, pid, req.Provider)
	if err != nil {
		return err
	}
	for _, model := range catalog.Models {
		if model.Hidden || model.Model != req.RequestedModel {
			continue
		}
		if req.RequestedReasoningEffort == "" {
			return nil
		}
		for _, effort := range model.SupportedReasoningEfforts {
			if effort.ReasoningEffort == req.RequestedReasoningEffort {
				return nil
			}
		}
		return fmt.Errorf("%w: reasoning effort is not advertised for selected model", ErrUnsupported)
	}
	return fmt.Errorf("%w: selected model is absent from provider catalog", ErrUnsupported)
}

func (s *Service) matchCreationOptions(ctx context.Context, id string, req CreateRequest) error {
	var model, effort string
	err := s.db.QueryRowContext(ctx, `SELECT requested_model,effort FROM workspace_chat_creation_options WHERE session_id=?`, id).Scan(&model, &effort)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if model != req.RequestedModel || effort != req.RequestedReasoningEffort {
		return ErrConflict
	}
	return s.matchAgentIntent(ctx, id, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat)
}
