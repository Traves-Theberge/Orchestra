// Package jira provides a Jira REST-backed implementation of tracker.Adapter.
// Supports both Cloud (api/3) and Server/Data Center (api/2), detected by base URL.
package jira

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

var _ tracker.Adapter = (*Client)(nil)

// Client implements tracker.Adapter against the Jira REST API.
type Client struct {
	baseURL        string // e.g. "https://acme.atlassian.net" or "https://jira.internal"
	apiBase        string // "/rest/api/3" for Cloud, "/rest/api/2" for Server
	user           string // email (Cloud) or username (Server); empty Cloud user selects Bearer auth.
	token          string // API token, PAT, or intentionally configured Bearer credential
	httpClient     *http.Client
	stateMap       map[string]string
	jql            string
	cloud          bool
	defaultProject string // default project key used by Create when WorkItem.ProjectID is empty
}

// NewClient creates a Jira adapter.
// Cloud is detected by ".atlassian.net" in baseURL; a configured user selects
// Basic auth (email + API token), while an empty user selects Bearer auth.
// Server/Data Center always uses Basic auth (username + token).
// Pass nil httpClient for http.DefaultClient.
// Pass empty user for Cloud only when the token is an intentional Bearer credential.
// stateMap maps Jira status names to Orchestra states; user-defined per connection.
func NewClient(baseURL, user, token string, httpClient *http.Client, stateMap map[string]string) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	cloud := strings.Contains(baseURL, ".atlassian.net")
	apiBase := "/rest/api/2"
	if cloud {
		apiBase = "/rest/api/3"
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiBase:    apiBase,
		user:       user,
		token:      token,
		httpClient: httpClient,
		stateMap:   stateMap,
		cloud:      cloud,
	}
}

// SetJQL sets the default JQL used by Fetch when no per-call JQL is provided.
func (c *Client) SetJQL(jql string) { c.jql = jql }

// SetDefaultProject sets the project key used by Create when WorkItem.ProjectID is empty.
// Jira REST requires fields.project.key on every issueCreate call.
func (c *Client) SetDefaultProject(projectKey string) { c.defaultProject = projectKey }

// IsCloud reports whether this Client was configured against a Jira Cloud instance
// (detected by ".atlassian.net" in the base URL).
func (c *Client) IsCloud() bool { return c.cloud }

// request makes an authenticated REST call. body may be nil. out may be nil.
// Returns an error on non-2xx status. Always drains the response body.
func (c *Client) request(ctx context.Context, method, path string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.cloud && c.user == "" {
		// Empty Cloud username selects an intentionally configured Bearer token.
		req.Header.Set("Authorization", "Bearer "+c.token)
	} else {
		req.SetBasicAuth(c.user, c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("jira: %s %s: status %d", method, path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// FilterFromJQL embeds a JQL string into a tracker.Filter so callers using
// Filter.States can pass JQL through. This is a Jira-specific escape hatch.
// The convention: a States entry prefixed with "__jql:" holds the literal JQL.
func FilterFromJQL(jql string) tracker.Filter {
	return tracker.Filter{States: []string{"__jql:" + jql}}
}

func (c *Client) Fetch(ctx context.Context, filter tracker.Filter) ([]tracker.WorkItem, error) {
	jql := ""
	for _, s := range filter.States {
		if strings.HasPrefix(s, "__jql:") {
			jql = strings.TrimPrefix(s, "__jql:")
			break
		}
	}
	if jql == "" {
		jql = c.jql
	}
	if c.defaultProject == "" {
		return nil, fmt.Errorf("jira: configured default_project is required to keep issue reads within a confirmed project")
	}
	if !ValidProjectKey(c.defaultProject) {
		return nil, fmt.Errorf("jira: configured default_project %q is not a valid project key", c.defaultProject)
	}
	var err error
	jql, err = scopeJQL(c.defaultProject, jql)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("jql", jql)
	q.Set("maxResults", "100")
	q.Set("fields", "summary,description,priority,status,labels,assignee,project,created,updated")
	searchPath := c.apiBase + "/search"
	if c.cloud {
		// Jira Cloud's legacy /search route is being removed; use enhanced JQL search.
		searchPath += "/jql"
	}
	var resp struct {
		Issues []jiraIssue `json:"issues"`
	}
	if err := c.request(ctx, http.MethodGet, searchPath+"?"+q.Encode(), nil, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.WorkItem, 0, len(resp.Issues))
	for _, i := range resp.Issues {
		item := mapIssue(i, c.stateMap, c.baseURL)
		if item.SourceProjectID == "" {
			return nil, fmt.Errorf("jira: issue %s omitted its project identity; refusing to claim project scope", i.Key)
		}
		if !strings.EqualFold(item.SourceProjectID, c.defaultProject) {
			return nil, fmt.Errorf("jira: issue %s belongs to project %s, configured project is %s", i.Key, item.SourceProjectID, c.defaultProject)
		}
		out = append(out, item)
	}
	return out, nil
}

func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	if strings.TrimSpace(c.defaultProject) == "" {
		return nil, fmt.Errorf("jira: configured default_project is required to confirm issue scope")
	}
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return nil, err
	}
	var i jiraIssue
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/issue/"+url.PathEscape(nativeID), nil, &i); err != nil {
		return nil, err
	}
	if i.ID == "" && i.Key == "" {
		return nil, fmt.Errorf("jira: issue %q not found", id)
	}
	item := mapIssue(i, c.stateMap, c.baseURL)
	if item.SourceProjectID != "" && !strings.EqualFold(item.SourceProjectID, c.defaultProject) {
		return nil, fmt.Errorf("jira: issue %s belongs to project %s, configured project is %s", item.Identifier, item.SourceProjectID, c.defaultProject)
	}
	if item.SourceProjectID == "" {
		return nil, fmt.Errorf("jira: issue %s omitted its project identity; refusing to claim project scope", item.Identifier)
	}
	return &item, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	jql := fmt.Sprintf(`text ~ %q ORDER BY updated DESC`, query)
	return c.Fetch(ctx, FilterFromJQL(jql))
}

// toDescription converts a plain text string into the appropriate Jira
// description format. Cloud (api/3) requires Atlassian Document Format (ADF);
// Server (api/2) accepts a plain string.
func (c *Client) toDescription(text string) any {
	if !c.cloud {
		return text
	}
	// Minimal ADF document wrapping the text as a single paragraph.
	content := []map[string]any{}
	if text != "" {
		content = append(content, map[string]any{
			"type": "paragraph",
			"content": []map[string]any{
				{"type": "text", "text": text},
			},
		})
	}
	return map[string]any{
		"version": 1,
		"type":    "doc",
		"content": content,
	}
}

// Create creates a new Jira issue using only the native project configured on
// this connection. Orchestra's local ProjectID is never a Jira project key.
func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	projectKey := c.defaultProject
	if projectKey == "" {
		return nil, fmt.Errorf("jira: cannot Create without a configured Jira project key (extra.default_project)")
	}
	if !ValidProjectKey(projectKey) {
		return nil, fmt.Errorf("jira: configured default_project %q is not a valid project key", projectKey)
	}
	body := map[string]any{
		"fields": map[string]any{
			"project":     map[string]any{"key": projectKey},
			"summary":     item.Title,
			"description": c.toDescription(item.Description),
		},
	}
	var resp struct {
		ID  string `json:"id"`
		Key string `json:"key"`
	}
	if err := c.request(ctx, http.MethodPost, c.apiBase+"/issue", body, &resp); err != nil {
		return nil, err
	}
	if resp.Key == "" {
		return nil, fmt.Errorf("jira: create returned empty key")
	}
	created, err := c.FetchByID(ctx, resp.Key)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(created.SourceProjectID, projectKey) {
		return nil, fmt.Errorf("jira: created issue project scope not confirmed (expected %s, got %s)", projectKey, created.SourceProjectID)
	}
	return created, nil
}

// Update applies updates to the Jira issue.
//
// Recognised update keys:
//   - "title"       -> fields.summary
//   - "description" -> fields.description
//   - "state"       -> POST a transition matching the state name (case-insensitive)
//
// Unknown keys are silently ignored.
func (c *Client) Update(ctx context.Context, id string, updates map[string]any) (*tracker.WorkItem, error) {
	if _, err := c.FetchByID(ctx, id); err != nil {
		return nil, fmt.Errorf("jira: refusing update before selected-project scope is confirmed: %w", err)
	}
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	if v, ok := updates["title"]; ok {
		fields["summary"] = v
	}
	if v, ok := updates["description"]; ok {
		if text, ok := v.(string); ok {
			fields["description"] = c.toDescription(text)
		} else {
			fields["description"] = v
		}
	}
	if v, ok := updates["state"]; ok {
		if name, ok := v.(string); ok && name != "" {
			if err := c.transition(ctx, nativeID, name); err != nil {
				return nil, err
			}
		}
	}
	if len(fields) > 0 {
		if err := c.request(ctx, http.MethodPut, c.apiBase+"/issue/"+url.PathEscape(nativeID),
			map[string]any{"fields": fields}, nil); err != nil {
			return nil, err
		}
	}
	return c.FetchByID(ctx, nativeID)
}

// transition POSTs a workflow transition matching targetState (case-insensitive).
func (c *Client) transition(ctx context.Context, id, targetState string) error {
	var resp struct {
		Transitions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			To   struct {
				Name string `json:"name"`
			} `json:"to"`
		} `json:"transitions"`
	}
	if err := c.request(ctx, http.MethodGet,
		c.apiBase+"/issue/"+url.PathEscape(id)+"/transitions", nil, &resp); err != nil {
		return err
	}
	for _, t := range resp.Transitions {
		if strings.EqualFold(t.Name, targetState) || strings.EqualFold(t.To.Name, targetState) {
			return c.request(ctx, http.MethodPost,
				c.apiBase+"/issue/"+url.PathEscape(id)+"/transitions",
				map[string]any{"transition": map[string]any{"id": t.ID}}, nil)
		}
	}
	return fmt.Errorf("jira: no transition to state %q on issue %s", targetState, id)
}

func (c *Client) Delete(ctx context.Context, id string) error {
	if _, err := c.FetchByID(ctx, id); err != nil {
		return fmt.Errorf("jira: refusing delete before selected-project scope is confirmed: %w", err)
	}
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodDelete, c.apiBase+"/issue/"+url.PathEscape(nativeID), nil, nil)
}

func (c *Client) Comment(ctx context.Context, id, body string) error {
	if _, err := c.FetchByID(ctx, id); err != nil {
		return fmt.Errorf("jira: refusing comment before selected-project scope is confirmed: %w", err)
	}
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodPost,
		c.apiBase+"/issue/"+url.PathEscape(nativeID)+"/comment",
		map[string]any{"body": c.toDescription(body)}, nil)
}

func nativeIssueID(id string) (string, error) {
	if strings.HasPrefix(id, "jira:") {
		id = strings.TrimPrefix(id, "jira:")
	} else if strings.Contains(id, ":") {
		return "", fmt.Errorf("jira: issue ID %q belongs to another source", id)
	}
	if id == "" {
		return "", fmt.Errorf("jira: empty issue ID")
	}
	return id, nil
}

// ValidProjectKey reports whether key can be used safely as an unquoted Jira
// project key in the adapter's server-side JQL scope.
func ValidProjectKey(key string) bool {
	if key == "" || !(key[0] >= 'A' && key[0] <= 'Z' || key[0] >= 'a' && key[0] <= 'z') {
		return false
	}
	for _, r := range key[1:] {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

func scopeJQL(projectKey, query string) (string, error) {
	if !ValidProjectKey(projectKey) {
		return "", fmt.Errorf("jira: configured default_project %q is not a valid project key", projectKey)
	}
	query = strings.TrimSpace(query)
	orderBy := ""
	lower := strings.ToLower(query)
	if strings.HasPrefix(lower, "order by ") {
		orderBy = query
		query = ""
	} else if at := strings.LastIndex(lower, " order by "); at >= 0 {
		orderBy = strings.TrimSpace(query[at:])
		query = strings.TrimSpace(query[:at])
	}
	scope := "project = " + projectKey
	if query != "" {
		scope += " AND (" + query + ")"
	}
	if orderBy == "" {
		orderBy = "ORDER BY created DESC"
	}
	return scope + " " + orderBy, nil
}

func (c *Client) FetchProjects(ctx context.Context) ([]tracker.TrackerProject, error) {
	var projects []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Key  string `json:"key"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/project", nil, &projects); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerProject, 0, len(projects))
	for _, p := range projects {
		out = append(out, tracker.TrackerProject{ID: p.ID, Key: p.Key, Name: p.Name})
	}
	return out, nil
}

func (c *Client) FetchStates(ctx context.Context) ([]tracker.TrackerState, error) {
	var statuses []struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		StatusCategory struct {
			Key string `json:"key"`
		} `json:"statusCategory"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/status", nil, &statuses); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerState, 0, len(statuses))
	for _, s := range statuses {
		t := "todo"
		switch s.StatusCategory.Key {
		case "indeterminate":
			t = "in_progress"
		case "done":
			t = "done"
		}
		out = append(out, tracker.TrackerState{ID: s.ID, Name: s.Name, Type: t})
	}
	return out, nil
}

func (c *Client) Ping(ctx context.Context) error {
	var resp struct {
		AccountID string `json:"accountId"`
		Name      string `json:"name"` // Server/DC fallback
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/myself", nil, &resp); err != nil {
		return err
	}
	if resp.AccountID == "" && resp.Name == "" {
		return fmt.Errorf("jira: /myself returned empty identity — invalid credentials")
	}
	return nil
}
