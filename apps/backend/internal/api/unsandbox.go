package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/unsandbox"
)

// PostUnsandboxExecute submits code for async execution.
// POST /api/v1/unsandbox/execute
// Body: { "language": "python", "code": "print('hello')", "network": "semitrusted" }
// Returns: { "job_id": "...", "status": "pending" }
func (s *Server) PostUnsandboxExecute(w http.ResponseWriter, r *http.Request) {
	client, err := unsandbox.NewClientFromEnv()
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "unsandbox_not_configured", "unsandbox is not configured")
		return
	}

	var body struct {
		Language string `json:"language"`
		Code     string `json:"code"`
		Network  string `json:"network"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_body", "expected JSON with language, code fields")
		return
	}
	if body.Language == "" {
		body.Language = "bash"
	}
	if body.Code == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_code", "code field is required")
		return
	}

	// Bootstrap Claude credentials when bash code references claude
	code := body.Code
	isClaude := body.Language == "bash" && strings.Contains(code, "claude")
	if isClaude {
		if creds := unsandbox.SyncClaudeCredentials(); creds != "" {
			code = creds + "\n" + code
		}
	}

	// Submit async — 900s TTL (max allowed) for all sandbox jobs
	result, err := client.ExecuteAsync(r.Context(), body.Language, code, body.Network, map[string]any{"ttl": 900})
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "execution_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id": result.JobID,
		"status": result.Status,
	})
}

// GetUnsandboxJob polls a job for status and output.
// GET /api/v1/unsandbox/jobs/{jobID}
func (s *Server) GetUnsandboxJob(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/v1/unsandbox/jobs/")
	if jobID == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_job_id", "job ID is required")
		return
	}

	client, err := unsandbox.NewClientFromEnv()
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "unsandbox_not_configured", "unsandbox is not configured")
		return
	}

	job, err := client.GetJob(r.Context(), jobID)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "job_poll_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id": jobID,
		"status": job.Status,
		"output": job.Output,
		"error":  job.Error,
	})
}

// GetUnsandboxSessions lists active unsandbox sessions.
func (s *Server) GetUnsandboxSessions(w http.ResponseWriter, r *http.Request) {
	client, err := unsandbox.NewClientFromEnv()
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "unsandbox_not_configured", "unsandbox is not configured")
		return
	}

	sessions, err := client.ListSessions(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "list_failed", "failed to list items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sessions": sessions,
	})
}

// GetUnsandboxServices lists unsandbox services.
func (s *Server) GetUnsandboxServices(w http.ResponseWriter, r *http.Request) {
	client, err := unsandbox.NewClientFromEnv()
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "unsandbox_not_configured", "unsandbox is not configured")
		return
	}

	services, err := client.ListServices(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "list_failed", "failed to list items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"services": services,
	})
}

// GetUnsandboxStatus checks if unsandbox credentials are configured and valid.
func (s *Server) GetUnsandboxStatus(w http.ResponseWriter, r *http.Request) {
	client, err := unsandbox.NewClientFromEnv()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"configured": false,
			"error":      err.Error(),
		})
		return
	}

	keyInfo, err := client.ValidateKeys(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"configured": true,
			"valid":      false,
			"error":      err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"configured": true,
		"valid":      true,
		"key_info":   keyInfo,
	})
}
