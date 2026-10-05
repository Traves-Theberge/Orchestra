package api

import (
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/worktreejobs"
	"io"
	"net/http"
	"strings"
)

func (s *Server) worktreeJobError(w http.ResponseWriter, err error) {
	status, code := 500, "worktree_job_failed"
	if errors.Is(err, worktreejobs.ErrInvalid) {
		status, code = 400, "invalid_worktree_job"
	}
	if errors.Is(err, worktreejobs.ErrConflict) {
		status, code = 409, "worktree_job_conflict"
	}
	if errors.Is(err, worktreejobs.ErrNotFound) {
		status, code = 404, "worktree_job_not_found"
	}
	writeJSONError(w, status, code, err.Error())
}

func (s *Server) PostWorktreeJob(w http.ResponseWriter, r *http.Request) {
	if s.worktreeJobs == nil {
		writeJSONError(w, 503, "worktree_jobs_unavailable", "Workspace creation is unavailable")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req worktreejobs.Request
	if err := decoder.Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid_json", "Invalid workspace creation request")
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeJSONError(w, 400, "invalid_json", "One JSON object is required")
		return
	}
	pid := chi.URLParam(r, "project_id")
	if req.Provider != "" {
		if s.workspaceChat == nil {
			writeJSONError(w, 422, "provider_unavailable", "Registered harness inventory is unavailable")
			return
		}
		providers, err := s.workspaceChat.Providers(r.Context(), pid)
		matched := false
		if err == nil {
			for _, provider := range providers {
				if strings.EqualFold(provider.ID, req.Provider) && provider.Enabled {
					req.Provider = provider.ID
					matched = true
					break
				}
			}
		}
		if !matched {
			writeJSONError(w, 422, "provider_unavailable", "Selected harness is not available for this project")
			return
		}
	}
	job, err := s.worktreeJobs.Submit(r.Context(), pid, req)
	if err != nil {
		s.worktreeJobError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) GetWorktreeJob(w http.ResponseWriter, r *http.Request) {
	if s.worktreeJobs == nil {
		writeJSONError(w, 503, "worktree_jobs_unavailable", "Workspace creation is unavailable")
		return
	}
	job, err := s.worktreeJobs.Get(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "request_id"))
	if err != nil {
		s.worktreeJobError(w, err)
		return
	}
	writeJSON(w, 200, job)
}
