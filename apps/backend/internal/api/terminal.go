package api

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

func (s *Server) TerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	if !s.isTerminalAuthorized(r) {
		writeJSONError(w, http.StatusUnauthorized, "unauthorized", "missing or invalid bearer token")
		return
	}

	sessionID := chi.URLParam(r, "session_id")
	projectID := r.URL.Query().Get("project_id")

	if sessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}

	// Resolve project path if provided
	dir := s.workspaceRoot
	if projectID != "" {
		project, err := s.db.GetProjectByID(r.Context(), projectID)
		if err == nil {
			dir = project.RootPath
		}
	}

	upgrader := websocket.Upgrader{CheckOrigin: s.allowWebSocketOrigin}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to upgrade to websocket")
		return
	}
	defer conn.Close()

	// Default to bash
	command := "/bin/bash"
	args := []string{}

	// If this is an issue session, we launch the specific agent command
	if strings.HasPrefix(sessionID, "issue-") {
		issueIdentifier := strings.TrimPrefix(sessionID, "issue-")
		// Find the issue to get its provider
		if issues, err := s.orchestrator.ListIssues(r.Context(), tracker.IssueFilter{}); err == nil {
			for _, issue := range issues {
				if issue.Identifier == issueIdentifier {
					provider := issue.Provider
					if provider == "" {
						provider = s.config.AgentProvider
					}

					if cmd, ok := s.config.AgentCommands[provider]; ok && cmd != "" {
						// Use shell to run the agent command so we can see its TUI if it has one
						args = []string{"-c", cmd}
					}
					break
				}
			}
		}
	}

	session, err := s.termManager.CreateSession(sessionID, dir, command, args...)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to create terminal session")
		return
	}

	// Send data to client
	handlerID := session.AddHandler(func(data []byte) {
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
