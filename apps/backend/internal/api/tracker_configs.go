package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// trackerConfigDTO is the JSON shape returned to API clients.
// TokenEnc is always redacted to "***" if a token exists; RefreshEnc never appears.
type trackerConfigDTO struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
	Endpoint    string `json:"endpoint"`
	AuthMethod  string `json:"auth_method"`
	HasToken    bool   `json:"has_token"`
	Extra       string `json:"extra,omitempty"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

func toDTO(cfg db.TrackerConfig) trackerConfigDTO {
	return trackerConfigDTO{
		ID:          cfg.ID,
		Type:        cfg.Type,
		DisplayName: cfg.DisplayName,
		Endpoint:    cfg.Endpoint,
		AuthMethod:  cfg.AuthMethod,
		HasToken:    cfg.TokenEnc != "",
		Extra:       cfg.Extra,
		CreatedAt:   cfg.CreatedAt,
		UpdatedAt:   cfg.UpdatedAt,
	}
}

// GetTrackerConfigs handles GET /api/v1/tracker/configs.
func (s *Server) GetTrackerConfigs(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_db", "database not available")
		return
	}
	configs, err := s.db.ListTrackerConfigs(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	out := make([]trackerConfigDTO, 0, len(configs))
	for _, c := range configs {
		out = append(out, toDTO(c))
	}
	writeJSON(w, http.StatusOK, out)
}

// PostTrackerConfig handles POST /api/v1/tracker/configs.
func (s *Server) PostTrackerConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_db", "database not available")
		return
	}
	var req struct {
		Type        string         `json:"type"`
		DisplayName string         `json:"display_name"`
		Endpoint    string         `json:"endpoint"`
		AuthMethod  string         `json:"auth_method"`
		Token       string         `json:"token"`
		Extra       map[string]any `json:"extra"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	req.Type = strings.ToLower(strings.TrimSpace(req.Type))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.Type == "" || req.DisplayName == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_fields", "type and display_name are required")
		return
	}
	if req.AuthMethod == "" {
		req.AuthMethod = "apikey"
	}

	encToken, err := db.EncryptToken(req.Token)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "encrypt_error", "failed to encrypt token")
		return
	}
	extraJSON := ""
	if req.Extra != nil {
		b, err := json.Marshal(req.Extra)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid_extra", "extra must be a JSON object")
			return
		}
		extraJSON = string(b)
	}

	now := time.Now().Unix()
	cfg := db.TrackerConfig{
		ID:          uuid.New().String(),
		Type:        req.Type,
		DisplayName: req.DisplayName,
		Endpoint:    strings.TrimSpace(req.Endpoint),
		AuthMethod:  req.AuthMethod,
		TokenEnc:    encToken,
		Extra:       extraJSON,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.db.UpsertTrackerConfig(r.Context(), cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if s.registry != nil {
		if err := s.registry.Reload(r.Context(), cfg.ID); err != nil {
			s.logger.Warn().Err(err).Str("config_id", cfg.ID).Msg("registry reload failed after create")
		}
	}
	writeJSON(w, http.StatusCreated, toDTO(cfg))
}

// PatchTrackerConfig handles PATCH /api/v1/tracker/configs/{config_id}.
func (s *Server) PatchTrackerConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_db", "database not available")
		return
	}
	configID := chi.URLParam(r, "config_id")
	existing, err := s.db.GetTrackerConfig(r.Context(), configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "tracker config not found")
		return
	}

	var req struct {
		DisplayName *string        `json:"display_name"`
		Endpoint    *string        `json:"endpoint"`
		AuthMethod  *string        `json:"auth_method"`
		Token       *string        `json:"token"`
		Extra       map[string]any `json:"extra"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.DisplayName != nil {
		existing.DisplayName = strings.TrimSpace(*req.DisplayName)
	}
	if req.Endpoint != nil {
		existing.Endpoint = strings.TrimSpace(*req.Endpoint)
	}
	if req.AuthMethod != nil && *req.AuthMethod != "" {
		existing.AuthMethod = *req.AuthMethod
	}
	if req.Token != nil && *req.Token != "" {
		enc, err := db.EncryptToken(*req.Token)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "encrypt_error", "failed to encrypt token")
			return
		}
		existing.TokenEnc = enc
	}
	if req.Extra != nil {
		b, err := json.Marshal(req.Extra)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid_extra", "extra must be a JSON object")
			return
		}
		existing.Extra = string(b)
	}

	if err := s.db.UpsertTrackerConfig(r.Context(), *existing); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if s.registry != nil {
		if err := s.registry.Reload(r.Context(), configID); err != nil {
			s.logger.Warn().Err(err).Str("config_id", configID).Msg("registry reload failed after patch")
		}
	}
	writeJSON(w, http.StatusOK, toDTO(*existing))
}

// DeleteTrackerConfig handles DELETE /api/v1/tracker/configs/{config_id}.
func (s *Server) DeleteTrackerConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_db", "database not available")
		return
	}
	configID := chi.URLParam(r, "config_id")
	if err := s.db.DeleteTrackerConfig(r.Context(), configID); err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "tracker config not found")
		return
	}
	if s.registry != nil {
		// Reload will detect the row is gone via sql.ErrNoRows and remove the adapter.
		_ = s.registry.Reload(r.Context(), configID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// PostTrackerConfigTest handles POST /api/v1/tracker/configs/{config_id}/test.
// Pings the underlying tracker via Adapter.Ping and returns ok+error.
func (s *Server) PostTrackerConfigTest(w http.ResponseWriter, r *http.Request) {
	if s.registry == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_registry", "registry not available")
		return
	}
	configID := chi.URLParam(r, "config_id")
	a, err := s.registry.GetAdapter(configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "adapter not loaded for config")
		return
	}
	if err := a.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GetTrackerProjects handles GET /api/v1/tracker/configs/{config_id}/projects.
func (s *Server) GetTrackerProjects(w http.ResponseWriter, r *http.Request) {
	a, err := s.adapterFromConfigParam(r)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	projects, err := a.FetchProjects(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	if projects == nil {
		projects = []tracker.TrackerProject{}
	}
	writeJSON(w, http.StatusOK, projects)
}

// GetTrackerStates handles GET /api/v1/tracker/configs/{config_id}/states.
func (s *Server) GetTrackerStates(w http.ResponseWriter, r *http.Request) {
	a, err := s.adapterFromConfigParam(r)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	states, err := a.FetchStates(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	if states == nil {
		states = []tracker.TrackerState{}
	}
	writeJSON(w, http.StatusOK, states)
}

// GetTrackerConfigIssues handles GET /api/v1/tracker/configs/{config_id}/issues.
// Powers the viewer browse panel — returns WorkItems directly from the adapter.
func (s *Server) GetTrackerConfigIssues(w http.ResponseWriter, r *http.Request) {
	a, err := s.adapterFromConfigParam(r)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	q := r.URL.Query()
	filter := tracker.Filter{}
	if states := q.Get("states"); states != "" {
		filter.States = strings.Split(states, ",")
	}
	items, err := a.Fetch(r.Context(), filter)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	if items == nil {
		items = []tracker.WorkItem{}
	}
	writeJSON(w, http.StatusOK, items)
}

// PostProjectTrackerConfig handles POST /api/v1/projects/{project_id}/tracker.
// Pass {"config_id": ""} to clear the assignment.
func (s *Server) PostProjectTrackerConfig(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_db", "database not available")
		return
	}
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		ConfigID string `json:"config_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := s.db.SetProjectTrackerConfig(r.Context(), projectID, req.ConfigID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// adapterFromConfigParam pulls config_id from the URL and returns the adapter.
func (s *Server) adapterFromConfigParam(r *http.Request) (tracker.Adapter, error) {
	if s.registry == nil {
		return nil, errors.New("registry not available")
	}
	configID := chi.URLParam(r, "config_id")
	return s.registry.GetAdapter(configID)
}
