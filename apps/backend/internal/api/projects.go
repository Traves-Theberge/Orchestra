package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (s *Server) GetProjects(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	projects, err := s.db.GetProjects(r.Context())
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to get projects")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(projects)
}

func (s *Server) GetProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	projectID := chi.URLParam(r, "project_id")
	if projectID == "" {
		http.Error(w, "Project ID is required", http.StatusBadRequest)
		return
	}

	stats, err := s.db.GetProjectStats(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to get project stats")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) GetWarehouseStats(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	stats, err := s.db.GetGlobalStats(r.Context())
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to get global stats")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) CreateProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		RootPath string `json:"root_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.RootPath == "" {
		http.Error(w, "root_path is required", http.StatusBadRequest)
		return
	}

	// Attempt to upsert
	id, err := s.db.UpsertProject(r.Context(), req.RootPath, "")
	if err != nil {
		s.logger.Error().Err(err).Str("path", req.RootPath).Msg("failed to create project")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (s *Server) GetSessions(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	projectID := r.URL.Query().Get("project_id")
	sessions, err := s.db.GetSessions(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to get sessions")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

func (s *Server) GetSessionDetail(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	session, err := s.db.GetSessionDetail(r.Context(), sessionID)
	if err != nil {
		s.logger.Error().Err(err).Str("session_id", sessionID).Msg("failed to get session detail")
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

func (s *Server) DeleteProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	projectID := chi.URLParam(r, "project_id")
	if err := s.db.DeleteProject(r.Context(), projectID); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to delete project")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) RefreshProject(w http.ResponseWriter, r *http.Request) {
	// For now, refresh just returns success as the watcher is always running.
	// In the future, this could trigger a specific directory scan.
	w.WriteHeader(http.StatusOK)
}

type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []FileNode `json:"children,omitempty"`
}

func (s *Server) GetProjectFileTree(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	tree, err := walkTree(project.RootPath, "")
	if err != nil {
		s.logger.Error().Err(err).Str("path", project.RootPath).Msg("failed to walk tree")
		http.Error(w, "Failed to read project tree", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

func walkTree(root, rel string) ([]FileNode, error) {
	entries, err := os.ReadDir(filepath.Join(root, rel))
	if err != nil {
		return nil, err
	}

	var nodes []FileNode
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" || name == "node_modules" || name == ".DS_Store" {
			continue
		}

		path := filepath.Join(rel, name)
		node := FileNode{
			Name:  name,
			Path:  path,
			IsDir: entry.IsDir(),
		}

		if entry.IsDir() {
			// Limit depth for now to prevent massive payloads
			if strings.Count(rel, string(os.PathSeparator)) < 3 {
				children, _ := walkTree(root, path)
				node.Children = children
			}
		}

		nodes = append(nodes, node)
	}

	return nodes, nil
}

func (s *Server) GetProjectGitStats(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "log", "-n", "20", "--pretty=format:%H|%an|%at|%s")
	cmd.Dir = project.RootPath
	out, err := cmd.Output()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	lines := strings.Split(string(out), "\n")
	var history []map[string]string
	for _, line := range lines {
		parts := strings.Split(line, "|")
		if len(parts) >= 4 {
			history = append(history, map[string]string{
				"hash":    parts[0],
				"author":  parts[1],
				"date":    parts[2],
				"subject": parts[3],
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}
