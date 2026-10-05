package api

import (
	"context"
	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"net/http"
)

type gitWorkspaceProjectKey struct{}

func (s *Server) withGitWorkspace(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity := r.URL.Query().Get("workspace_id")
		if identity == "" {
			next(w, r)
			return
		}
		projectID := chi.URLParam(r, "project_id")
		project, err := s.db.GetProjectByID(r.Context(), projectID)
		if err != nil {
			writeJSONError(w, 404, "project_not_found", "project not found")
			return
		}
		selected, err := workspace.ResolveGitWorktree(r.Context(), projectID, project.RootPath, identity, s.config.ProjectRoots)
		if err != nil {
			writeJSONError(w, 404, "workspace_unavailable", "Selected Git worktree is unavailable. Refresh workspace selection.")
			return
		}
		project.RootPath = selected.Path
		next(w, r.WithContext(context.WithValue(r.Context(), gitWorkspaceProjectKey{}, project)))
	}
}

func (s *Server) gitProject(r *http.Request, projectID string) (db.Project, error) {
	if selected, ok := r.Context().Value(gitWorkspaceProjectKey{}).(db.Project); ok && selected.ID == projectID {
		return selected, nil
	}
	return s.db.GetProjectByID(r.Context(), projectID)
}
