package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
)

func (s *Server) agentCatalogReady(w http.ResponseWriter) bool {
	if s.agentCatalog == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "agent_catalog_unavailable", "Agent definition catalog is unavailable")
		return false
	}
	return true
}

func (s *Server) agentCatalogError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "agent_catalog_failed"
	switch {
	case errors.Is(err, agentcatalog.ErrInvalid):
		status, code = http.StatusBadRequest, "invalid_agent_resource"
	case errors.Is(err, agentcatalog.ErrForbidden):
		status, code = http.StatusForbidden, "agent_resource_forbidden"
	case errors.Is(err, agentcatalog.ErrNotFound):
		status, code = http.StatusNotFound, "agent_resource_not_found"
	case errors.Is(err, agentcatalog.ErrConflict):
		status, code = http.StatusConflict, "agent_resource_conflict"
	case errors.Is(err, agentcatalog.ErrUnsupported):
		status, code = http.StatusUnprocessableEntity, "agent_resource_unsupported"
	}
	writeJSONError(w, status, code, err.Error())
}

func (s *Server) agentCatalogRequest(r *http.Request) (agentcatalog.Request, error) {
	scope := agentcatalog.Scope(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = agentcatalog.ScopeEffective
	}
	return agentcatalog.Request{ProjectID: chi.URLParam(r, "project_id"), WorkspaceID: r.URL.Query().Get("workspace_id"), Harness: r.URL.Query().Get("harness"), Scope: scope}, nil
}

func (s *Server) GetAgentCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	req, err := s.agentCatalogRequest(r)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	value, err := s.agentCatalog.List(r.Context(), req)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *Server) GetAgentCatalogResource(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	req, err := s.agentCatalogRequest(r)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	value, err := s.agentCatalog.Get(r.Context(), req, agentcatalog.Kind(r.URL.Query().Get("kind")), r.URL.Query().Get("resource_id"))
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *Server) GetAgentCatalogReceipt(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	value, err := s.agentCatalog.GetProjectReceipt(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "request_id"))
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

type agentMutationBody struct {
	RequestID    string `json:"request_id"`
	ExpectedHash string `json:"expected_hash"`
	Content      string `json:"content"`
	Format       string `json:"format"`
}

func decodeAgentMutation(w http.ResponseWriter, r *http.Request) (agentMutationBody, bool) {
	var body agentMutationBody
	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024+16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "Invalid agent resource request body")
		return body, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "One JSON object is required")
		return body, false
	}
	return body, true
}

func (s *Server) mutateAgentCatalogResource(w http.ResponseWriter, r *http.Request, operation string) {
	if !s.agentCatalogReady(w) {
		return
	}
	body, ok := decodeAgentMutation(w, r)
	if !ok {
		return
	}
	req, err := s.agentCatalogRequest(r)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	receipt, err := s.agentCatalog.Mutate(r.Context(), agentcatalog.MutationRequest{
		Operation: operation, ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope,
		Kind: agentcatalog.Kind(r.URL.Query().Get("kind")), ResourceID: r.URL.Query().Get("resource_id"),
		RequestID: body.RequestID, ExpectedHash: body.ExpectedHash, Format: body.Format, Content: body.Content,
	})
	if errors.Is(err, agentcatalog.ErrUnknown) {
		writeJSON(w, http.StatusAccepted, receipt)
		return
	}
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, receipt)
}

func (s *Server) PostAgentCatalogResource(w http.ResponseWriter, r *http.Request) {
	s.mutateAgentCatalogResource(w, r, "create")
}
func (s *Server) PutAgentCatalogResource(w http.ResponseWriter, r *http.Request) {
	s.mutateAgentCatalogResource(w, r, "update")
}
func (s *Server) DeleteAgentCatalogResource(w http.ResponseWriter, r *http.Request) {
	s.mutateAgentCatalogResource(w, r, "delete")
}
