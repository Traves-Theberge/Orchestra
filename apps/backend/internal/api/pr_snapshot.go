package api

import (
	"errors"
	"github.com/go-chi/chi/v5"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"net/http"
	"strconv"
)

func (s *Server) GetPRSnapshot(w http.ResponseWriter, r *http.Request) {
	number, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil || number < 1 {
		writeJSONError(w, 400, "invalid_number", "invalid pull request number")
		return
	}
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "PR review storage is unavailable")
		return
	}
	project, err := s.db.GetProjectByID(r.Context(), chi.URLParam(r, "project_id"))
	if err != nil {
		writeJSONError(w, 404, "project_not_found", "project not found")
		return
	}
	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, 400, "github_not_configured", "GitHub is not configured for this project")
		return
	}
	token, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, 401, "token_expired", err.Error())
		return
	}
	snapshot, err := ghutil.GetReviewSnapshot(r.Context(), project.GitHubOwner, project.GitHubRepo, token, number)
	if errors.Is(err, ghutil.ErrReviewSnapshotChanged) {
		writeJSONError(w, 409, "pr_changed", err.Error())
		return
	}
	if err != nil {
		writeJSONError(w, 502, "github_snapshot_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}
