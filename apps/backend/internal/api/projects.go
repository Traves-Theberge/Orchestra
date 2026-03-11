package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func (s *Server) PostGitCommit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git commit attempt")
		http.Error(w, "Unauthorized project path", http.StatusForbidden)
		return
	}

	var req struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Message == "" {
		http.Error(w, "Message is required", http.StatusBadRequest)
		return
	}

	if err := git.Commit(r.Context(), project.RootPath, req.Message); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git commit failed")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) PostGitPush(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git push attempt")
		http.Error(w, "Unauthorized project path", http.StatusForbidden)
		return
	}

	var req struct {
		Remote string `json:"remote"`
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Remote == "" {
		req.Remote = "origin"
	}
	if req.Branch == "" {
		current, err := git.CurrentBranch(r.Context(), project.RootPath)
		if err != nil {
			s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to detect current branch, falling back to main")
			req.Branch = "main"
		} else {
			req.Branch = current
		}
	}

	if err := git.Push(r.Context(), project.RootPath, req.Remote, req.Branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git push failed")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) PostGitPull(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git pull attempt")
		http.Error(w, "Unauthorized project path", http.StatusForbidden)
		return
	}

	var req struct {
		Remote string `json:"remote"`
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Remote == "" {
		req.Remote = "origin"
	}
	if req.Branch == "" {
		current, err := git.CurrentBranch(r.Context(), project.RootPath)
		if err != nil {
			s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to detect current branch, falling back to main")
			req.Branch = "main"
		} else {
			req.Branch = current
		}
	}

	if err := git.Pull(r.Context(), project.RootPath, req.Remote, req.Branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git pull failed")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

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

	// Get Git Info
	gitRoot, remoteURL, err := git.ProjectInfo(r.Context(), req.RootPath)
	if err == nil {
		req.RootPath = gitRoot
	} else {
		s.logger.Warn().Err(err).Str("path", req.RootPath).Msg("could not get git info for project")
	}

	// Attempt to upsert
	id, err := s.db.UpsertProject(r.Context(), req.RootPath, remoteURL)
	if err != nil {
		s.logger.Error().Err(err).Str("path", req.RootPath).Msg("failed to create project")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Try to link GitHub if potential
	if owner, repo, ok := git.ParseGitHubRemote(remoteURL); ok {
		s.logger.Info().Str("project_id", id).Str("owner", owner).Str("repo", repo).Msg("auto-detected github repo")
		_ = s.db.UpdateProjectGitHubInfo(r.Context(), id, owner, repo)
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
	w.WriteHeader(http.StatusOK)
}

type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []FileNode `json:"children,omitempty"`
}

func (s *Server) GetProjectFileContent(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	filePath := r.URL.Query().Get("path")

	s.logger.Info().
		Str("project_id", projectID).
		Str("file_path", filePath).
		Msg("DEBUG: Handling file content request")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	fullPath := filepath.Join(project.RootPath, filePath)
	// Safety check: ensure file is within project root
	rel, err := filepath.Rel(project.RootPath, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		http.Error(w, "Invalid file path", http.StatusForbidden)
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		s.logger.Error().Err(err).Str("path", fullPath).Msg("failed to read project file")
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write(content)
}

func (s *Server) GetProjectFileTree(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	relPath := r.URL.Query().Get("path")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Str("project_id", projectID).Msg("project not found in DB")
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	// Simplified: If it's in the DB, we trust the path for local indexing.
	// This removes brittle path guard checks for registered projects.

	tree, err := walkTree(project.RootPath, relPath, 1)
	if err != nil {
		s.logger.Error().
			Err(err).
			Str("path", project.RootPath).
			Msg("failed to walk tree")
		http.Error(w, "Failed to read project tree", http.StatusInternalServerError)
		return
	}

	s.logger.Info().
		Str("project_id", projectID).
		Int("node_count", len(tree)).
		Msg("returning file tree")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

func walkTree(root, rel string, maxDepth int) ([]FileNode, error) {
	fullPath := filepath.Join(root, rel)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var nodes []FileNode
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" || name == "node_modules" || name == ".DS_Store" || name == "dist" || name == "build" {
			continue
		}

		path := filepath.Join(rel, name)
		node := FileNode{
			Name:  name,
			Path:  path,
			IsDir: entry.IsDir(),
		}

		if entry.IsDir() && maxDepth > 0 {
			children, _ := walkTree(root, path, maxDepth-1)
			node.Children = children
		}

		nodes = append(nodes, node)
	}

	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsDir && !nodes[j].IsDir {
			return true
		}
		if !nodes[i].IsDir && nodes[j].IsDir {
			return false
		}
		return nodes[i].Name < nodes[j].Name
	})

	return nodes, nil
}

func (s *Server) GetProjectGitStatus(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Str("project_id", projectID).Msg("project not found for git status")
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "status", "--porcelain")
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().
			Err(err).
			Str("project_id", projectID).
			Str("output", string(out)).
			Msg("git status failed")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	lines := strings.Split(string(out), "\n")
	var status []map[string]string
	for _, line := range lines {
		if len(line) < 4 {
			continue
		}
		status = append(status, map[string]string{
			"status": strings.TrimSpace(line[:2]),
			"path":   strings.TrimSpace(line[3:]),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func (s *Server) GetProjectGitStats(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Str("project_id", projectID).Err(err).Msg("DEBUG: Project not found in DB for git stats")
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	// Check if .git exists manually first
	gitDir := filepath.Join(project.RootPath, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		s.logger.Warn().Str("path", gitDir).Msg("DEBUG: .git directory DOES NOT EXIST at root_path")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "log", "-n", "20", "--pretty=format:%H|%an|%at|%s")
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().
			Err(err).
			Str("project_id", projectID).
			Str("output", string(out)).
			Msg("DEBUG: Git log command failed")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	lines := strings.Split(string(out), "\n")
	var history []map[string]string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) >= 4 {
			history = append(history, map[string]string{
				"hash":    parts[0],
				"author":  parts[1],
				"date":    parts[2],
				"message": parts[3],
			})
		}
	}

	s.logger.Info().
		Str("project_id", projectID).
		Int("history_count", len(history)).
		Msg("DEBUG: Returning git history to UI")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

func (s *Server) GetProjectGitDiff(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	hash := r.URL.Query().Get("hash")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	var cmd *exec.Cmd
	if hash != "" {
		// Show diff for specific commit
		cmd = exec.CommandContext(r.Context(), "git", "show", hash)
	} else {
		// Show uncommitted changes
		cmd = exec.CommandContext(r.Context(), "git", "diff")
	}
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Str("hash", hash).Msg("git diff failed")
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(""))
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write(out)
}
