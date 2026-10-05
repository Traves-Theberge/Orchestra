package api

import (
	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"net/http"
)

type projectWorktree = workspace.GitWorktree

func parseProjectWorktrees(output string) []projectWorktree {
	return workspace.ParseGitWorktrees(output)
}
func (s *Server) GetProjectWorktrees(w http.ResponseWriter, r *http.Request) {
	project, err := s.db.GetProjectByID(r.Context(), chi.URLParam(r, "project_id"))
	if err != nil {
		writeJSONError(w, 404, "project_not_found", "project not found")
		return
	}
	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		writeJSONError(w, 403, "unauthorized_project_path", "unauthorized project path")
		return
	}
	worktrees, err := workspace.ListProjectGitWorktrees(r.Context(), project.ID, project.RootPath, s.config.ProjectRoots)
	if err != nil {
		writeJSONError(w, 500, "worktree_list_failed", "unable to read repository worktrees")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"worktrees": worktrees})
}
