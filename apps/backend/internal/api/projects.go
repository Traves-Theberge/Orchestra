package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

var aheadBehindRe = regexp.MustCompile(`\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]`)

func (s *Server) PostGitCommit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git commit attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Message == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "message is required")
		return
	}

	if err := git.Commit(r.Context(), project.RootPath, req.Message); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git commit failed")
		writeJSONError(w, http.StatusInternalServerError, "git_commit_failed", "git commit failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitPush(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git push attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Remote string `json:"remote"`
		Branch string `json:"branch"`
	}

	// Decode body if it exists and is not empty
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.logger.Warn().Err(err).Msg("failed to decode git push body")
		}
	}

	if req.Remote == "" {
		req.Remote = "origin"
	}
	if req.Branch == "" {
		current, err := git.CurrentBranch(r.Context(), project.RootPath)
		if err != nil {
			s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to detect current branch, falling back to main")
			req.Branch = git.DefaultBranch(r.Context(), project.RootPath)
		} else {
			req.Branch = current
		}
	}

	if err := git.Push(r.Context(), project.RootPath, req.Remote, req.Branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git push failed")
		writeJSONError(w, http.StatusInternalServerError, "git_push_failed", "git push failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitPull(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git pull attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Remote string `json:"remote"`
		Branch string `json:"branch"`
	}

	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.logger.Warn().Err(err).Msg("failed to decode git pull body")
		}
	}

	if req.Remote == "" {
		req.Remote = "origin"
	}
	if req.Branch == "" {
		current, err := git.CurrentBranch(r.Context(), project.RootPath)
		if err != nil {
			s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to detect current branch, falling back to main")
			req.Branch = git.DefaultBranch(r.Context(), project.RootPath)
		} else {
			req.Branch = current
		}
	}

	if err := git.Pull(r.Context(), project.RootPath, req.Remote, req.Branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git pull failed")
		writeJSONError(w, http.StatusInternalServerError, "git_pull_failed", "git pull failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitFetch(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git fetch attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	if err := git.Fetch(r.Context(), project.RootPath); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git fetch failed")
		writeJSONError(w, http.StatusInternalServerError, "git_fetch_failed", "git fetch failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetProjects(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	projects, err := s.db.GetProjects(r.Context())
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to get projects")
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "failed to get projects")
		return
	}

	for i := range projects {
		projects[i].GitHubToken = redactProjectToken(projects[i].GitHubToken)
		if info, err := os.Stat(projects[i].RootPath); err == nil && info.IsDir() {
			projects[i].PathExists = true
		}
	}

	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) GetProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	projectID := chi.URLParam(r, "project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "project_id is required")
		return
	}

	stats, err := s.db.GetProjectStats(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to get project stats")
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "failed to get project stats")
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) GetWarehouseStats(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	// Parse optional query parameters for filtering
	query := r.URL.Query()
	var opts []db.StatsOption
	cacheKey := "global"

	if since := query.Get("since"); since != "" {
		if t, err := time.Parse(time.RFC3339, since); err == nil {
			opts = append(opts, db.WithSince(t))
			cacheKey += ":since=" + since
		}
	}
	if until := query.Get("until"); until != "" {
		if t, err := time.Parse(time.RFC3339, until); err == nil {
			opts = append(opts, db.WithUntil(t))
			cacheKey += ":until=" + until
		}
	}
	if provider := query.Get("provider"); provider != "" {
		opts = append(opts, db.WithProvider(provider))
		cacheKey += ":provider=" + provider
	}
	if projectID := query.Get("project_id"); projectID != "" {
		opts = append(opts, db.WithProjectID(projectID))
		cacheKey += ":project_id=" + projectID
	}

	// Check cache first
	if cached, ok := globalStatsCache.get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	stats, err := s.db.GetGlobalStats(r.Context(), opts...)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to get global stats")
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "failed to get global stats")
		return
	}

	globalStatsCache.set(cacheKey, &stats)
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) CreateProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	var req struct {
		RootPath            string `json:"root_path"`
		IssueSourceType     string `json:"issue_source_type"`
		IssueSourceEndpoint string `json:"issue_source_endpoint"`
		IssueSourceToken    string `json:"issue_source_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request")
		return
	}

	if req.RootPath == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "root_path is required")
		return
	}

	// Get Git Info
	gitRoot, remoteURL, err := git.ProjectInfo(r.Context(), req.RootPath)
	if err == nil {
		req.RootPath = gitRoot
	} else {
		s.logger.Warn().Err(err).Str("path", req.RootPath).Msg("could not get git info for project")
	}

	if err := workspace.ValidateProjectPath(req.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", req.RootPath).Msg("unauthorized project path")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	// Attempt to upsert
	id, err := s.db.UpsertProject(r.Context(), req.RootPath, remoteURL)
	if err != nil {
		s.logger.Error().Err(err).Str("path", req.RootPath).Msg("failed to create project")
		writeJSONError(w, http.StatusInternalServerError, "create_failed", "failed to create project")
		return
	}

	// Try to link GitHub if potential
	if owner, repo, ok := git.ParseGitHubRemote(remoteURL); ok {
		s.logger.Info().Str("project_id", id).Str("owner", owner).Str("repo", repo).Msg("auto-detected github repo")
		_ = s.db.UpdateProjectGitHubInfo(r.Context(), id, owner, repo)
	}

	// Optionally wire up issue source at creation time
	if req.IssueSourceType != "" {
		if err := s.db.UpdateProjectIssueSource(r.Context(), id, req.IssueSourceType, req.IssueSourceEndpoint, req.IssueSourceToken); err != nil {
			s.logger.Warn().Err(err).Str("project_id", id).Msg("failed to set initial issue source")
		}
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) GetSessions(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	query := r.URL.Query()
	projectID := query.Get("project_id")
	sessions, err := s.db.GetSessions(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to get sessions")
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "failed to get sessions")
		return
	}

	// Optional pagination via limit/offset query params
	total := len(sessions)
	if offStr := query.Get("offset"); offStr != "" {
		off, parseErr := strconv.Atoi(offStr)
		if parseErr == nil && off >= 0 {
			if off >= total {
				sessions = nil
			} else {
				sessions = sessions[off:]
			}
		}
	}
	if limStr := query.Get("limit"); limStr != "" {
		if lim, parseErr := strconv.Atoi(limStr); parseErr == nil && lim > 0 && lim < len(sessions) {
			sessions = sessions[:lim]
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions, "total": total})
}

func (s *Server) GetSessionDetail(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "session_id is required")
		return
	}

	session, err := s.db.GetSessionDetail(r.Context(), sessionID)
	if err != nil {
		s.logger.Error().Err(err).Str("session_id", sessionID).Msg("failed to get session detail")
		writeJSONError(w, http.StatusNotFound, "session_not_found", "session not found")
		return
	}

	writeJSON(w, http.StatusOK, session)
}

func (s *Server) DeleteProject(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}

	projectID := chi.URLParam(r, "project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "project_id is required")
		return
	}

	if err := s.db.DeleteProject(r.Context(), projectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
			return
		}
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to delete project")
		writeJSONError(w, http.StatusInternalServerError, "delete_failed", "failed to delete project")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) RefreshProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "project_id is required")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	// Re-scan git remote URL
	_, remoteURL, err := git.ProjectInfo(r.Context(), project.RootPath)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("could not refresh git info for project")
	}

	// Update GitHub info if detected
	if owner, repo, ok := git.ParseGitHubRemote(remoteURL); ok {
		s.logger.Info().Str("project_id", projectID).Str("owner", owner).Str("repo", repo).Msg("refreshed github repo info")
		_ = s.db.UpdateProjectGitHubInfo(r.Context(), projectID, owner, repo)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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

	s.logger.Debug().
		Str("project_id", projectID).
		Str("file_path", filePath).
		Msg("handling file content request")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized project file content attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	fullPath, err := safeProjectSubpath(project.RootPath, filePath)
	if err != nil {
		writeJSONError(w, http.StatusForbidden, "invalid_path", "invalid file path")
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "file_not_found", "file not found")
			return
		}
		s.logger.Error().Err(err).Str("path", fullPath).Msg("failed to read project file")
		writeJSONError(w, http.StatusInternalServerError, "read_failed", "failed to read file")
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
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized project tree attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}
	if relPath != "" {
		if _, err := safeProjectSubpath(project.RootPath, relPath); err != nil {
			writeJSONError(w, http.StatusForbidden, "invalid_path", "invalid tree path")
			return
		}
	}

	tree, err := walkTree(project.RootPath, relPath, 1)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "path_not_found", "project path not found")
			return
		}
		s.logger.Error().
			Err(err).
			Str("path", project.RootPath).
			Msg("failed to walk tree")
		writeJSONError(w, http.StatusInternalServerError, "read_failed", "failed to read project tree")
		return
	}

	s.logger.Info().
		Str("project_id", projectID).
		Int("node_count", len(tree)).
		Msg("returning file tree")

	writeJSON(w, http.StatusOK, tree)
}

func redactProjectToken(token string) string {
	if strings.TrimSpace(token) == "" {
		return ""
	}
	return "configured"
}

func safeProjectSubpath(root string, relPath string) (string, error) {
	fullPath := filepath.Join(root, relPath)
	rel, err := filepath.Rel(root, fullPath)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rel, "..") {
		return "", filepath.ErrBadPattern
	}
	return fullPath, nil
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

// maxWorkspaceFileBytes caps how much content a single PutWorkspaceFile call
// can write, preventing memory-exhaustion via unbounded request bodies.
const maxWorkspaceFileBytes int64 = 32 * 1024 * 1024 // 32 MiB

// resolveWorkspaceFilePath rejects relative paths, symlink escapes, and any
// candidate that doesn't live inside a registered project root or under the
// configured workspace/worktree roots. Returns the canonical absolute path on
// success.
func (s *Server) resolveWorkspaceFilePath(r *http.Request, candidate string) (string, error) {
	if candidate == "" || !filepath.IsAbs(candidate) {
		return "", fmt.Errorf("absolute path required")
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}

	roots := []string{}
	if s.workspaceRoot != "" {
		roots = append(roots, s.workspaceRoot)
	}
	if s.worktreeRoot != "" && s.worktreeRoot != s.workspaceRoot {
		roots = append(roots, s.worktreeRoot)
	}
	if s.db != nil {
		projects, err := s.db.GetProjects(r.Context())
		if err == nil {
			for _, p := range projects {
				if strings.TrimSpace(p.RootPath) != "" {
					roots = append(roots, p.RootPath)
				}
			}
		}
	}

	for _, root := range roots {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		if abs == absRoot {
			return abs, nil
		}
		rel, err := filepath.Rel(absRoot, abs)
		if err != nil {
			continue
		}
		if rel == "." || (!strings.HasPrefix(rel, "..") && rel != "..") {
			return abs, nil
		}
	}
	return "", fmt.Errorf("path not allowed: outside registered project or workspace roots")
}

// GetWorkspaceFile reads a file confined to a registered project / workspace root.
func (s *Server) GetWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	absPath, err := s.resolveWorkspaceFilePath(r, r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", err.Error())
		return
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "file_not_found", "file not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "read_failed", "failed to read file")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(content)
}

// PutWorkspaceFile writes file content, bounded to a registered root and a
// per-request size cap to prevent memory-exhaustion DoS.
func (s *Server) PutWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	absPath, err := s.resolveWorkspaceFilePath(r, r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", err.Error())
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxWorkspaceFileBytes+1))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "read_failed", "failed to read body")
		return
	}
	if int64(len(body)) > maxWorkspaceFileBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "body_too_large", fmt.Sprintf("file body exceeds %d bytes", maxWorkspaceFileBytes))
		return
	}
	if err := os.WriteFile(absPath, body, 0o644); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "write_failed", "failed to write file")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bytes": len(body)})
}

// PostWorkspaceMkdir creates a directory (and parents) inside a registered root.
func (s *Server) PostWorkspaceMkdir(w http.ResponseWriter, r *http.Request) {
	absPath, err := s.resolveWorkspaceFilePath(r, r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", err.Error())
		return
	}
	if _, err := os.Stat(absPath); err == nil {
		writeJSONError(w, http.StatusConflict, "path_exists", "path already exists")
		return
	}
	if err := os.MkdirAll(absPath, 0o755); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "mkdir_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PostWorkspaceRename moves a file or directory.
// Body: {"from": "...abs...", "to": "...abs..."}
func (s *Server) PostWorkspaceRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	fromAbs, err := s.resolveWorkspaceFilePath(r, body.From)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", "from: "+err.Error())
		return
	}
	toAbs, err := s.resolveWorkspaceFilePath(r, body.To)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", "to: "+err.Error())
		return
	}
	if _, err := os.Stat(fromAbs); err != nil {
		writeJSONError(w, http.StatusNotFound, "source_not_found", "source path not found")
		return
	}
	if _, err := os.Stat(toAbs); err == nil {
		writeJSONError(w, http.StatusConflict, "destination_exists", "destination path already exists")
		return
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "rename_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// DeleteWorkspacePath removes a file or directory inside a registered root.
func (s *Server) DeleteWorkspacePath(w http.ResponseWriter, r *http.Request) {
	absPath, err := s.resolveWorkspaceFilePath(r, r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", err.Error())
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "path_not_found", "path not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "stat_failed", err.Error())
		return
	}
	if info.IsDir() {
		if err := os.RemoveAll(absPath); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "remove_failed", err.Error())
			return
		}
	} else {
		if err := os.Remove(absPath); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "remove_failed", err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GetWorkspaceTree lists directory contents inside a registered root.
func (s *Server) GetWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	absPath, err := s.resolveWorkspaceFilePath(r, r.URL.Query().Get("path"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", err.Error())
		return
	}
	entries, err := os.ReadDir(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "path_not_found", "directory not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "read_failed", "failed to read directory")
		return
	}
	var nodes []FileNode
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" || name == "node_modules" || name == ".DS_Store" {
			continue
		}
		nodes = append(nodes, FileNode{
			Name:  name,
			Path:  name,
			IsDir: entry.IsDir(),
		})
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
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) GetProjectGitStatus(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		s.logger.Error().Str("project_id", projectID).Msg("project not found for git status")
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "status", "--porcelain", "--branch")
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().
			Err(err).
			Str("project_id", projectID).
			Str("output", string(out)).
			Msg("git status failed")
		writeJSON(w, http.StatusOK, map[string]any{
			"files":  []any{},
			"branch": map[string]int{"ahead": 0, "behind": 0},
		})
		return
	}

	lines := strings.Split(string(out), "\n")
	var files []map[string]string
	branchInfo := map[string]int{"ahead": 0, "behind": 0}
	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			if m := aheadBehindRe.FindStringSubmatch(line); m != nil {
				if m[1] != "" {
					branchInfo["ahead"], _ = strconv.Atoi(m[1])
				}
				if m[2] != "" {
					branchInfo["behind"], _ = strconv.Atoi(m[2])
				}
			}
			continue
		}
		if len(line) < 4 {
			continue
		}
		files = append(files, map[string]string{
			"status": line[:2],
			"path":   strings.TrimSpace(line[3:]),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"files":  files,
		"branch": branchInfo,
	})
}

func (s *Server) GetProjectGitStats(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		s.logger.Debug().Str("project_id", projectID).Err(err).Msg("project not found in DB for git stats")
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	// Check if .git exists manually first
	gitDir := filepath.Join(project.RootPath, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		s.logger.Debug().Str("path", gitDir).Msg(".git directory does not exist at root_path")
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	gitLogArgs := []string{"log", "-n", "20", "--pretty=format:%H|%an|%at|%s"}
	if branch := r.URL.Query().Get("branch"); branch != "" {
		gitLogArgs = append(gitLogArgs, branch)
	}
	cmd := exec.CommandContext(r.Context(), "git", gitLogArgs...)
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().
			Err(err).
			Str("project_id", projectID).
			Str("output", string(out)).
			Msg("git log command failed")
		writeJSON(w, http.StatusOK, []any{})
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

	s.logger.Debug().
		Str("project_id", projectID).
		Int("history_count", len(history)).
		Msg("returning git history to UI")

	writeJSON(w, http.StatusOK, history)
}

func (s *Server) GetProjectGitDiff(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	hash := r.URL.Query().Get("hash")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	var cmd *exec.Cmd
	if hash != "" {
		// Show diff for specific commit
		cmd = exec.CommandContext(r.Context(), "git", "show", hash)
	} else {
		// Show uncommitted changes with optional file and staged filters
		file := r.URL.Query().Get("file")
		staged := r.URL.Query().Get("staged")

		args := []string{"diff"}
		if staged == "true" {
			args = append(args, "--cached")
		}
		if file != "" {
			args = append(args, "--", file)
		}
		cmd = exec.CommandContext(r.Context(), "git", args...)
	}
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Str("hash", hash).Msg("git diff failed")
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(""))
		return
	}

	// For untracked files: if diff produced empty output and a file was specified,
	// fall back to git diff --no-index /dev/null <file>
	file := r.URL.Query().Get("file")
	if len(out) == 0 && file != "" && hash == "" {
		fallback := exec.CommandContext(r.Context(), "git", "diff", "--no-index", "/dev/null", file)
		fallback.Dir = project.RootPath
		fallbackOut, _ := fallback.CombinedOutput()
		if len(fallbackOut) > 0 {
			out = fallbackOut
		}
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write(out)
}

func (s *Server) GetProjectGitHubIssues(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSON(w, http.StatusOK, map[string]any{"issues": []any{}, "has_more": false})
		return
	}

	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if parsed, parseErr := strconv.Atoi(p); parseErr == nil && parsed > 0 {
			page = parsed
		}
	}
	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("github token refresh failed")
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	issues, err := ghutil.ListIssues(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, state, page)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to fetch github issues")
		writeJSONError(w, http.StatusBadGateway, "github_fetch_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"issues": issues, "has_more": len(issues) == 50})
}

func (s *Server) GetDefaultBranch(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	branch := git.DefaultBranch(r.Context(), project.RootPath)
	writeJSON(w, http.StatusOK, map[string]string{"branch": branch})
}

func (s *Server) GetProjectGitBranches(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	// Get current branch
	currentCmd := exec.CommandContext(r.Context(), "git", "rev-parse", "--abbrev-ref", "HEAD")
	currentCmd.Dir = project.RootPath
	currentOut, err := currentCmd.Output()
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to get current branch")
		writeJSONError(w, http.StatusInternalServerError, "git_failed", "failed to get current branch")
		return
	}
	current := strings.TrimSpace(string(currentOut))

	// Get all branches
	branchCmd := exec.CommandContext(r.Context(), "git", "branch", "--list")
	branchCmd.Dir = project.RootPath
	branchOut, err := branchCmd.Output()
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to list branches")
		writeJSONError(w, http.StatusInternalServerError, "git_failed", "failed to list branches")
		return
	}

	var branches []string
	for _, line := range strings.Split(string(branchOut), "\n") {
		name := strings.TrimSpace(strings.TrimPrefix(line, "*"))
		if name != "" {
			branches = append(branches, name)
		}
	}

	// Get remote branches
	remoteCmd := exec.CommandContext(r.Context(), "git", "branch", "-r", "--list")
	remoteCmd.Dir = project.RootPath
	remoteOut, err := remoteCmd.Output()
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to list remote branches")
		// Non-fatal: return empty remotes
		remoteOut = nil
	}

	var remoteBranches []string
	for _, line := range strings.Split(string(remoteOut), "\n") {
		name := strings.TrimSpace(line)
		if name == "" || strings.Contains(name, "->") {
			continue
		}
		remoteBranches = append(remoteBranches, name)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"current":  current,
		"branches": branches,
		"remotes":  remoteBranches,
	})
}

func (s *Server) GetProjectGitBranchesDetail(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git branches detail attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	defaultBranch, branches, err := git.BranchesDetail(r.Context(), project.RootPath)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to get branch details")
		writeJSONError(w, http.StatusInternalServerError, "git_failed", "failed to get branch details")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"default_branch": defaultBranch,
		"branches":       branches,
	})
}

func (s *Server) CreateProjectGitHubIssue(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	var req ghutil.CreateIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Title == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "title is required")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	issue, err := ghutil.CreateIssue(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, req)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to create github issue")
		writeJSONError(w, http.StatusBadGateway, "github_create_failed", fmt.Sprintf("failed to create issue: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, issue)
}

func (s *Server) UpdateProjectGitHubIssue(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid issue number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	var req ghutil.UpdateIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	issue, err := ghutil.UpdateIssue(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number, req)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to update github issue")
		writeJSONError(w, http.StatusBadGateway, "github_update_failed", fmt.Sprintf("failed to update issue: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, issue)
}

func (s *Server) GetProjectGitHubPulls(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSON(w, http.StatusOK, map[string]any{"pulls": []any{}, "has_more": false})
		return
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if parsed, parseErr := strconv.Atoi(p); parseErr == nil && parsed > 0 {
			page = parsed
		}
	}
	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("github token refresh failed")
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	prs, err := ghutil.ListPullRequests(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, page)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to fetch github pull requests")
		writeJSONError(w, http.StatusBadGateway, "github_fetch_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"pulls": prs, "has_more": len(prs) == 30})
}

func (s *Server) GetProjectGitHubPullDiff(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid pull request number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	diff, err := ghutil.GetPullRequestDiff(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to fetch PR diff")
		writeJSONError(w, http.StatusBadGateway, "github_fetch_failed", fmt.Sprintf("failed to fetch PR diff: %v", err))
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (s *Server) CreateProjectGitHubPull(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	var req ghutil.PRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Title == "" || req.Head == "" || req.Base == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "title, head, and base are required")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	pr, err := ghutil.CreatePullRequest(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, req)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to create github pull request")
		writeJSONError(w, http.StatusBadGateway, "github_create_failed", fmt.Sprintf("failed to create pull request: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, pr)
}

func (s *Server) PostGitCheckout(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git checkout attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Branch == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "branch is required")
		return
	}

	if err := git.Checkout(r.Context(), project.RootPath, req.Branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git checkout failed")
		writeJSONError(w, http.StatusInternalServerError, "git_checkout_failed", "git checkout failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitMerge(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Branch == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "branch is required")
		return
	}

	if err := git.Merge(r.Context(), project.RootPath, req.Branch); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "git_merge_failed", "git merge failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitCreateBranch(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git create branch attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Name == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "name is required")
		return
	}

	if err := git.CreateBranch(r.Context(), project.RootPath, req.Name); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git create branch failed")
		writeJSONError(w, http.StatusInternalServerError, "git_create_branch_failed", "git create branch failed")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

func (s *Server) DeleteGitBranch(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	branch := chi.URLParam(r, "branch")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git delete branch attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	if branch == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "branch is required")
		return
	}

	if err := git.DeleteBranch(r.Context(), project.RootPath, branch); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git delete branch failed")
		writeJSONError(w, http.StatusInternalServerError, "git_delete_branch_failed", "git delete branch failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitStage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stage attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Files []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if len(req.Files) == 0 {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "files is required")
		return
	}

	if err := git.Stage(r.Context(), project.RootPath, req.Files); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stage failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stage_failed", "git stage failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitUnstage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git unstage attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Files []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if len(req.Files) == 0 {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "files is required")
		return
	}

	if err := git.Unstage(r.Context(), project.RootPath, req.Files); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git unstage failed")
		writeJSONError(w, http.StatusInternalServerError, "git_unstage_failed", "git unstage failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitStash(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stash attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	if err := git.Stash(r.Context(), project.RootPath); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stash failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stash_failed", "git stash failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitStashPop(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stash pop attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	if err := git.StashPop(r.Context(), project.RootPath); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stash pop failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stash_pop_failed", "git stash pop failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetGitStashList(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stash list attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	stashes, err := git.StashList(r.Context(), project.RootPath)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stash list failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stash_list_failed", "git stash list failed")
		return
	}

	if stashes == nil {
		stashes = []map[string]string{}
	}
	writeJSON(w, http.StatusOK, stashes)
}

func (s *Server) PostGitStashApply(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stash apply attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Ref string `json:"ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if req.Ref == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "ref is required")
		return
	}

	if err := git.StashApply(r.Context(), project.RootPath, req.Ref); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stash apply failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stash_apply_failed", "git stash apply failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitStashDrop(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git stash drop attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		Ref string `json:"ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if req.Ref == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "ref is required")
		return
	}

	if err := git.StashDrop(r.Context(), project.RootPath, req.Ref); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git stash drop failed")
		writeJSONError(w, http.StatusInternalServerError, "git_stash_drop_failed", "git stash drop failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetGitConflicts(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git conflicts attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	// Check for unmerged files via git status --porcelain
	cmd := exec.CommandContext(r.Context(), "git", "status", "--porcelain")
	cmd.Dir = project.RootPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git status failed")
		writeJSONError(w, http.StatusInternalServerError, "git_status_failed", "git status failed")
		return
	}

	var conflictFiles []string
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 3 {
			continue
		}
		xy := line[:2]
		// Unmerged statuses: UU, AA, DD, AU, UA, DU, UD
		if strings.Contains(xy, "U") || xy == "AA" || xy == "DD" {
			filePath := strings.TrimSpace(line[3:])
			conflictFiles = append(conflictFiles, filePath)
		}
	}

	// Check if in merge state
	mergeHeadPath := filepath.Join(project.RootPath, ".git", "MERGE_HEAD")
	_, mergeErr := os.Stat(mergeHeadPath)
	inMerge := mergeErr == nil

	if conflictFiles == nil {
		conflictFiles = []string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"in_merge": inMerge,
		"files":    conflictFiles,
	})
}

func (s *Server) PostGitMergeAbort(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git merge abort attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "merge", "--abort")
	cmd.Dir = project.RootPath
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("git merge abort failed")
		writeJSONError(w, http.StatusInternalServerError, "git_merge_abort_failed", "git merge --abort failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostGitConflictResolve(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
		s.logger.Warn().Err(err).Str("path", project.RootPath).Msg("unauthorized git resolve attempt")
		writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
		return
	}

	var req struct {
		File string `json:"file"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if req.File == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "file is required")
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", "add", req.File)
	cmd.Dir = project.RootPath
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Str("file", req.File).Msg("git add (resolve) failed")
		writeJSONError(w, http.StatusInternalServerError, "git_resolve_failed", "git add failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetPRReviews(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid pull request number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	reviews, err := ghutil.ListPRReviews(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to fetch PR reviews")
		writeJSONError(w, http.StatusBadGateway, "github_fetch_failed", fmt.Sprintf("failed to fetch PR reviews: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, reviews)
}

func (s *Server) PostPRReview(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid pull request number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	var req ghutil.ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	if err := ghutil.SubmitPRReview(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number, req); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to submit PR review")
		writeJSONError(w, http.StatusBadGateway, "github_review_failed", fmt.Sprintf("failed to submit PR review: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) PostPRMerge(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid pull request number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	var req struct {
		Method string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.Method == "" {
		req.Method = "merge"
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	if err := ghutil.MergePR(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number, req.Method); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to merge PR")
		writeJSONError(w, http.StatusBadGateway, "github_merge_failed", fmt.Sprintf("failed to merge PR: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) GetPRComments(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	numberStr := chi.URLParam(r, "number")

	number, err := strconv.Atoi(numberStr)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_number", "invalid pull request number")
		return
	}

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
		writeJSONError(w, http.StatusBadRequest, "github_not_configured", "GitHub is not configured for this project")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	comments, err := ghutil.ListPRComments(r.Context(), project.GitHubOwner, project.GitHubRepo, ghToken, number)
	if err != nil {
		s.logger.Warn().Err(err).Str("project_id", projectID).Int("number", number).Msg("failed to fetch PR comments")
		writeJSONError(w, http.StatusBadGateway, "github_fetch_failed", fmt.Sprintf("failed to fetch PR comments: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, comments)
}

func (s *Server) PostCreateGitHubRepo(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")

	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if project.GitHubToken == "" {
		writeJSONError(w, http.StatusPreconditionFailed, "github_not_connected", "GitHub is not connected for this project")
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Private     bool   `json:"private"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if req.Name == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "name is required")
		return
	}

	ghToken, err := s.resolveGitHubToken(r.Context(), project)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "token_expired", err.Error())
		return
	}
	repo, err := ghutil.CreateRepository(r.Context(), ghToken, ghutil.CreateRepoRequest{
		Name:        req.Name,
		Description: req.Description,
		Private:     req.Private,
	})
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to create github repo")
		writeJSONError(w, http.StatusBadGateway, "github_create_failed", err.Error())
		return
	}

	// Set remote origin on the local git repo
	addCmd := exec.CommandContext(r.Context(), "git", "remote", "add", "origin", repo.CloneURL)
	addCmd.Dir = project.RootPath
	if err := addCmd.Run(); err != nil {
		// Remote may already exist, try set-url instead
		setCmd := exec.CommandContext(r.Context(), "git", "remote", "set-url", "origin", repo.CloneURL)
		setCmd.Dir = project.RootPath
		if setErr := setCmd.Run(); setErr != nil {
			s.logger.Error().Err(setErr).Str("project_id", projectID).Msg("failed to set git remote")
			writeJSONError(w, http.StatusInternalServerError, "git_remote_failed", "failed to set git remote origin")
			return
		}
	}

	// Parse owner/repo from full_name (e.g. "owner/repo")
	parts := strings.SplitN(repo.FullName, "/", 2)
	if len(parts) != 2 {
		s.logger.Error().Str("full_name", repo.FullName).Msg("unexpected full_name format")
		writeJSONError(w, http.StatusInternalServerError, "parse_error", "unexpected repository full_name format")
		return
	}

	// Update the project record with github_owner, github_repo, and remote_url
	if err := s.db.UpdateProjectGitHubFull(r.Context(), projectID, parts[0], parts[1], repo.CloneURL); err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to update project github info")
		writeJSONError(w, http.StatusInternalServerError, "db_update_failed", "failed to update project record")
		return
	}

	// Initial push
	pushCmd := exec.CommandContext(r.Context(), "git", "push", "-u", "origin", "HEAD")
	pushCmd.Dir = project.RootPath
	if pushOut, err := pushCmd.CombinedOutput(); err != nil {
		s.logger.Warn().Err(err).Str("output", string(pushOut)).Str("project_id", projectID).Msg("initial git push failed (non-fatal)")
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"full_name": repo.FullName,
		"clone_url": repo.CloneURL,
		"ssh_url":   repo.SSHURL,
		"html_url":  repo.HTMLURL,
	})
}

// GetProjectTrackerIssues handles GET /api/v1/projects/{project_id}/tracker/issues.
// Returns live work items from the project's issue source adapter (bypasses the local DB).
// Optional ?states=todo,in+progress filter mirrors the global browse endpoint.
func (s *Server) GetProjectTrackerIssues(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}
	if s.registry == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "no_registry", "registry not available")
		return
	}
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "project not found")
		return
	}
	adapter, err := s.registry.GetAdapterForProjectDirect(project)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "adapter_error", err.Error())
		return
	}
	if adapter == nil {
		writeJSONError(w, http.StatusUnprocessableEntity, "no_source", "project has no issue source configured")
		return
	}
	filter := tracker.Filter{}
	if states := r.URL.Query().Get("states"); states != "" {
		filter.States = strings.Split(states, ",")
	}
	items, err := adapter.Fetch(r.Context(), filter)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	if items == nil {
		items = []tracker.WorkItem{}
	}
	writeJSON(w, http.StatusOK, items)
}

// PatchProjectIssueSource handles PATCH /api/v1/projects/{project_id}/issue-source.
// Saves the per-project tracker connection (type, endpoint, token).
// Pass token="" to leave the existing token unchanged; pass type="" to clear the source.
func (s *Server) PatchProjectIssueSource(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		Type     string `json:"type"`
		Endpoint string `json:"endpoint"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := s.db.UpdateProjectIssueSource(r.Context(), projectID, req.Type, req.Endpoint, req.Token); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "not_found", "project not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// PostProjectIssueSourceTest handles POST /api/v1/projects/{project_id}/issue-source/test.
// Builds a temporary adapter from the project's stored (or request-provided) credentials
// and calls Ping to verify connectivity without persisting anything.
func (s *Server) PostProjectIssueSourceTest(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}
	if s.registry == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "no_registry", "registry not available")
		return
	}
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "not_found", "project not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Allow testing with override values from the request body (not yet saved)
	var req struct {
		Type     string `json:"type"`
		Endpoint string `json:"endpoint"`
		Token    string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	testProject := project
	if req.Type != "" {
		testProject.IssueSourceType = req.Type
	}
	if req.Endpoint != "" {
		testProject.IssueSourceEndpoint = req.Endpoint
	}
	if req.Token != "" {
		testProject.IssueSourceToken = req.Token
	}

	if testProject.IssueSourceType == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "no issue source configured"})
		return
	}

	adapter, err := s.registry.GetAdapterForProjectDirect(testProject)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if adapter == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "no issue source configured"})
		return
	}
	if err := adapter.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PostProjectIssueSourceListProjects handles POST /api/v1/projects/{project_id}/issue-source/list-projects.
// Builds a temporary adapter from stored or request-provided credentials and returns
// the tracker's available projects so the UI can show a picker before saving.
func (s *Server) PostProjectIssueSourceListProjects(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not available")
		return
	}
	if s.registry == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "no_registry", "registry not available")
		return
	}
	projectID := chi.URLParam(r, "project_id")
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "not_found", "project not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	var req struct {
		Type     string `json:"type"`
		Endpoint string `json:"endpoint"`
		Token    string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	testProject := project
	if req.Type != "" {
		testProject.IssueSourceType = req.Type
	}
	if req.Endpoint != "" {
		testProject.IssueSourceEndpoint = req.Endpoint
	}
	if req.Token != "" {
		testProject.IssueSourceToken = req.Token
	}

	if testProject.IssueSourceType == "" {
		writeJSONError(w, http.StatusBadRequest, "no_source", "no issue source type configured")
		return
	}

	adapter, err := s.registry.GetAdapterForProjectDirect(testProject)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "adapter_error", err.Error())
		return
	}
	if adapter == nil {
		writeJSONError(w, http.StatusBadRequest, "no_adapter", "no issue source configured")
		return
	}

	projects, err := adapter.FetchProjects(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "fetch_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}
