package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) HandleGitHubLogin(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_project_id", "project_id is required")
		return
	}

	clientID := s.config.GitHubClientID
	if clientID == "" {
		writeJSONError(w, http.StatusPreconditionFailed, "github_client_id_not_configured", "GitHub Client ID is not configured on the server")
		return
	}

	// In a real app, we'd generate a random state and store it in a session/cookie.
	// For now, we'll encode the projectID in the state to know where to save the token.
	state := projectID
	
	redirectURI := fmt.Sprintf("https://github.com/login/oauth/authorize?client_id=%s&state=%s&scope=repo,user", 
		url.QueryEscape(clientID), 
		url.QueryEscape(state),
	)

	http.Redirect(w, r, redirectURI, http.StatusTemporaryRedirect)
}

func (s *Server) HandleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state") // This is our projectID

	if code == "" || state == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_callback", "missing code or state")
		return
	}

	projectID := state

	// Exchange code for token
	token, err := s.exchangeGitHubCode(r.Context(), code)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to exchange github code")
		writeJSONError(w, http.StatusInternalServerError, "token_exchange_failed", err.Error())
		return
	}

	// Store token in DB for the project
	err = s.updateProjectGitHubToken(r.Context(), projectID, token)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to update project with github token")
		writeJSONError(w, http.StatusInternalServerError, "db_update_failed", err.Error())
		return
	}

	// Redirect back to frontend
	// We'll assume the frontend is running on the same host or we have a configured base URL.
	// For now, let's just show a success message or redirect to a known path.
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, "<html><body><h1>GitHub Authorized!</h1><p>You can close this window now.</p><script>window.close();</script></body></html>")
}

func (s *Server) exchangeGitHubCode(ctx context.Context, code string) (string, error) {
	values := url.Values{}
	values.Set("client_id", s.config.GitHubClientID)
	values.Set("client_secret", s.config.GitHubClientSecret)
	values.Set("code", code)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token", strings.NewReader(values.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github returned status %d", resp.StatusCode)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.Error != "" {
		return "", fmt.Errorf("github error: %s (%s)", result.Error, result.ErrorDesc)
	}

	return result.AccessToken, nil
}

func (s *Server) updateProjectGitHubToken(ctx context.Context, projectID, token string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE projects SET github_token = ? WHERE id = ?", token, projectID)
	return err
}
