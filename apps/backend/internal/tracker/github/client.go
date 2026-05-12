// Package github provides a GitHub Issues-backed implementation of the tracker.Client interface.
package github

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// Compile-time assertion that Client satisfies tracker.Adapter.
var _ tracker.Adapter = (*Client)(nil)

// Client is a tracker backed by the GitHub Issues REST API for a single repository.
type Client struct {
	owner      string
	repo       string
	token      string
	httpClient *http.Client
	localDB    *db.DB
}

// NewClient creates a new GitHub tracker Client for the given repository.
// If httpClient is nil, http.DefaultClient is used.
// If localDB is provided, the client will also clean up the local database when deleting issues.
func NewClient(owner, repo, token string, httpClient *http.Client, localDB *db.DB) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		owner:      owner,
		repo:       repo,
		token:      token,
		httpClient: httpClient,
		localDB:    localDB,
	}
}

// FetchCandidateIssues returns GitHub issues matching the given active states.
func (c *Client) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	// For GitHub, we'll map "open" state to candidate issues if they have specific labels or just open status.
	// This is a simplified implementation.
	return c.FetchIssuesByStates(ctx, activeStates)
}

// FetchIssuesByIDs fetches individual GitHub issues by their number, one at a time.
func (c *Client) FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]tracker.Issue, error) {
	// GitHub REST API doesn't support bulk fetch by ID easily without multiple calls or search query.
	var issues []tracker.Issue
	for _, id := range issueIDs {
		issue, err := c.FetchIssueByIdentifier(ctx, id)
		if err != nil {
			continue // Log error and continue?
		}
		issues = append(issues, *issue)
	}
	return issues, nil
}

// FetchIssuesByStates returns GitHub issues filtered by the given states,
// mapping internal states to GitHub open/closed terminology.
func (c *Client) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	// Map our states to GitHub states (open/closed)
	ghState := "open"
	for _, s := range states {
		if strings.ToLower(s) == "closed" || strings.ToLower(s) == "done" || strings.ToLower(s) == "completed" {
			ghState = "all" // If they want closed, we fetch all and filter or just closed
			break
		}
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues?state=%s", c.owner, c.repo, ghState)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d", resp.StatusCode)
	}

	var ghIssues []struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		State   string `json:"state"`
		HTMLURL string `json:"html_url"`
		Labels  []struct {
			Name string `json:"name"`
		} `json:"labels"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&ghIssues); err != nil {
		return nil, err
	}

	issues := make([]tracker.Issue, 0, len(ghIssues))
	for _, gh := range ghIssues {
		labels := make([]string, 0, len(gh.Labels))
		for _, l := range gh.Labels {
			labels = append(labels, l.Name)
		}

		issue := tracker.Issue{
			ID:          fmt.Sprintf("%d", gh.Number),
			Identifier:  fmt.Sprintf("%s-%d", c.repo, gh.Number), // repo-number format
			Title:       gh.Title,
			Description: gh.Body,
			State:       gh.State,
			URL:         gh.HTMLURL,
			Labels:      labels,
			CreatedAt:   gh.CreatedAt,
			UpdatedAt:   gh.UpdatedAt,
		}
		issues = append(issues, issue)
	}

	return issues, nil
}

// FetchIssueStatesByIDs returns a map of issue ID to current state for the given IDs.
func (c *Client) FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error) {
	results := make(map[string]string)
	for _, id := range issueIDs {
		issue, err := c.FetchIssueByIdentifier(ctx, id)
		if err != nil {
			continue
		}
		results[id] = issue.State
	}
	return results, nil
}

// FetchIssues returns issues matching the given filter, delegating to FetchIssuesByStates.
func (c *Client) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	return c.FetchIssuesByStates(ctx, filter.States)
}

// SearchIssues searches GitHub issues by query text. Not yet implemented.
func (c *Client) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	// Search implementation using GitHub search API
	return nil, fmt.Errorf("GitHub SearchIssues not implemented yet")
}

// CreateIssue creates a new GitHub issue. Not yet implemented.
func (c *Client) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*tracker.Issue, error) {
	return nil, fmt.Errorf("GitHub CreateIssue not implemented yet")
}

// UpdateIssue patches a GitHub issue via the REST API, mapping internal states to GitHub states.
func (c *Client) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	// identifier is usually repo-number (e.g. orchestra-123)
	parts := strings.Split(identifier, "-")
	issueNumber := parts[len(parts)-1]

	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%s", c.owner, c.repo, issueNumber)

	ghUpdates := make(map[string]any)
	for k, v := range updates {
		if k == "state" {
			if s, ok := v.(string); ok {
				if strings.ToLower(s) == "done" || strings.ToLower(s) == "closed" || strings.ToLower(s) == "completed" {
					ghUpdates["state"] = "closed"
				} else {
					ghUpdates["state"] = "open"
				}
			}
		} else {
			ghUpdates[k] = v
		}
	}

	body, err := json.Marshal(ghUpdates)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}

	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d for update issue %s", resp.StatusCode, identifier)
	}

	return c.FetchIssueByIdentifier(ctx, issueNumber)
}

// DeleteIssue closes the GitHub issue and cleans up the local database.
// Since GitHub does not support true deletion, we close the issue and remove it from local storage.
func (c *Client) DeleteIssue(ctx context.Context, identifier string) error {
	issueNumber := identifier
	if strings.Contains(identifier, "-") {
		parts := strings.Split(identifier, "-")
		issueNumber = parts[len(parts)-1]
	}

	// 1. Close the GitHub issue
	body, err := json.Marshal(map[string]string{"state": "closed"})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%s", c.owner, c.repo, issueNumber)
	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(body))
	if err != nil {
		return err
	}

	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github api returned status %d for close issue %s", resp.StatusCode, identifier)
	}

	// 2. Clean up local database if available
	if c.localDB != nil {
		if err := c.cleanupLocalDatabase(ctx, identifier); err != nil {
			return fmt.Errorf("cleanup local database after GitHub issue deletion: %w", err)
		}
	}

	return nil
}

// cleanupLocalDatabase performs the same cleanup operations as the SQLite tracker
// to maintain consistency between GitHub and local state.
func (c *Client) cleanupLocalDatabase(ctx context.Context, identifier string) error {
	tx, err := c.localDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("cleanup database begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete runs referencing this issue
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM runs
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("delete issue runs: %w", err)
	}

	// Delete issue history
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM issue_history
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("delete issue history: %w", err)
	}

	// Clear session.issue_id references
	if _, err := tx.ExecContext(ctx, `
		UPDATE sessions SET issue_id = NULL
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("clear session issue refs: %w", err)
	}

	// Delete the issue itself
	result, err := tx.ExecContext(ctx, "DELETE FROM issues WHERE id = ? OR identifier = ?;", identifier, identifier)
	if err != nil {
		return fmt.Errorf("delete issue: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete issue rows affected: %w", err)
	}
	if affected == 0 {
		return sql.ErrNoRows
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("delete issue commit: %w", err)
	}

	return nil
}

// FetchIssueByIdentifier fetches a single GitHub issue by its number.
func (c *Client) FetchIssueByIdentifier(ctx context.Context, id string) (*tracker.Issue, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%s", c.owner, c.repo, id)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d for issue %s", resp.StatusCode, id)
	}

	var gh struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		State   string `json:"state"`
		HTMLURL string `json:"html_url"`
		Labels  []struct {
			Name string `json:"name"`
		} `json:"labels"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&gh); err != nil {
		return nil, err
	}

	labels := make([]string, 0, len(gh.Labels))
	for _, l := range gh.Labels {
		labels = append(labels, l.Name)
	}

	return &tracker.Issue{
		ID:          fmt.Sprintf("%d", gh.Number),
		Identifier:  fmt.Sprintf("%s-%d", c.repo, gh.Number),
		Title:       gh.Title,
		Description: gh.Body,
		State:       gh.State,
		URL:         gh.HTMLURL,
		Labels:      labels,
		CreatedAt:   gh.CreatedAt,
		UpdatedAt:   gh.UpdatedAt,
	}, nil
}

// ---------------------------------------------------------------------------
// tracker.Adapter implementation
// ---------------------------------------------------------------------------

// Fetch returns WorkItems matching the filter. When filter.States is empty,
// returns open issues. State entries map to GitHub's state param: "open" /
// "closed" / "all". Unknown values default to "open".
func (c *Client) Fetch(ctx context.Context, filter tracker.Filter) ([]tracker.WorkItem, error) {
	ghState := "open"
	for _, s := range filter.States {
		switch strings.ToLower(s) {
		case "closed", "done", "completed":
			ghState = "closed"
		case "all":
			ghState = "all"
		}
	}
	issues, err := c.FetchIssuesByStates(ctx, []string{ghState})
	if err != nil {
		return nil, err
	}
	out := make([]tracker.WorkItem, 0, len(issues))
	for _, i := range issues {
		out = append(out, toWorkItem(i, c.repo))
	}
	return out, nil
}

// FetchByID returns a single WorkItem by either internal ID, prefixed ID
// ("gh:<repo>-N"), or the repo-suffixed identifier ("<repo>-N").
func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	identifier := strings.TrimPrefix(id, "gh:")
	issue, err := c.FetchIssueByIdentifier(ctx, identifier)
	if err != nil {
		return nil, err
	}
	if issue == nil {
		return nil, fmt.Errorf("github: issue %q not found", id)
	}
	w := toWorkItem(*issue, c.repo)
	return &w, nil
}

// Search searches GitHub issues by query text.
func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	issues, err := c.SearchIssues(ctx, query)
	if err != nil {
		return nil, err
	}
	out := make([]tracker.WorkItem, 0, len(issues))
	for _, i := range issues {
		out = append(out, toWorkItem(i, c.repo))
	}
	return out, nil
}

// Create creates a new GitHub issue via the Adapter interface.
func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	issue, err := c.CreateIssue(ctx, item.Title, item.Description, item.State,
		item.Priority, item.AssigneeID, item.ProjectID, item.Provider, item.DisabledTools)
	if err != nil {
		return nil, err
	}
	w := toWorkItem(*issue, c.repo)
	return &w, nil
}

// Update patches a GitHub issue via the Adapter interface.
func (c *Client) Update(ctx context.Context, id string, updates map[string]any) (*tracker.WorkItem, error) {
	identifier := strings.TrimPrefix(id, "gh:")
	issue, err := c.UpdateIssue(ctx, identifier, updates)
	if err != nil {
		return nil, err
	}
	w := toWorkItem(*issue, c.repo)
	return &w, nil
}

// Delete closes the GitHub issue and cleans up the local database via the Adapter interface.
func (c *Client) Delete(ctx context.Context, id string) error {
	identifier := strings.TrimPrefix(id, "gh:")
	return c.DeleteIssue(ctx, identifier)
}

// Comment posts a comment to the GitHub issue. id may be prefixed ("gh:<repo>-N")
// or unprefixed ("<repo>-N"); only the trailing number is sent to GitHub.
func (c *Client) Comment(ctx context.Context, id, body string) error {
	identifier := strings.TrimPrefix(id, "gh:")
	number := identifier
	if idx := strings.LastIndex(identifier, "-"); idx >= 0 {
		number = identifier[idx+1:]
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%s/comments", c.owner, c.repo, number)
	payload := map[string]string{"body": body}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("github: comment status %d", resp.StatusCode)
	}
	return nil
}

// FetchProjects returns a single TrackerProject representing the configured repo.
// GitHub connections in Orchestra are single-repo by configuration.
func (c *Client) FetchProjects(_ context.Context) ([]tracker.TrackerProject, error) {
	return []tracker.TrackerProject{{
		ID:   c.owner + "/" + c.repo,
		Name: c.owner + "/" + c.repo,
	}}, nil
}

// FetchStates returns the two static workflow states GitHub Issues supports.
func (c *Client) FetchStates(_ context.Context) ([]tracker.TrackerState, error) {
	return []tracker.TrackerState{
		{ID: "open", Name: "open", Type: "todo"},
		{ID: "closed", Name: "closed", Type: "done"},
	}, nil
}

// Ping verifies credentials by calling /user. Authenticated requests succeed
// even on private repos; an empty token still lets us hit a public endpoint.
func (c *Client) Ping(ctx context.Context) error {
	url := "https://api.github.com/user"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("github: unauthorized — invalid token")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("github: ping status %d", resp.StatusCode)
	}
	return nil
}

// toWorkItem converts a legacy tracker.Issue produced by the GitHub client
// into the canonical WorkItem shape used by the Adapter interface.
// Sets Source="github" and prefixes the ID with "gh:".
func toWorkItem(i tracker.Issue, repo string) tracker.WorkItem {
	_ = repo                 // repo is embedded in Identifier already; kept for signature clarity
	w := tracker.WorkItem(i) // Issue is a type alias for WorkItem
	w.Source = "github"
	if !strings.HasPrefix(w.ID, "gh:") {
		// Legacy IDs are bare numbers; convert to "gh:<repo>-<number>" for adapter use.
		// Identifier (already "<repo>-<number>") is preserved as-is.
		if w.Identifier != "" {
			w.ID = "gh:" + w.Identifier
		} else {
			w.ID = "gh:" + w.ID
		}
	}
	return w
}
