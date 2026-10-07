package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/automations"
)

const automationBodyLimit = 256 * 1024

func (s *Server) automationsReady(w http.ResponseWriter) bool {
	if s.automations == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "automations_unavailable", "Automations are unavailable")
		return false
	}
	return true
}

func automationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, automations.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, "automation_not_found", err.Error())
	case errors.Is(err, automations.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, "invalid_automation", err.Error())
	case errors.Is(err, automations.ErrConflict):
		writeJSONError(w, http.StatusConflict, "automation_conflict", err.Error())
	case errors.Is(err, automations.ErrUnavailable):
		writeJSONError(w, http.StatusServiceUnavailable, "automations_unavailable", err.Error())
	default:
		writeJSONError(w, http.StatusInternalServerError, "automation_failed", err.Error())
	}
}

func readAutomationBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, automationBodyLimit))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "Request body is too large or unreadable")
		return nil, false
	}
	return body, true
}

func queryLimit(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	return n
}

func (s *Server) ListAutomations(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	list, err := s.automations.List(r.Context())
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"automations": list})
}

func (s *Server) CreateAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	body, ok := readAutomationBody(w, r)
	if !ok {
		return
	}
	var in automations.AutomationInput
	if err := json.Unmarshal(body, &in); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "Invalid automation body: "+err.Error())
		return
	}
	a, err := s.automations.Create(r.Context(), in)
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func (s *Server) GetAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	a, err := s.automations.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) PatchAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	body, ok := readAutomationBody(w, r)
	if !ok {
		return
	}
	a, err := s.automations.Update(r.Context(), chi.URLParam(r, "id"), body)
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) DeleteAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	if err := s.automations.Delete(r.Context(), chi.URLParam(r, "id")); err != nil {
		automationError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) RunAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	run, err := s.automations.RunNow(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, run)
}

func (s *Server) PauseAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	a, err := s.automations.Pause(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) ResumeAutomation(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	a, err := s.automations.Resume(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) ListAutomationRuns(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	runs, err := s.automations.Runs(r.Context(), chi.URLParam(r, "id"), queryLimit(r))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) ListAllAutomationRuns(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	runs, err := s.automations.AllRuns(r.Context(), r.URL.Query().Get("status"), queryLimit(r))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) GetAutomationRun(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	run, err := s.automations.GetRun(r.Context(), chi.URLParam(r, "run_id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) CancelAutomationRun(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	run, err := s.automations.CancelRun(r.Context(), chi.URLParam(r, "run_id"))
	if err != nil {
		automationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) PreviewAutomationSchedule(w http.ResponseWriter, r *http.Request) {
	if !s.automationsReady(w) {
		return
	}
	body, ok := readAutomationBody(w, r)
	if !ok {
		return
	}
	var req struct {
		Schedule automations.Schedule `json:"schedule"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "Invalid schedule body: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.automations.PreviewSchedule(req.Schedule))
}

func (s *Server) registerAutomationRoutes(protected chi.Router) {
	// Static path before {id} so chi never captures "schedule" as an id.
	protected.Post("/api/v1/automations/schedule/preview", s.PreviewAutomationSchedule)
	protected.Get("/api/v1/automations", s.ListAutomations)
	protected.Post("/api/v1/automations", s.CreateAutomation)
	protected.Get("/api/v1/automations/{id}", s.GetAutomation)
	protected.Patch("/api/v1/automations/{id}", s.PatchAutomation)
	protected.Delete("/api/v1/automations/{id}", s.DeleteAutomation)
	protected.Post("/api/v1/automations/{id}/run", s.RunAutomation)
	protected.Post("/api/v1/automations/{id}/pause", s.PauseAutomation)
	protected.Post("/api/v1/automations/{id}/resume", s.ResumeAutomation)
	protected.Get("/api/v1/automations/{id}/runs", s.ListAutomationRuns)
	protected.Get("/api/v1/automation-runs", s.ListAllAutomationRuns)
	protected.Get("/api/v1/automation-runs/{run_id}", s.GetAutomationRun)
	protected.Post("/api/v1/automation-runs/{run_id}/cancel", s.CancelAutomationRun)
}
