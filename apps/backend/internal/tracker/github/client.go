package github

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type Client struct {
	owner      string
	repo       string
	token      string
	httpClient *http.Client
}

func NewClient(owner, repo, token string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		owner:      owner,
		repo:       repo,
		token:      token,
		httpClient: httpClient,
	}
}

func (c *Client) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	// For GitHub, we'll map "open" state to candidate issues if they have specific labels or just open status.
	// This is a simplified implementation.
	return c.FetchIssuesByStates(ctx, activeStates)
}

func (c *Client) FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]tracker.Issue, error) {
	// GitHub REST API doesn't support bulk fetch by ID easily without multiple calls or search query.
	var issues []tracker.Issue
	for _, id := range issueIDs {
		issue, err := c.fetchIssue(ctx, id)
		if err != nil {
			continue // Log error and continue?
		}
		issues = append(issues, *issue)
	}
	return issues, nil
}

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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d", resp.StatusCode)
	}

	var ghIssues []struct {
		Number int    `json:"number"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		State  string `json:"state"`
		HTMLURL string `json:"html_url"`
		Labels []struct {
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

func (c *Client) FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error) {
	results := make(map[string]string)
	for _, id := range issueIDs {
		issue, err := c.fetchIssue(ctx, id)
		if err != nil {
			continue
		}
		results[id] = issue.State
	}
	return results, nil
}

func (c *Client) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	return c.FetchIssuesByStates(ctx, filter.States)
}

func (c *Client) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	// Search implementation using GitHub search API
	return nil, fmt.Errorf("GitHub SearchIssues not implemented yet")
}

func (c *Client) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string) (*tracker.Issue, error) {
	return nil, fmt.Errorf("GitHub CreateIssue not implemented yet")
}

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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d for update issue %s", resp.StatusCode, identifier)
	}

	return c.fetchIssue(ctx, issueNumber)
}

func (c *Client) DeleteIssue(ctx context.Context, identifier string) error {
	return fmt.Errorf("GitHub DeleteIssue not implemented yet")
}

func (c *Client) fetchIssue(ctx context.Context, id string) (*tracker.Issue, error) {
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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status %d for issue %s", resp.StatusCode, id)
	}

	var gh struct {
		Number int    `json:"number"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		State  string `json:"state"`
		HTMLURL string `json:"html_url"`
		Labels []struct {
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
