package linear

import "github.com/orchestra/orchestra/apps/backend/internal/tracker"

// defaultStateMap maps Linear state types to Orchestra states.
// User-overridable via the per-config extra.state_map field.
var defaultStateMap = map[string]string{
	"backlog":   "Backlog",
	"unstarted": "Todo",
	"started":   "In Progress",
	"completed": "Done",
	"cancelled": "Cancelled",
}

// linearIssueNode is the GraphQL response shape for a single issue node.
type linearIssueNode struct {
	ID          string `json:"id"`
	Identifier  string `json:"identifier"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Priority    int    `json:"priority"`
	URL         string `json:"url"`
	State       struct {
		Type string `json:"type"`
		Name string `json:"name"`
	} `json:"state"`
	Labels struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
	Assignee *struct {
		ID string `json:"id"`
	} `json:"assignee"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// mapNode converts a Linear GraphQL issue node into a tracker.WorkItem.
// stateMap may be nil — the default mapping is applied in that case.
func mapNode(n linearIssueNode, stateMap map[string]string) tracker.WorkItem {
	usingDefault := stateMap == nil
	sm := stateMap
	if sm == nil {
		sm = defaultStateMap
	}
	state := n.State.Name
	if mapped, ok := sm[n.State.Type]; ok {
		state = mapped
	} else if !usingDefault {
		// Custom map doesn't cover this state type — fall back to the default mapping.
		if mapped, ok := defaultStateMap[n.State.Type]; ok {
			state = mapped
		}
	}
	labels := make([]string, 0, len(n.Labels.Nodes))
	for _, l := range n.Labels.Nodes {
		labels = append(labels, l.Name)
	}
	assigneeID := ""
	if n.Assignee != nil {
		assigneeID = n.Assignee.ID
	}
	return tracker.WorkItem{
		ID:          "linear:" + n.ID,
		Identifier:  n.Identifier,
		Source:      "linear",
		Title:       n.Title,
		Description: n.Description,
		Priority:    n.Priority,
		State:       state,
		URL:         n.URL,
		Labels:      labels,
		AssigneeID:  assigneeID,
		CreatedAt:   n.CreatedAt,
		UpdatedAt:   n.UpdatedAt,
	}
}
