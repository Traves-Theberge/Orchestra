package graphql

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type Client struct {
	endpoint          string
	token             string
	project           string
	workerAssigneeIDs map[string]struct{}
	http              *http.Client
	mu                sync.RWMutex
	viewerResolved    bool
	viewerID          string
}

func NewClient(endpoint string, token string, project string, workerAssigneeIDs []string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	assigneeSet := map[string]struct{}{}
	for _, id := range workerAssigneeIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			assigneeSet[trimmed] = struct{}{}
		}
	}
	return &Client{endpoint: strings.TrimSpace(endpoint), token: strings.TrimSpace(token), project: strings.TrimSpace(project), workerAssigneeIDs: assigneeSet, http: httpClient}
}

func (c *Client) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	if len(activeStates) == 0 {
		return []tracker.Issue{}, nil
	}

	workerSet, err := c.effectiveWorkerAssigneeSet(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]tracker.Issue, 0)
	seen := map[string]struct{}{}
	var after string
	query := candidateQuery
	if c.project != "" {
		query = candidateQueryWithProject
	}
	for {
		variables := map[string]any{"states": activeStates, "first": 100}
		if strings.TrimSpace(after) != "" {
			variables["after"] = after
		}
		if c.project != "" {
			variables["projectSlug"] = c.project
		}

		issues, page, err := c.fetchIssuePage(ctx, query, variables, workerSet)
		if err != nil {
			return nil, err
		}
		out = appendUniqueIssues(out, issues, seen)
		if !page.HasNextPage {
			break
		}
		next, err := nextPageCursor(page)
		if err != nil {
			return nil, err
		}
		after = next
	}

	sortIssues(out)
	return out, nil
}

func (c *Client) FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error) {
	result := map[string]string{}
	if len(issueIDs) == 0 {
		return result, nil
	}

	for _, chunk := range chunkStrings(issueIDs, 50) {
		var after string
		for {
			variables := map[string]any{"ids": chunk, "first": len(chunk)}
			if strings.TrimSpace(after) != "" {
				variables["after"] = after
			}
			issues, page, err := c.fetchIssuePage(ctx, byIDsQuery, variables, nil)
			if err != nil {
				return nil, err
			}
			for _, issue := range issues {
				result[issue.ID] = issue.State
			}
			if !page.HasNextPage {
				break
			}
			next, err := nextPageCursor(page)
			if err != nil {
				return nil, err
			}
			after = next
		}
	}

	return result, nil
}

func (c *Client) FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]tracker.Issue, error) {
	out := make([]tracker.Issue, 0)
	seen := map[string]struct{}{}
	if len(issueIDs) == 0 {
		return out, nil
	}

	for _, chunk := range chunkStrings(issueIDs, 50) {
		var after string
		for {
			variables := map[string]any{"ids": chunk, "first": len(chunk)}
			if strings.TrimSpace(after) != "" {
				variables["after"] = after
			}
			issues, page, err := c.fetchIssuePage(ctx, byIDsQuery, variables, nil)
			if err != nil {
				return nil, err
			}
			out = appendUniqueIssues(out, issues, seen)
			if !page.HasNextPage {
				break
			}
			next, err := nextPageCursor(page)
			if err != nil {
				return nil, err
			}
			after = next
		}
	}

	order := issueIDOrder(issueIDs)
	sortIssuesByInputOrder(out, order)
	return out, nil
}

func (c *Client) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	out := make([]tracker.Issue, 0)
	seen := map[string]struct{}{}
	if len(states) == 0 {
		return out, nil
	}

	var after string
	for {
		variables := map[string]any{"states": states, "first": 100}
		if strings.TrimSpace(after) != "" {
			variables["after"] = after
		}
		issues, page, err := c.fetchIssuePage(ctx, byStatesQuery, variables, nil)
		if err != nil {
			return nil, err
		}
		out = appendUniqueIssues(out, issues, seen)
		if !page.HasNextPage {
			break
		}
		next, err := nextPageCursor(page)
		if err != nil {
			return nil, err
		}
		after = next
	}

	sortIssues(out)
	return out, nil
}

type pageInfo struct {
	HasNextPage bool
	EndCursor   string
}

func (c *Client) fetchIssuePage(ctx context.Context, query string, variables map[string]any, workerAssigneeSet map[string]struct{}) ([]tracker.Issue, pageInfo, error) {
	if c.endpoint == "" {
		return nil, pageInfo{}, fmt.Errorf("tracker endpoint is empty")
	}

	payload := map[string]any{"query": query, "variables": variables}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, pageInfo{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, pageInfo{}, fmt.Errorf("graphql request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		detail := strings.TrimSpace(string(raw))
		if detail != "" {
			return nil, pageInfo{}, fmt.Errorf("graphql request returned status %d: %s", resp.StatusCode, detail)
		}
		return nil, pageInfo{}, fmt.Errorf("graphql request returned status %d", resp.StatusCode)
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, pageInfo{}, fmt.Errorf("read response body: %w", err)
	}

	decoded := map[string]any{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, pageInfo{}, fmt.Errorf("decode response json: %w", err)
	}

	if errorsAny, ok := decoded["errors"].([]any); ok && len(errorsAny) > 0 {
		message := "graphql returned errors"
		if firstError, ok := errorsAny[0].(map[string]any); ok {
			if msg := stringValue(firstError["message"]); msg != "" {
				message = fmt.Sprintf("graphql returned errors: %s", msg)
			}
		}
		return nil, pageInfo{}, fmt.Errorf("%s", message)
	}

	data, ok := decoded["data"].(map[string]any)
	if !ok {
		return nil, pageInfo{}, fmt.Errorf("graphql response missing data")
	}
	issuesObj, ok := data["issues"].(map[string]any)
	if !ok {
		return nil, pageInfo{}, fmt.Errorf("graphql response missing issues")
	}
	nodesAny, _ := issuesObj["nodes"].([]any)
	page := pageInfo{}
	if pageAny, ok := issuesObj["pageInfo"].(map[string]any); ok {
		if has, okHas := pageAny["hasNextPage"].(bool); okHas {
			page.HasNextPage = has
		}
		if end, okEnd := pageAny["endCursor"].(string); okEnd {
			page.EndCursor = end
		}
	}

	issues := make([]tracker.Issue, 0, len(nodesAny))
	for _, nodeAny := range nodesAny {
		node, _ := nodeAny.(map[string]any)
		stateObj, _ := node["state"].(map[string]any)
		stateName, _ := stateObj["name"].(string)
		assigneeObj, _ := node["assignee"].(map[string]any)
		assigneeID := ""
		if assigneeObj != nil {
			assigneeID = stringValue(assigneeObj["id"])
		}
		blockers := extractBlockers(node)
		issue := tracker.Issue{
			ID:               stringValue(node["id"]),
			Identifier:       stringValue(node["identifier"]),
			Title:            stringValue(node["title"]),
			Description:      stringValue(node["description"]),
			Priority:         int(firstInt64(node["priority"])),
			State:            strings.TrimSpace(stateName),
			BranchName:       stringValue(node["branchName"]),
			URL:              stringValue(node["url"]),
			AssigneeID:       assigneeID,
			AssignedToWorker: isAssignedToWorker(assigneeID, workerAssigneeSet),
			Labels:           extractLabelNames(node),
			BlockedBy:        blockers,
			CreatedAt:        stringValue(node["createdAt"]),
			UpdatedAt:        stringValue(node["updatedAt"]),
		}
		if issue.ID != "" {
			issues = append(issues, issue)
		}
	}

	return issues, page, nil
}

func isAssignedToWorker(assigneeID string, workerAssigneeSet map[string]struct{}) bool {
	if len(workerAssigneeSet) == 0 {
		return true
	}
	_, ok := workerAssigneeSet[strings.TrimSpace(assigneeID)]
	return ok
}

func (c *Client) effectiveWorkerAssigneeSet(ctx context.Context) (map[string]struct{}, error) {
	if len(c.workerAssigneeIDs) == 0 {
		return nil, nil
	}

	set := map[string]struct{}{}
	needsViewer := false
	for id := range c.workerAssigneeIDs {
		if strings.EqualFold(strings.TrimSpace(id), "me") {
			needsViewer = true
			continue
		}
		set[id] = struct{}{}
	}

	if !needsViewer {
		return set, nil
	}

	viewerID, err := c.resolveViewerID(ctx)
	if err != nil {
		return nil, err
	}
	set[viewerID] = struct{}{}
	return set, nil
}

func (c *Client) resolveViewerID(ctx context.Context) (string, error) {
	c.mu.RLock()
	if c.viewerResolved && strings.TrimSpace(c.viewerID) != "" {
		id := c.viewerID
		c.mu.RUnlock()
		return id, nil
	}
	c.mu.RUnlock()

	decoded, err := c.executeGraphQL(ctx, viewerQuery, map[string]any{})
	if err != nil {
		return "", err
	}
	data, _ := decoded["data"].(map[string]any)
	viewer, _ := data["viewer"].(map[string]any)
	viewerID := stringValue(viewer["id"])
	if viewerID == "" {
		return "", fmt.Errorf("missing linear viewer identity")
	}

	c.mu.Lock()
	c.viewerResolved = true
	c.viewerID = viewerID
	c.mu.Unlock()

	return viewerID, nil
}

func (c *Client) executeGraphQL(ctx context.Context, query string, variables map[string]any) (map[string]any, error) {
	payload := map[string]any{"query": query, "variables": variables}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graphql request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		detail := strings.TrimSpace(string(raw))
		if detail != "" {
			return nil, fmt.Errorf("graphql request returned status %d: %s", resp.StatusCode, detail)
		}
		return nil, fmt.Errorf("graphql request returned status %d", resp.StatusCode)
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	decoded := map[string]any{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decode response json: %w", err)
	}

	if errorsAny, ok := decoded["errors"].([]any); ok && len(errorsAny) > 0 {
		message := "graphql returned errors"
		if firstError, ok := errorsAny[0].(map[string]any); ok {
			if msg := stringValue(firstError["message"]); msg != "" {
				message = fmt.Sprintf("graphql returned errors: %s", msg)
			}
		}
		return nil, fmt.Errorf("%s", message)
	}

	return decoded, nil
}

func stringValue(value any) string {
	s, _ := value.(string)
	return strings.TrimSpace(s)
}

func firstInt64(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func chunkStrings(values []string, size int) [][]string {
	if size <= 0 {
		size = 50
	}
	chunks := make([][]string, 0, (len(values)+size-1)/size)
	for start := 0; start < len(values); start += size {
		end := start + size
		if end > len(values) {
			end = len(values)
		}
		chunks = append(chunks, values[start:end])
	}
	return chunks
}

func appendUniqueIssues(out []tracker.Issue, issues []tracker.Issue, seen map[string]struct{}) []tracker.Issue {
	if len(issues) == 0 {
		return out
	}
	for _, issue := range issues {
		if issue.ID == "" {
			continue
		}
		if _, ok := seen[issue.ID]; ok {
			continue
		}
		seen[issue.ID] = struct{}{}
		out = append(out, issue)
	}
	return out
}

func sortIssues(issues []tracker.Issue) {
	sort.SliceStable(issues, func(i int, j int) bool {
		left := strings.TrimSpace(issues[i].Identifier)
		right := strings.TrimSpace(issues[j].Identifier)
		if left == right {
			return issues[i].ID < issues[j].ID
		}
		return left < right
	})
}

func issueIDOrder(ids []string) map[string]int {
	order := make(map[string]int, len(ids))
	for idx, id := range ids {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if _, exists := order[trimmed]; exists {
			continue
		}
		order[trimmed] = idx
	}
	return order
}

func sortIssuesByInputOrder(issues []tracker.Issue, order map[string]int) {
	sort.SliceStable(issues, func(i int, j int) bool {
		leftOrder, leftOK := order[issues[i].ID]
		rightOrder, rightOK := order[issues[j].ID]
		if leftOK && rightOK && leftOrder != rightOrder {
			return leftOrder < rightOrder
		}
		if leftOK != rightOK {
			return leftOK
		}
		leftIdentifier := strings.TrimSpace(issues[i].Identifier)
		rightIdentifier := strings.TrimSpace(issues[j].Identifier)
		if leftIdentifier == rightIdentifier {
			return issues[i].ID < issues[j].ID
		}
		return leftIdentifier < rightIdentifier
	})
}

func nextPageCursor(page pageInfo) (string, error) {
	if !page.HasNextPage {
		return "", nil
	}
	cursor := strings.TrimSpace(page.EndCursor)
	if cursor == "" {
		return "", fmt.Errorf("graphql response missing end cursor for next page")
	}
	return cursor, nil
}

func extractLabelNames(node map[string]any) []string {
	labelsObj, ok := node["labels"].(map[string]any)
	if !ok {
		return nil
	}
	nodesAny, ok := labelsObj["nodes"].([]any)
	if !ok || len(nodesAny) == 0 {
		return nil
	}
	labels := make([]string, 0, len(nodesAny))
	for _, raw := range nodesAny {
		labelNode, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := stringValue(labelNode["name"])
		if name != "" {
			labels = append(labels, strings.ToLower(name))
		}
	}
	if len(labels) == 0 {
		return nil
	}
	return labels
}

func extractBlockers(node map[string]any) []tracker.Blocker {
	relationsObj, ok := node["inverseRelations"].(map[string]any)
	if !ok {
		return nil
	}
	nodesAny, ok := relationsObj["nodes"].([]any)
	if !ok || len(nodesAny) == 0 {
		return nil
	}
	blockers := make([]tracker.Blocker, 0, len(nodesAny))
	for _, relAny := range nodesAny {
		rel, ok := relAny.(map[string]any)
		if !ok {
			continue
		}
		relType := strings.ToLower(strings.TrimSpace(stringValue(rel["type"])))
		if relType != "blocks" {
			continue
		}
		issueObj, ok := rel["issue"].(map[string]any)
		if !ok {
			continue
		}
		id := stringValue(issueObj["id"])
		if id == "" {
			continue
		}
		stateObj, _ := issueObj["state"].(map[string]any)
		blockers = append(blockers, tracker.Blocker{ID: id, Identifier: stringValue(issueObj["identifier"]), State: stringValue(stateObj["name"])})
	}
	if len(blockers) == 0 {
		return nil
	}
	return blockers
}

const (
	candidateQuery            = `query CandidateIssues($states: [String!], $first: Int, $after: String) { issues(states: $states, first: $first, after: $after) { nodes { id identifier title description priority state { name } branchName url assignee { id } labels { nodes { name } } inverseRelations(first: 10) { nodes { type issue { id identifier state { name } } } } createdAt updatedAt } pageInfo { hasNextPage endCursor } } }`
	candidateQueryWithProject = `query CandidateIssues($states: [String!], $first: Int, $after: String, $projectSlug: String) { issues(states: $states, first: $first, after: $after, filter: {project: {slugId: {eq: $projectSlug}}}) { nodes { id identifier title description priority state { name } branchName url assignee { id } labels { nodes { name } } inverseRelations(first: 10) { nodes { type issue { id identifier state { name } } } } createdAt updatedAt } pageInfo { hasNextPage endCursor } } } }`
	byIDsQuery                = `query IssuesByIDs($ids: [ID!], $first: Int, $after: String) { issues(ids: $ids, first: $first, after: $after) { nodes { id identifier title description priority state { name } branchName url assignee { id } labels { nodes { name } } inverseRelations(first: 10) { nodes { type issue { id identifier state { name } } } } createdAt updatedAt } pageInfo { hasNextPage endCursor } } }`
	byStatesQuery             = `query IssuesByStates($states: [String!], $first: Int, $after: String) { issues(states: $states, first: $first, after: $after) { nodes { id identifier title description priority state { name } branchName url assignee { id } labels { nodes { name } } inverseRelations(first: 10) { nodes { type issue { id identifier state { name } } } } createdAt updatedAt } pageInfo { hasNextPage endCursor } } }`
	viewerQuery               = `query OrchestraViewer { viewer { id } }`
)
