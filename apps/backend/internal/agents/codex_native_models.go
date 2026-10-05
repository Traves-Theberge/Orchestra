package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type NativeReasoningEffort struct {
	ReasoningEffort string `json:"reasoning_effort"`
	Description     string `json:"description"`
}
type NativeModel struct {
	ID                        string                  `json:"id"`
	Model                     string                  `json:"model"`
	DisplayName               string                  `json:"display_name"`
	Description               string                  `json:"description"`
	IsDefault                 bool                    `json:"is_default"`
	Hidden                    bool                    `json:"hidden"`
	DefaultReasoningEffort    string                  `json:"default_reasoning_effort,omitempty"`
	SupportedReasoningEfforts []NativeReasoningEffort `json:"supported_reasoning_efforts"`
	InputModalities           []string                `json:"input_modalities"`
}

// NativeModels observes a provider's actual catalog without creating/resuming a
// thread or sending inference. Catalog presence is not an entitlement check.
func (r *Registry) NativeModels(ctx context.Context, provider Provider, request TurnRequest) ([]NativeModel, error) {
	var accountErr error
	request, accountErr = r.bindAccount(provider, request)
	if accountErr != nil {
		return nil, accountErr
	}
	if !r.SupportsNativeSession(provider) {
		return nil, fmt.Errorf("native model catalog unsupported for provider %s", provider)
	}
	if request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal {
		return nil, errors.New("native remote model catalog unsupported")
	}
	command, _ := r.NativeCommandFor(provider)
	catalogCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	session, err := startCodexNativeProcess(catalogCtx, command, request, nil)
	if err != nil {
		return nil, err
	}
	defer session.Close()
	models := make([]NativeModel, 0)
	cursor := ""
	seen := map[string]bool{}
	for page := 0; page < 32; page++ {
		params := map[string]any{"limit": 100, "includeHidden": false}
		if cursor != "" {
			params["cursor"] = cursor
		}
		raw, err := session.rpc(catalogCtx, "model/list", params)
		if err != nil {
			return nil, err
		}
		var response struct {
			Data *[]struct {
				ID                        string   `json:"id"`
				Model                     string   `json:"model"`
				DisplayName               string   `json:"displayName"`
				Description               string   `json:"description"`
				IsDefault                 bool     `json:"isDefault"`
				Hidden                    bool     `json:"hidden"`
				DefaultReasoningEffort    string   `json:"defaultReasoningEffort"`
				InputModalities           []string `json:"inputModalities"`
				SupportedReasoningEfforts []struct {
					ReasoningEffort string `json:"reasoningEffort"`
					Description     string `json:"description"`
				} `json:"supportedReasoningEfforts"`
			} `json:"data"`
			NextCursor *string `json:"nextCursor"`
		}
		if err = json.Unmarshal(raw, &response); err != nil || response.Data == nil {
			return nil, errors.New("native model catalog response is malformed")
		}
		for _, wire := range *response.Data {
			if strings.TrimSpace(wire.ID) == "" || strings.TrimSpace(wire.Model) == "" {
				return nil, errors.New("native catalog model identity missing")
			}
			efforts := make([]NativeReasoningEffort, 0, len(wire.SupportedReasoningEfforts))
			for _, effort := range wire.SupportedReasoningEfforts {
				efforts = append(efforts, NativeReasoningEffort{ReasoningEffort: effort.ReasoningEffort, Description: effort.Description})
			}
			modalities := wire.InputModalities
			if modalities == nil {
				modalities = []string{}
			}
			models = append(models, NativeModel{ID: wire.ID, Model: wire.Model, DisplayName: wire.DisplayName, Description: wire.Description, IsDefault: wire.IsDefault, Hidden: wire.Hidden, DefaultReasoningEffort: wire.DefaultReasoningEffort, SupportedReasoningEfforts: efforts, InputModalities: modalities})
			if len(models) > 4096 {
				return nil, errors.New("native model catalog exceeds size bound")
			}
		}
		if response.NextCursor == nil || *response.NextCursor == "" {
			return models, nil
		}
		cursor = *response.NextCursor
		if seen[cursor] {
			return nil, errors.New("native model catalog cursor repeated")
		}
		seen[cursor] = true
	}
	return nil, errors.New("native model catalog exceeds page bound")
}
