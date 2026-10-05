package api

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func (s *Server) TerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.isTerminalAuthorized(r) {
		writeJSONError(w, http.StatusUnauthorized, "unauthorized", "missing or invalid bearer token")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	projectID := r.URL.Query().Get("project_id")
	cwdOverride := r.URL.Query().Get("cwd")

	if sessionID == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "session_id is required")
		return
	}

	// Resolve project path if provided
	dir := s.workspaceRoot
	if projectID != "" {
		if s.db == nil {
			writeJSONError(w, http.StatusServiceUnavailable, "project_unavailable", "project lookup is unavailable")
			return
		}
		project, err := s.db.GetProjectByID(r.Context(), projectID)
		if err != nil {
			writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
			return
		}
		if err := workspace.ValidateProjectPath(project.RootPath, s.config.ProjectRoots); err != nil {
			writeJSONError(w, http.StatusForbidden, "unauthorized_project_path", "unauthorized project path")
			return
		}
		dir = project.RootPath

		// For issue-scoped terminals, use the worktree path if available
		if strings.HasPrefix(sessionID, "issue-") && s.worktreeRoot != "" {
			issueIdent := strings.TrimPrefix(sessionID, "issue-")
			if issues, listErr := s.orchestrator.ListIssues(r.Context(), tracker.IssueFilter{}); listErr == nil {
				for _, iss := range issues {
					if iss.Identifier == issueIdent && iss.BranchName != "" {
						wtPath := filepath.Join(s.worktreeRoot, project.ID, iss.BranchName)
						if info, statErr := os.Stat(wtPath); statErr == nil && info.IsDir() {
							dir = wtPath
						}
						break
					}
				}
			}
		}
	}

	// An explicit checkout must never silently become a different checkout.
	if cwdOverride != "" {
		if !filepath.IsAbs(cwdOverride) {
			writeJSONError(w, http.StatusBadRequest, "invalid_terminal_cwd", "terminal cwd must be an absolute directory path")
			return
		}
		dir = cwdOverride
	}
	if projectID != "" || cwdOverride != "" {
		if !filepath.IsAbs(dir) {
			writeJSONError(w, http.StatusBadRequest, "invalid_terminal_cwd", "terminal cwd must be an absolute directory path")
			return
		}
		if err := workspace.ValidateProjectPath(dir, s.config.ProjectRoots); err != nil {
			writeJSONError(w, http.StatusForbidden, "unauthorized_terminal_path", "unauthorized terminal path")
			return
		}
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			writeJSONError(w, http.StatusBadRequest, "invalid_terminal_cwd", "terminal cwd is unavailable or is not a directory")
			return
		}
	}

	upgrader := websocket.Upgrader{CheckOrigin: s.allowWebSocketOrigin}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to upgrade to websocket")
		return
	}
	defer conn.Close()

	session, err := s.termManager.CreateSession(sessionID, dir, "/bin/bash")
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to create terminal session")
		return
	}

	isAgentSession := strings.HasPrefix(sessionID, "issue-")
	handlerID := session.AddHandler(func(data []byte) {
		if isAgentSession {
			filtered := filterAgentOutput(data)
			if len(filtered) == 0 {
				return
			}
			data = filtered
		}
		err := conn.WriteMessage(websocket.BinaryMessage, data)
		if err != nil {
			// Don't log as error, it just means client disconnected
		}
	})
	defer session.RemoveHandler(handlerID)

	// Read from client
	for {
		mt, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		if mt == websocket.BinaryMessage || mt == websocket.TextMessage {
			// Handle resize messages or raw input
			var msg struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Rows uint16 `json:"rows"`
				Cols uint16 `json:"cols"`
			}

			// Try to parse as JSON for control messages
			if err := json.Unmarshal(message, &msg); err == nil {
				if msg.Type == "resize" {
					session.Resize(msg.Rows, msg.Cols)
					continue
				}
			}

			// Fallback to raw input
			session.Write(message)
		}
	}
}

func (s *Server) isTerminalAuthorized(r *http.Request) bool {
	token := strings.TrimSpace(s.authToken)
	if token == "" {
		return true
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "Bearer "+token {
		return true
	}

	queryToken := strings.TrimSpace(r.URL.Query().Get("token"))
	return queryToken == token
}

func (s *Server) allowWebSocketOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}

	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}

	originHost := strings.TrimSpace(originURL.Hostname())
	if originHost == "" {
		return false
	}

	requestHost := strings.TrimSpace(r.Host)
	if requestHost != "" {
		if parsedReqHost, err := url.Parse("http://" + requestHost); err == nil {
			if strings.EqualFold(parsedReqHost.Hostname(), originHost) {
				return true
			}
		}
	}

	if strings.EqualFold(originHost, "localhost") {
		return true
	}
	ip := net.ParseIP(originHost)
	return ip != nil && ip.IsLoopback()
}

// filterAgentOutput transforms raw agent stream-json into human-readable terminal output.
// Extracts agent messages, tool calls, and results from JSON lines.
// Non-JSON lines (like shell prompts) pass through unchanged.
func filterAgentOutput(data []byte) []byte {
	raw := string(data)
	lines := strings.Split(raw, "\n")
	var out []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		// Non-JSON lines pass through (shell prompts, ANSI output)
		// But filter out tool name dumps and extremely long lines (likely agent noise)
		if !strings.HasPrefix(trimmed, "{") {
			if len(trimmed) > 500 || strings.Contains(trimmed, "mcp__") {
				continue // Skip tool name dumps and overly long non-JSON lines
			}
			out = append(out, line)
			continue
		}

		// Parse JSON and extract human-readable content
		var obj map[string]any
		if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
			out = append(out, line)
			continue
		}

		eventType, _ := obj["type"].(string)

		switch eventType {
		case "assistant":
			// Claude: extract text from message.content[]
			if msg, ok := obj["message"].(map[string]any); ok {
				if content, ok := msg["content"].([]any); ok {
					for _, block := range content {
						if b, ok := block.(map[string]any); ok {
							if b["type"] == "text" {
								if text, ok := b["text"].(string); ok && strings.TrimSpace(text) != "" {
									out = append(out, "\033[32m"+text+"\033[0m")
								}
							} else if b["type"] == "tool_use" {
								name, _ := b["name"].(string)
								out = append(out, "\033[33m[tool] "+name+"\033[0m")
							}
						}
					}
				}
			}
		case "user":
			// Claude: tool results
			if msg, ok := obj["message"].(map[string]any); ok {
				if content, ok := msg["content"].([]any); ok {
					for _, block := range content {
						if b, ok := block.(map[string]any); ok {
							if b["type"] == "tool_result" {
								text, _ := b["content"].(string)
								if len(text) > 200 {
									text = text[:200] + "..."
								}
								if text != "" {
									out = append(out, "\033[90m"+text+"\033[0m")
								}
							}
						}
					}
				}
			}
		case "result":
			if result, ok := obj["result"].(string); ok && result != "" {
				out = append(out, "\033[36m"+result+"\033[0m")
			}
		case "item.completed":
			// Codex: extract text from item
			if item, ok := obj["item"].(map[string]any); ok {
				if text, ok := item["text"].(string); ok && strings.TrimSpace(text) != "" {
					itemType, _ := item["type"].(string)
					if itemType == "agent_message" {
						out = append(out, "\033[32m"+text+"\033[0m")
					} else if itemType == "reasoning" {
						out = append(out, "\033[35m"+text+"\033[0m")
					}
				}
			}
		case "message":
			// Gemini: extract content
			if role, _ := obj["role"].(string); role == "assistant" {
				if content, ok := obj["content"].(string); ok && strings.TrimSpace(content) != "" {
					out = append(out, "\033[32m"+content+"\033[0m")
				}
			}
		// Skip noise
		case "system", "rate_limit_event", "progress", "tool_use", "tool_result",
			"content_block_start", "content_block_delta", "content_block_stop",
			"message_start", "message_delta", "message_stop", "ping",
			"init", "config", "session_start", "session_end", "error",
			"event_msg", "session_meta", "turn_context", "response_item":
			// silently drop
		default:
			// Drop unknown JSON events
		}
	}

	if len(out) == 0 {
		return nil
	}
	return []byte(strings.Join(out, "\n") + "\n")
}
