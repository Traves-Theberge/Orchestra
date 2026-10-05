package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
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
	if !existing && (req.RequestedModel != "" || req.RequestedReasoningEffort != "") {
		if err := s.validateCreationOptions(ctx, pid, req); err != nil {
			return Session{}, err
		}
	}
	return s.createWithRequest(ctx, pid, req)
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
	return nil
}
