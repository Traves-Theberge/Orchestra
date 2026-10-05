package workspacechat

import (
	"context"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"regexp"
	"time"
)

var effortName = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)

func (s *Service) validateEffort(ctx context.Context, pid, provider, accountID, model, effort string) error {
	if !effortName.MatchString(effort) {
		return ErrUnsupported
	}
	catalog, err := s.modelsForAccount(ctx, pid, provider, accountID)
	if err != nil {
		return err
	}
	for _, entry := range catalog.Models {
		if !entry.Hidden && entry.Model == model {
			for _, option := range entry.SupportedReasoningEfforts {
				if option.ReasoningEffort == effort {
					return nil
				}
			}
			return fmt.Errorf("%w: reasoning effort is not advertised for selected model", ErrUnsupported)
		}
	}
	return fmt.Errorf("%w: selected model is absent from provider catalog", ErrUnsupported)
}

type modelRegistry interface {
	NativeModels(context.Context, agents.Provider, agents.TurnRequest) ([]agents.NativeModel, error)
}
type ModelCatalog struct {
	ProjectID   string               `json:"project_id"`
	Provider    string               `json:"provider"`
	Models      []agents.NativeModel `json:"models"`
	Observation string               `json:"observation"`
}

// Models is a provider catalog observation, not login or entitlement proof.
// It initializes a disposable native runtime without creating a provider thread.
func (s *Service) Models(ctx context.Context, pid, provider string) (ModelCatalog, error) {
	return s.modelsForAccount(ctx, pid, provider, "")
}

func (s *Service) modelsForAccount(ctx context.Context, pid, provider, accountID string) (ModelCatalog, error) {
	root, err := s.root(ctx, pid)
	if err != nil {
		return ModelCatalog{}, err
	}
	p := agents.NormalizeProvider(provider)
	r, ok := s.registry.(modelRegistry)
	if !ok || !s.supportsNative(p) {
		return ModelCatalog{}, ErrUnsupported
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ModelCatalog{}, fmt.Errorf("chat service shutting down")
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	models, err := r.NativeModels(readCtx, p, agents.TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, RuntimeTarget: agents.RuntimeLocal, AccountID: accountID})
	if err != nil {
		return ModelCatalog{}, err
	}
	if models == nil {
		models = []agents.NativeModel{}
	}
	return ModelCatalog{ProjectID: pid, Provider: string(p), Models: models, Observation: "provider_catalog"}, nil
}
