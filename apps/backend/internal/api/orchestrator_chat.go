package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/control"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
)

func orchestratorChatScope(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		chi.RouteContext(r.Context()).URLParams.Add("project_id", workspacechat.OrchestratorScope)
		handler(w, r)
	}
}

// CLI and native tools share the same bounded control service and receipts.
func (s *Server) PostOrchestratorControl(w http.ResponseWriter, r *http.Request) {
	if s.orchestratorControl == nil {
		writeJSONError(w, 503, "orchestrator_control_unavailable", "Orchestra control unavailable")
		return
	}
	var req control.Request
	if !decodeChat(w, r, &req) {
		return
	}
	raw, err := json.Marshal(req)
	if err != nil {
		writeJSONError(w, 400, "invalid_request", "Invalid control request")
		return
	}
	var args map[string]any
	_ = json.Unmarshal(raw, &args)
	result := s.orchestratorControl.Execute(r.Context(), "orchestra_control", args)
	status := 200
	if ok, _ := result["success"].(bool); !ok {
		status = 409
	}
	writeJSON(w, status, result)
}
