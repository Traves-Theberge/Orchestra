// Package linear provides a Linear GraphQL-backed implementation of tracker.Adapter.
package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// Compile-time check that *Client implements tracker.Adapter.
var _ tracker.Adapter = (*Client)(nil)

const defaultEndpoint = "https://api.linear.app/graphql"

// Client implements tracker.Adapter against the Linear GraphQL API.
type Client struct {
	teamKey    string
	token      string
	httpClient *http.Client
	endpoint   string
	stateMap   map[string]string // user-supplied; nil falls back to defaultStateMap
}

// NewClient creates a Linear adapter.
// Pass an empty endpoint to use the default Linear API URL.
// Pass nil httpClient to use http.DefaultClient.
// Pass nil stateMap to use the default state mapping.
func NewClient(teamKey, token string, httpClient *http.Client, endpoint string, stateMap map[string]string) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	ep := defaultEndpoint
	if endpoint != "" {
		ep = endpoint
	}
	return &Client{teamKey: teamKey, token: token, httpClient: httpClient, endpoint: ep, stateMap: stateMap}
}

// graphql executes a GraphQL request and decodes the response into out.
// Returns an error on non-2xx HTTP status or when the response carries a
// GraphQL `errors` array (HTTP 200 with errors). The first error message is
// surfaced so callers can debug Linear API issues without losing context.
func (c *Client) graphql(ctx context.Context, query string, variables map[string]any, out any) error {
	body := map[string]any{"query": query, "variables": variables}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("linear: status %d", resp.StatusCode)
	}

	// Decode into a buffer so we can both check `errors` and decode `data`.
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("linear: read body: %w", err)
	}

	var envelope struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("linear: decode envelope: %w", err)
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("linear: graphql error: %s", envelope.Errors[0].Message)
	}

	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func (c *Client) Fetch(ctx context.Context, _ tracker.Filter) ([]tracker.WorkItem, error) {
	const q = `query($teamKey: String!) {
		issues(filter: { team: { key: { eq: $teamKey } } }, first: 100) {
			nodes {
				id identifier title description priority url createdAt updatedAt
				state { type name }
				team { id key }
				labels { nodes { name } }
				assignee { id }
			}
		}
	}`
	var resp struct {
		Data struct {
			Issues struct {
				Nodes []linearIssueNode `json:"nodes"`
			} `json:"issues"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey}, &resp); err != nil {
		return nil, err
	}
	items := make([]tracker.WorkItem, 0, len(resp.Data.Issues.Nodes))
	for _, n := range resp.Data.Issues.Nodes {
		item, err := c.scopedItem(n)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return nil, err
	}
	const q = `query($id: String!) {
		issue(id: $id) {
			id identifier title description priority url createdAt updatedAt
			state { type name }
			team { id key }
			labels { nodes { name } }
			assignee { id }
		}
	}`
	var resp struct {
		Data struct {
			Issue linearIssueNode `json:"issue"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": nativeID}, &resp); err != nil {
		return nil, err
	}
	if resp.Data.Issue.ID == "" {
		return nil, fmt.Errorf("linear: issue %q not found", id)
	}
	item, err := c.scopedItem(resp.Data.Issue)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	const q = `query($teamKey: String!, $query: String!) {
		issues(filter: { team: { key: { eq: $teamKey } }, title: { containsIgnoreCase: $query } }, first: 50) {
			nodes {
				id identifier title description priority url createdAt updatedAt
				state { type name }
				team { id key }
				labels { nodes { name } }
				assignee { id }
			}
		}
	}`
	var resp struct {
		Data struct {
			Issues struct {
				Nodes []linearIssueNode `json:"nodes"`
			} `json:"issues"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey, "query": query}, &resp); err != nil {
		return nil, err
	}
	items := make([]tracker.WorkItem, 0, len(resp.Data.Issues.Nodes))
	for _, n := range resp.Data.Issues.Nodes {
		item, err := c.scopedItem(n)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// Create creates a new Linear issue.
func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	teamID, err := c.resolveTeamID(ctx)
	if err != nil {
		return nil, err
	}
	const q = `mutation($title: String!, $description: String, $teamId: String!, $stateId: String, $assigneeId: String, $priority: Int) {
		issueCreate(input: { title: $title, description: $description, teamId: $teamId, stateId: $stateId, assigneeId: $assigneeId, priority: $priority }) {
			issue {
				id identifier title description priority url createdAt updatedAt
				state { type name }
				team { id key }
				labels { nodes { name } }
				assignee { id }
			}
		}
	}`
	var resp struct {
		Data struct {
			IssueCreate struct {
				Issue linearIssueNode `json:"issue"`
			} `json:"issueCreate"`
		} `json:"data"`
	}
	variables := map[string]any{
		"title":       item.Title,
		"description": item.Description,
		"teamId":      teamID,
		"stateId":     nil,
		"assigneeId":  nil,
		"priority":    nil,
	}
	if item.AssigneeID != "" {
		variables["assigneeId"] = item.AssigneeID
	}
	if item.State != "" {
		states, err := c.FetchStates(ctx)
		if err != nil {
			return nil, err
		}
		for _, state := range states {
			if strings.EqualFold(state.Name, item.State) {
				variables["stateId"] = state.ID
				break
			}
		}
		if variables["stateId"] == nil {
			return nil, fmt.Errorf("linear: workflow state %q not found for team %s", item.State, c.teamKey)
		}
	}
	if item.Priority > 0 {
		variables["priority"] = item.Priority
	}
	if err := c.graphql(ctx, q, variables, &resp); err != nil {
		return nil, err
	}
	created, err := c.scopedItem(resp.Data.IssueCreate.Issue)
	if err != nil {
		return nil, fmt.Errorf("linear: create result scope not confirmed: %w", err)
	}
	return &created, nil
}

// Update applies the given updates to the Linear issue.
//
// IMPORTANT: updates["state"] must be a Linear state UUID, not a state name.
// Resolve names to UUIDs via FetchStates before calling Update. The caller
// (registry adapterClient or API handler) is responsible for the translation.
//
// Recognised update keys: "state" (UUID string), "assignee_id", "priority",
// "title", "description". Unknown keys are silently ignored.
func (c *Client) Update(ctx context.Context, id string, updates map[string]any) (*tracker.WorkItem, error) {
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return nil, err
	}
	if _, err := c.FetchByID(ctx, nativeID); err != nil {
		return nil, fmt.Errorf("linear: refusing update before selected-team scope is confirmed: %w", err)
	}
	const q = `mutation($id: String!, $input: IssueUpdateInput!) {
		issueUpdate(id: $id, input: $input) {
			issue {
				id identifier title description priority url createdAt updatedAt
				state { type name }
				team { id key }
				labels { nodes { name } }
				assignee { id }
			}
		}
	}`
	input := map[string]any{}
	if v, ok := updates["state"]; ok {
		input["stateId"] = v
	}
	if v, ok := updates["assignee_id"]; ok {
		input["assigneeId"] = v
	}
	if v, ok := updates["priority"]; ok {
		input["priority"] = v
	}
	if v, ok := updates["title"]; ok {
		input["title"] = v
	}
	if v, ok := updates["description"]; ok {
		input["description"] = v
	}
	var resp struct {
		Data struct {
			IssueUpdate struct {
				Issue linearIssueNode `json:"issue"`
			} `json:"issueUpdate"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": nativeID, "input": input}, &resp); err != nil {
		return nil, err
	}
	updated, err := c.scopedItem(resp.Data.IssueUpdate.Issue)
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func (c *Client) Delete(ctx context.Context, id string) error {
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return err
	}
	if _, err := c.FetchByID(ctx, nativeID); err != nil {
		return fmt.Errorf("linear: refusing delete before selected-team scope is confirmed: %w", err)
	}
	const q = `mutation($id: String!) { issueDelete(id: $id) { success } }`
	return c.graphql(ctx, q, map[string]any{"id": nativeID}, nil)
}

func (c *Client) Comment(ctx context.Context, id, body string) error {
	nativeID, err := nativeIssueID(id)
	if err != nil {
		return err
	}
	if _, err := c.FetchByID(ctx, nativeID); err != nil {
		return fmt.Errorf("linear: refusing comment before selected-team scope is confirmed: %w", err)
	}
	const q = `mutation($issueId: String!, $body: String!) {
		commentCreate(input: { issueId: $issueId, body: $body }) { comment { id } }
	}`
	return c.graphql(ctx, q, map[string]any{"issueId": nativeID, "body": body}, nil)
}

func nativeIssueID(id string) (string, error) {
	if strings.HasPrefix(id, "linear:") {
		id = strings.TrimPrefix(id, "linear:")
	} else if strings.Contains(id, ":") {
		return "", fmt.Errorf("linear: issue ID %q belongs to another source", id)
	}
	if id == "" {
		return "", fmt.Errorf("linear: empty issue ID")
	}
	return id, nil
}

func (c *Client) scopedItem(n linearIssueNode) (tracker.WorkItem, error) {
	if c.teamKey == "" {
		return tracker.WorkItem{}, fmt.Errorf("linear: configured team key is required to confirm issue scope")
	}
	if n.Team.Key == "" {
		return tracker.WorkItem{}, fmt.Errorf("linear: issue %s omitted its team identity; refusing to claim configured team scope", n.Identifier)
	}
	if !strings.EqualFold(n.Team.Key, c.teamKey) {
		return tracker.WorkItem{}, fmt.Errorf("linear: issue %s belongs to team %s, configured team is %s", n.Identifier, n.Team.Key, c.teamKey)
	}
	item := mapNode(n, c.stateMap)
	item.SourceProjectID = n.Team.Key
	return item, nil
}

func (c *Client) resolveTeamID(ctx context.Context) (string, error) {
	if strings.TrimSpace(c.teamKey) == "" {
		return "", fmt.Errorf("linear: configured team key is required for issue creation")
	}
	const q = `query($teamKey: String!) { teams(filter: { key: { eq: $teamKey } }) { nodes { id key } } }`
	var resp struct {
		Data struct {
			Teams struct {
				Nodes []struct {
					ID  string `json:"id"`
					Key string `json:"key"`
				} `json:"nodes"`
			} `json:"teams"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey}, &resp); err != nil {
		return "", err
	}
	if len(resp.Data.Teams.Nodes) != 1 || resp.Data.Teams.Nodes[0].ID == "" || !strings.EqualFold(resp.Data.Teams.Nodes[0].Key, c.teamKey) {
		return "", fmt.Errorf("linear: configured team key %q did not resolve to exactly one team", c.teamKey)
	}
	return resp.Data.Teams.Nodes[0].ID, nil
}

func (c *Client) FetchProjects(ctx context.Context) ([]tracker.TrackerProject, error) {
	const q = `{ teams { nodes { id key name } } }`
	var resp struct {
		Data struct {
			Teams struct {
				Nodes []struct {
					ID   string `json:"id"`
					Key  string `json:"key"`
					Name string `json:"name"`
				} `json:"nodes"`
			} `json:"teams"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, nil, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerProject, 0, len(resp.Data.Teams.Nodes))
	for _, n := range resp.Data.Teams.Nodes {
		out = append(out, tracker.TrackerProject{ID: n.ID, Key: n.Key, Name: n.Name})
	}
	return out, nil
}

func (c *Client) FetchStates(ctx context.Context) ([]tracker.TrackerState, error) {
	const q = `query($teamKey: String!) {
		workflowStates(filter: { team: { key: { eq: $teamKey } } }) {
			nodes { id name type }
		}
	}`
	var resp struct {
		Data struct {
			WorkflowStates struct {
				Nodes []struct {
					ID   string `json:"id"`
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"nodes"`
			} `json:"workflowStates"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey}, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerState, 0, len(resp.Data.WorkflowStates.Nodes))
	for _, n := range resp.Data.WorkflowStates.Nodes {
		out = append(out, tracker.TrackerState{ID: n.ID, Name: n.Name, Type: n.Type})
	}
	return out, nil
}

func (c *Client) Ping(ctx context.Context) error {
	const q = `{ viewer { id email } }`
	var resp struct {
		Data struct {
			Viewer struct {
				ID string `json:"id"`
			} `json:"viewer"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, nil, &resp); err != nil {
		return err
	}
	if resp.Data.Viewer.ID == "" {
		return fmt.Errorf("linear: viewer ID empty — invalid token")
	}
	return nil
}
