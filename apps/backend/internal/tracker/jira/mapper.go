package jira

import "github.com/orchestra/orchestra/apps/backend/internal/tracker"

// jiraIssue is the REST response shape for a single issue.
// Field types match both v2 (description as string) and v3 (description as ADF object).
type jiraIssue struct {
	ID     string `json:"id"`
	Key    string `json:"key"`
	Fields struct {
		Summary     string `json:"summary"`
		Description any    `json:"description"`
		Priority    *struct {
			Name string `json:"name"`
		} `json:"priority"`
		Status struct {
			Name string `json:"name"`
		} `json:"status"`
		Labels   []string `json:"labels"`
		Assignee *struct {
			AccountID string `json:"accountId"`
		} `json:"assignee"`
		Created string `json:"created"`
		Updated string `json:"updated"`
	} `json:"fields"`
}

// priorityToInt maps Jira priority names to Orchestra priority integers (1=Urgent..4=Low).
func priorityToInt(name string) int {
	switch name {
	case "Highest", "Critical":
		return 1
	case "High":
		return 2
	case "Medium":
		return 3
	case "Low", "Lowest":
		return 4
	}
	return 0
}

// mapIssue converts a Jira REST issue into a tracker.WorkItem.
// stateMap is user-supplied; missing entries fall through to the raw Jira state name.
// baseURL is used to construct the canonical browse URL.
func mapIssue(i jiraIssue, stateMap map[string]string, baseURL string) tracker.WorkItem {
	state := i.Fields.Status.Name
	if mapped, ok := stateMap[state]; ok {
		state = mapped
	}
	priority := 0
	if i.Fields.Priority != nil {
		priority = priorityToInt(i.Fields.Priority.Name)
	}
	assigneeID := ""
	if i.Fields.Assignee != nil {
		assigneeID = i.Fields.Assignee.AccountID
	}
	desc := ""
	if s, ok := i.Fields.Description.(string); ok {
		desc = s
	}
	labels := i.Fields.Labels
	if labels == nil {
		labels = []string{}
	}
	return tracker.WorkItem{
		ID:          "jira:" + i.ID,
		Identifier:  i.Key,
		Source:      "jira",
		Title:       i.Fields.Summary,
		Description: desc,
		Priority:    priority,
		State:       state,
		URL:         baseURL + "/browse/" + i.Key,
		Labels:      labels,
		AssigneeID:  assigneeID,
		CreatedAt:   i.Fields.Created,
		UpdatedAt:   i.Fields.Updated,
	}
}
