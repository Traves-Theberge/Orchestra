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
	user           string // email (Cloud) or username (Server). Empty for Cloud Bearer auth.
	token          string // API token (Cloud Bearer) or PAT (Server Basic password)
	httpClient     *http.Client
	stateMap       map[string]string
	jql            string
	cloud          bool
	defaultProject string // default project key used by Create when WorkItem.ProjectID is empty
}

// NewClient creates a Jira adapter.
// Cloud is detected by ".atlassian.net" in baseURL; Cloud uses Bearer token auth.
// Server uses Basic auth (user + token).
// Pass nil httpClient for http.DefaultClient.
// Pass empty user for Cloud (Bearer-only mode).
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
	if c.cloud {
		// Cloud: Bearer auth (or Basic with email + API token — both work).
		// We use Bearer for simplicity and to keep the token out of req.URL.User.
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
	jql := c.jql
	for _, s := range filter.States {
		if strings.HasPrefix(s, "__jql:") {
			jql = strings.TrimPrefix(s, "__jql:")
			break
		}
	}
	if jql == "" {
		jql = "ORDER BY created DESC"
	}
	q := url.Values{}
	q.Set("jql", jql)
	q.Set("maxResults", "100")
	q.Set("fields", "summary,description,priority,status,labels,assignee,created,updated")
	var resp struct {
		Issues []jiraIssue `json:"issues"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/search?"+q.Encode(), nil, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.WorkItem, 0, len(resp.Issues))
	for _, i := range resp.Issues {
		out = append(out, mapIssue(i, c.stateMap, c.baseURL))
	}
	return out, nil
}

func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	var i jiraIssue
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/issue/"+url.PathEscape(id), nil, &i); err != nil {
		return nil, err
	}
	if i.ID == "" && i.Key == "" {
		return nil, fmt.Errorf("jira: issue %q not found", id)
	}
	item := mapIssue(i, c.stateMap, c.baseURL)
	return &item, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	jql := fmt.Sprintf(`text ~ %q ORDER BY updated DESC`, query)
	return c.Fetch(ctx, FilterFromJQL(jql))
}

// Create creates a new Jira issue. Jira REST requires fields.project.key on
// every issueCreate call; the project key is taken from item.ProjectID if set,
// otherwise from c.defaultProject. If neither is set, returns an error rather
// than silently 400-ing on the server side.
//
// NOTE: Cloud (v3) expects description as an Atlassian Document Format (ADF)
// object. This adapter currently sends a plain string, which Cloud may reject
// or store empty. Server (v2) accepts the plain string. ADF support is a
// follow-up.
func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	projectKey := item.ProjectID
	if projectKey == "" {
		projectKey = c.defaultProject
	}
	if projectKey == "" {
		return nil, fmt.Errorf("jira: cannot Create without a project key (set WorkItem.ProjectID or call SetDefaultProject)")
	}
	body := map[string]any{
		"fields": map[string]any{
			"project":     map[string]any{"key": projectKey},
			"summary":     item.Title,
			"description": item.Description,
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
	return c.FetchByID(ctx, resp.Key)
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
	fields := map[string]any{}
	if v, ok := updates["title"]; ok {
		fields["summary"] = v
	}
	if v, ok := updates["description"]; ok {
		fields["description"] = v
	}
	if v, ok := updates["state"]; ok {
		if name, ok := v.(string); ok && name != "" {
			if err := c.transition(ctx, id, name); err != nil {
				return nil, err
			}
		}
	}
	if len(fields) > 0 {
		if err := c.request(ctx, http.MethodPut, c.apiBase+"/issue/"+url.PathEscape(id),
			map[string]any{"fields": fields}, nil); err != nil {
			return nil, err
		}
	}
	return c.FetchByID(ctx, id)
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
	return c.request(ctx, http.MethodDelete, c.apiBase+"/issue/"+url.PathEscape(id), nil, nil)
}

func (c *Client) Comment(ctx context.Context, id, body string) error {
	return c.request(ctx, http.MethodPost,
		c.apiBase+"/issue/"+url.PathEscape(id)+"/comment",
		map[string]any{"body": body}, nil)
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
		// Use Key (e.g. "PROJ") as the ID since JQL queries reference projects by key.
		out = append(out, tracker.TrackerProject{ID: p.Key, Name: p.Name})
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
