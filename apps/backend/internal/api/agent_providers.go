package api

import (
	"encoding/json"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/fileconfig"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// validAgentProviders lists the recognized LLM provider IDs for the embedded
// agent widget. Only these providers can be configured via the API.
var validAgentProviders = []string{"openrouter", "claude", "openai", "gemini"}

// HandleGetAgentProviders returns the configuration status of all LLM providers.
// GET /api/v1/config/agent-providers
// Response: { "providers": { "openrouter": { "configured": true, "api_key": "sk-..." }, ... } }
func (s *Server) HandleGetAgentProviders(w http.ResponseWriter, r *http.Request) {
	stored := loadAgentProviders()

	providers := make(map[string]any, len(validAgentProviders))
	for _, id := range validAgentProviders {
		key, ok := stored[id]
		entry := map[string]any{
			"configured": ok && key != "",
		}
		if ok && key != "" {
			entry["api_key"] = key
		}
		providers[id] = entry
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"providers": providers,
	})
}

// HandleSaveAgentProvider saves an API key for a single LLM provider.
// POST /api/v1/config/agent-providers
// Body: { "provider": "claude", "api_key": "sk-..." }
func (s *Server) HandleSaveAgentProvider(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_body", "expected JSON with provider and api_key")
		return
	}

	provider := strings.TrimSpace(body.Provider)
	apiKey := strings.TrimSpace(body.APIKey)

	if provider == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_fields", "provider is required")
		return
	}

	valid := false
	for _, id := range validAgentProviders {
		if provider == id {
			valid = true
			break
		}
	}
	if !valid {
		writeJSONError(w, http.StatusBadRequest, "invalid_provider",
			fmt.Sprintf("provider must be one of: %s", strings.Join(validAgentProviders, ", ")))
		return
	}

	m := loadAgentProviders()
	if apiKey == "" {
		delete(m, provider)
	} else {
		m[provider] = apiKey
	}

	if err := saveAgentProviders(m); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "save_failed", "failed to save provider configuration")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"provider":   provider,
		"configured": apiKey != "",
	})
}

// --- helpers ---

func agentProvidersPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.Getenv("HOME"), ".orchestra", "agent-providers.json")
	}
	return filepath.Join(home, ".orchestra", "agent-providers.json")
}

func loadAgentProviders() map[string]string {
	data, err := os.ReadFile(agentProvidersPath())
	if err != nil {
		return make(map[string]string)
	}

	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		return make(map[string]string)
	}
	return m
}

func saveAgentProviders(m map[string]string) error {
	p := agentProvidersPath()
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return fileconfig.WritePrivate(p, data)
}
