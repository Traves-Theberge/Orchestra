package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type workspaceMigrationRequest struct {
	From   string `json:"from"`
	To     string `json:"to"`
	DryRun *bool  `json:"dry_run"`
}

func (s *Server) PostWorkspaceMigrate(w http.ResponseWriter, r *http.Request) {
	request := workspaceMigrationRequest{}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&request)
	}

	from := strings.TrimSpace(request.From)
	to := strings.TrimSpace(request.To)

	if from == "" {
		from = previousWorkspaceDefault()
	}
	if to == "" {
		to = s.workspaceRoot
	}

	dryRun := true
	if request.DryRun != nil {
		dryRun = *request.DryRun
	}

	result, err := workspace.ExecuteWorkspaceMigration(from, to, dryRun)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "workspace_migration_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"from":    filepath.Clean(from),
		"to":      filepath.Clean(to),
		"dry_run": dryRun,
		"result":  result,
	})
}

func (s *Server) GetWorkspaceMigrationPlan(w http.ResponseWriter, r *http.Request) {
	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))

	if from == "" {
		from = previousWorkspaceDefault()
	}
	if to == "" {
		to = s.workspaceRoot
	}

	result, err := workspace.PlanWorkspaceMigration(from, to)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "workspace_migration_plan_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"from":   filepath.Clean(from),
		"to":     filepath.Clean(to),
		"result": result,
	})
}

func previousWorkspaceDefault() string {
	return filepath.Join(os.TempDir(), "orchestra_workspaces_prev")
}
