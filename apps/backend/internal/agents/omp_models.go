package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ompCatalog caches `omp models --json`. The listing reads omp's local model
// database (refreshing it over the network when stale), so it is cached
// rather than run on every picker open.
var ompCatalog struct {
	sync.Mutex
	at      time.Time
	command string
	models  []NativeModel
}

// runOMPModels is swapped in tests.
var runOMPModels = func(ctx context.Context, binary string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, binary, "models", "--json")
	cmd.Env = safeSubprocessEnv("", ProviderOMP)
	return cmd.Output()
}

func ompModels(ctx context.Context, command string) ([]NativeModel, error) {
	binary, err := resolveNativeExecutable("omp", command)
	if err != nil {
		return nil, err
	}
	ompCatalog.Lock()
	defer ompCatalog.Unlock()
	if ompCatalog.models != nil && ompCatalog.command == binary && time.Since(ompCatalog.at) < 5*time.Minute {
		return ompCatalog.models, nil
	}
	readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := runOMPModels(readCtx, binary)
	if err != nil {
		return nil, fmt.Errorf("omp models: %w", err)
	}
	models, err := parseOMPModels(out)
	if err != nil {
		return nil, err
	}
	ompCatalog.at, ompCatalog.command, ompCatalog.models = time.Now(), binary, models
	return models, nil
}

// parseOMPModels reads chat models from `omp models --json`. Ids are omp's
// "provider/model" selectors, which rpc set_model and --model both accept.
// Catalog presence reflects omp's configured providers, not entitlement.
func parseOMPModels(raw []byte) ([]NativeModel, error) {
	var listing struct {
		Models *[]struct {
			Provider      string   `json:"provider"`
			Kind          string   `json:"kind"`
			ID            string   `json:"id"`
			Selector      string   `json:"selector"`
			Name          string   `json:"name"`
			ContextWindow int64    `json:"contextWindow"`
			Thinking      []string `json:"thinking"`
			Input         []string `json:"input"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &listing); err != nil || listing.Models == nil {
		return nil, errors.New("omp model catalog response is malformed")
	}
	names := map[string]int{}
	for _, m := range *listing.Models {
		names[m.Name]++
	}
	models := []NativeModel{}
	for _, m := range *listing.Models {
		if m.Kind != "" && m.Kind != "chat" || strings.TrimSpace(m.ID) == "" {
			continue
		}
		selector := m.Selector
		if selector == "" {
			selector = ompSelector(m.Provider, m.ID)
		}
		display := firstNonEmpty(m.Name, m.ID)
		if names[m.Name] > 1 && m.Provider != "" {
			// The same model is often reachable through several providers.
			display += " (" + m.Provider + ")"
		}
		efforts := make([]NativeReasoningEffort, 0, len(m.Thinking))
		for _, level := range m.Thinking {
			efforts = append(efforts, NativeReasoningEffort{ReasoningEffort: level})
		}
		modalities := m.Input
		if modalities == nil {
			modalities = []string{}
		}
		description := m.Provider
		if m.ContextWindow > 0 {
			description = fmt.Sprintf("%s · %dK context", m.Provider, m.ContextWindow/1000)
		}
		models = append(models, NativeModel{ID: selector, Model: selector, DisplayName: display, Description: description, SupportedReasoningEfforts: efforts, InputModalities: modalities})
		if len(models) > 4096 {
			return nil, errors.New("omp model catalog exceeds size bound")
		}
	}
	return models, nil
}
