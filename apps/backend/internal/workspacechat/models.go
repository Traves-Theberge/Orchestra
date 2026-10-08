package workspacechat

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
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
		if p == agents.ProviderClaude {
			return ModelCatalog{
				ProjectID:   pid,
				Provider:    string(p),
				Observation: "provider_catalog",
				Models: []agents.NativeModel{
					{ID: "claude-fable-5-1", Model: "claude-fable-5-1", DisplayName: "Claude Fable 5.1"},
					{ID: "claude-opus-5-5", Model: "claude-opus-5-5", DisplayName: "Claude Opus 5.5"},
					{ID: "claude-sonnet-5-5", Model: "claude-sonnet-5-5", DisplayName: "Claude Sonnet 5.5", IsDefault: true},
					{ID: "claude-haiku-5-5", Model: "claude-haiku-5-5", DisplayName: "Claude Haiku 5.5"},
				},
			}, nil
		}
		if p == agents.ProviderOpenCode {
			models, err := openCodeModels(ctx)
			if err != nil {
				return ModelCatalog{}, fmt.Errorf("%w: %v", ErrUnsupported, err)
			}
			return ModelCatalog{ProjectID: pid, Provider: string(p), Models: models, Observation: "provider_catalog"}, nil
		}
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

var openCodeModelLine = regexp.MustCompile(`^[A-Za-z0-9._-]+/[A-Za-z0-9._:/-]+$`)

// openCodeCatalog caches `opencode models` (provider/model per line); the CLI
// reads every configured provider, so it is too slow to run on each picker open.
var openCodeCatalog struct {
	sync.Mutex
	at     time.Time
	models []agents.NativeModel
}

// runOpenCodeModels is swapped in tests.
var runOpenCodeModels = func(ctx context.Context) ([]byte, error) {
	return backgroundcommand.CommandContext(ctx, "opencode", "models").Output()
}

func openCodeModels(ctx context.Context) ([]agents.NativeModel, error) {
	openCodeCatalog.Lock()
	defer openCodeCatalog.Unlock()
	if openCodeCatalog.models != nil && time.Since(openCodeCatalog.at) < 5*time.Minute {
		return openCodeCatalog.models, nil
	}
	readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := runOpenCodeModels(readCtx)
	if err != nil {
		return nil, fmt.Errorf("opencode models: %w", err)
	}
	models := parseOpenCodeModels(string(out))
	openCodeCatalog.at, openCodeCatalog.models = time.Now(), models
	return models, nil
}

func parseOpenCodeModels(out string) []agents.NativeModel {
	models := []agents.NativeModel{}
	for _, line := range strings.Split(out, "\n") {
		id := strings.TrimSpace(line)
		if !openCodeModelLine.MatchString(id) {
			continue
		}
		models = append(models, agents.NativeModel{ID: id, Model: id, DisplayName: id})
	}
	return models
}
