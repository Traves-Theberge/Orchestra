package api

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strings"

	"github.com/google/go-github/v69/github"
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

	// Store token in DB
	err = s.updateProjectGitHubToken(ctx, state, tok.AccessToken)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to update project with github token")
		writeJSONError(w, http.StatusInternalServerError, "db_update_failed", "failed to save authentication state")
		return
	}

	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, "<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#09090b;color:white;'>"+
		"<div style='text-align:center;padding:2rem;background:#18181b;border-radius:1rem;border:1px solid #27272a;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)'>"+
		"<h1 style='color:#10b981;'>Success!</h1><p>GitHub account connected to project.</p>"+
		"<p style='font-size:0.8rem;color:#71717a;'>You can close this window now.</p>"+
		"<script>setTimeout(() => window.close(), 2000);</script></div></body></html>")
}

func (s *Server) updateProjectGitHubToken(ctx context.Context, projectID, token string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE projects SET github_token = ? WHERE id = ?", token, projectID)
	return err
}
