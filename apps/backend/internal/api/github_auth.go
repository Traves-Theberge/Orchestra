package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/go-github/v69/github"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"golang.org/x/oauth2"
	githuboauth "golang.org/x/oauth2/github"
)

func (s *Server) oauthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     s.config.GitHubClientID,
		ClientSecret: s.config.GitHubClientSecret,
		Scopes:       []string{"repo", "user"},
		Endpoint:     githuboauth.Endpoint,
		RedirectURL:  "http://127.0.0.1:4010/api/v1/github/callback",
	}
}

func (s *Server) HandleGitHubLogin(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_project_id", "project_id is required")
		return
	}

	// NEW: Local-First Discovery
	// Try to grab the token from the GitHub CLI if it exists on the system
	cmd := exec.Command("gh", "auth", "token")
	if out, err := cmd.Output(); err == nil {
		token := strings.TrimSpace(string(out))
		if token != "" {
			s.logger.Info().Str("project_id", projectID).Msg("automatically discovered github cli token")
			if err := s.updateProjectGitHubToken(r.Context(), projectID, token); err == nil {
				if s.pubsub != nil {
					s.pubsub.Publish(observability.Event{Type: "GITHUB_CONNECTED", Data: map[string]any{"project_id": projectID}})
				}
				// We found it! Send a success page immediately.
				w.Header().Set("Content-Type", "text/html")
				fmt.Fprintf(w, "<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#09090b;color:white;'>"+
					"<div style='text-align:center;padding:2rem;background:#18181b;border-radius:1rem;border:1px solid #27272a;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)'>"+
					"<h1 style='color:#10b981;'>Connected!</h1><p>Using GitHub CLI credentials from your machine.</p>"+
					"<p style='font-size:0.8rem;color:#71717a;'>This window will close automatically.</p>"+
					"<script>setTimeout(() => window.close(), 1500);</script></div></body></html>")
				return
			}
		}
	}

	if s.config.GitHubClientID == "" {
		writeJSONError(w, http.StatusPreconditionFailed, "github_client_id_not_configured", "GitHub Client ID is not configured. Please login via 'gh auth login' on your machine.")
		return
	}

	// Fallback to browser OAuth if CLI is missing/not logged in
	authURL := s.oauthConfig().AuthCodeURL(projectID, oauth2.AccessTypeOffline)
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func (s *Server) HandleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state") // projectID

	if code == "" || state == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_callback", "missing code or state")
		return
	}

	ctx := r.Context()
	conf := s.oauthConfig()

	tok, err := conf.Exchange(ctx, code)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to exchange github code")
		writeJSONError(w, http.StatusInternalServerError, "token_exchange_failed", "failed to exchange code for token")
		return
	}

	// Use the official client to verify the user/token
	client := github.NewClient(conf.Client(ctx, tok))
	user, _, err := client.Users.Get(ctx, "")
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to fetch github user")
		writeJSONError(w, http.StatusInternalServerError, "user_fetch_failed", "failed to verify github token")
		return
	}

	s.logger.Info().Str("github_user", user.GetLogin()).Str("project_id", state).Msg("github authentication successful")

	// Store full token (access + refresh + expiry) as JSON for auto-refresh support
	tokenJSON, err := json.Marshal(tok)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to serialize github token")
		writeJSONError(w, http.StatusInternalServerError, "token_serialize_failed", "failed to serialize token")
		return
	}
	err = s.updateProjectGitHubToken(ctx, state, string(tokenJSON))
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to update project with github token")
		writeJSONError(w, http.StatusInternalServerError, "db_update_failed", "failed to save authentication state")
		return
	}

	if s.pubsub != nil {
		s.pubsub.Publish(observability.Event{Type: "GITHUB_CONNECTED", Data: map[string]any{"project_id": state}})
	}

	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, "<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#09090b;color:white;'>"+
		"<div style='text-align:center;padding:2rem;background:#18181b;border-radius:1rem;border:1px solid #27272a;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)'>"+
		"<h1 style='color:#10b981;'>Success!</h1><p>GitHub account connected to project.</p>"+
		"<p style='font-size:0.8rem;color:#71717a;'>You can close this window now.</p>"+
		"<script>setTimeout(() => window.close(), 2000);</script></div></body></html>")
}

func (s *Server) updateProjectGitHubToken(ctx context.Context, projectID, token string) error {
	if s.db == nil {
		return fmt.Errorf("database unavailable")
	}
	encrypted, err := db.EncryptToken(token)
	if err != nil {
		return fmt.Errorf("encrypt token: %w", err)
	}
	_, err = s.db.ExecContext(ctx, "UPDATE projects SET github_token = ? WHERE id = ?", encrypted, projectID)
	return err
}

// resolveGitHubToken returns a valid access token for the project, refreshing
// the OAuth token if it has expired. If a refresh occurs, the updated token is
// persisted back to the database. For legacy plain-text tokens (e.g. from gh CLI),
// the token is returned as-is with no refresh attempt.
func (s *Server) resolveGitHubToken(ctx context.Context, project db.Project) (string, error) {
	accessToken, updatedJSON, err := ghutil.RefreshableToken(
		ctx,
		project.GitHubToken,
		s.config.GitHubClientID,
		s.config.GitHubClientSecret,
	)
	if err != nil {
		return "", err
	}

	// If the token was refreshed, persist the new token
	if updatedJSON != "" {
		if dbErr := s.updateProjectGitHubToken(ctx, project.ID, updatedJSON); dbErr != nil {
			s.logger.Warn().Err(dbErr).Str("project_id", project.ID).Msg("failed to persist refreshed github token")
			// Still return the valid access token even if persistence fails
		} else {
			s.logger.Info().Str("project_id", project.ID).Msg("refreshed and persisted github token")
		}
	}

	return accessToken, nil
}

// HandleGitHubAutoConnect connects a project silently with the GitHub CLI's
// login (`gh auth token`) when available. It never opens a browser; the
// desktop falls back to the Connect GitHub button when this reports false.
func (s *Server) HandleGitHubAutoConnect(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	if projectID == "" || s.db == nil {
		writeJSONError(w, http.StatusBadRequest, "missing_project_id", "project_id is required")
		return
	}
	project, err := s.db.GetProjectByID(r.Context(), projectID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	if project.GitHubToken != "" {
		writeJSON(w, http.StatusOK, map[string]any{"connected": true, "source": "existing"})
		return
	}
	out, err := exec.CommandContext(r.Context(), "gh", "auth", "token").Output()
	token := strings.TrimSpace(string(out))
	if err != nil || token == "" {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "reason": "GitHub CLI is not installed or not logged in (run `gh auth login`)."})
		return
	}
	if err := s.updateProjectGitHubToken(r.Context(), projectID, token); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "connect_failed", "failed to store GitHub credentials")
		return
	}
	s.logger.Info().Str("project_id", projectID).Msg("auto-connected github with cli token")
	if s.pubsub != nil {
		s.pubsub.Publish(observability.Event{Type: "GITHUB_CONNECTED", Data: map[string]any{"project_id": projectID}})
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "source": "gh_cli"})
}

func (s *Server) HandleGitHubDisconnect(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_project_id", "project_id is required")
		return
	}

	result, err := s.db.ExecContext(r.Context(), "UPDATE projects SET github_token = '' WHERE id = ?", projectID)
	if err != nil {
		s.logger.Error().Err(err).Str("project_id", projectID).Msg("failed to disconnect github")
		writeJSONError(w, http.StatusInternalServerError, "disconnect_failed", "failed to disconnect github")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "disconnect_failed", "failed to confirm disconnect")
		return
	}
	if rowsAffected == 0 {
		writeJSONError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}

	if s.pubsub != nil {
		s.pubsub.Publish(observability.Event{Type: "GITHUB_DISCONNECTED", Data: map[string]any{"project_id": projectID}})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
