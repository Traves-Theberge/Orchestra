package memory

import (
	"context"
	"strconv"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

func TestFetchCandidateIssuesFiltersByActiveState(t *testing.T) {
	client := NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo"},
		{ID: "2", Identifier: "ORC-2", State: "Done"},
	})

	issues, err := client.FetchCandidateIssues(context.Background(), []string{"todo", "in progress"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 1 || issues[0].ID != "1" {
		t.Fatalf("unexpected candidate result: %+v", issues)
	}
}

func TestFetchIssueStatesByIDs(t *testing.T) {
	client := NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}})

	states, err := client.FetchIssueStatesByIDs(context.Background(), []string{"1", "missing"})
	if err != nil {
		t.Fatalf("fetch states: %v", err)
	}
	if states["1"] != "In Progress" {
		t.Fatalf("expected state In Progress, got %q", states["1"])
	}
	if _, ok := states["missing"]; ok {
		t.Fatalf("did not expect missing issue to be returned")
	}
}

func TestFetchIssuesByIDs(t *testing.T) {
	client := NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo"}, {ID: "2", Identifier: "ORC-2", State: "Done"}})

	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"2", "missing", "1"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %+v", issues)
	}
	if issues[0].ID != "2" || issues[1].ID != "1" {
		t.Fatalf("expected ids in request order, got %+v", issues)
	}
}

func TestFetchIssuesByStates(t *testing.T) {
	client := NewClient([]tracker.Issue{
		{ID: "2", Identifier: "ORC-20", State: "Cancelled"},
		{ID: "1", Identifier: "ORC-10", State: "Done"},
		{ID: "3", Identifier: "ORC-3", State: "In Progress"},
	})

	issues, err := client.FetchIssuesByStates(context.Background(), []string{"done", "cancelled"})
	if err != nil {
		t.Fatalf("fetch by states: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues in terminal states, got %d", len(issues))
	}
	if issues[0].Identifier != "ORC-10" || issues[1].Identifier != "ORC-20" {
		t.Fatalf("expected deterministic identifier ordering, got %+v", issues)
	}
}

func TestFetchIssueStatesByIDsSupportsLargeInput(t *testing.T) {
	seed := make([]tracker.Issue, 0, 120)
	ids := make([]string, 0, 120)
	for i := 1; i <= 120; i++ {
		id := "issue-" + strconv.Itoa(i)
		seed = append(seed, tracker.Issue{ID: id, Identifier: "ORC-" + strconv.Itoa(i), State: "In Progress"})
		ids = append(ids, id)
	}

	client := NewClient(seed)
	states, err := client.FetchIssueStatesByIDs(context.Background(), ids)
	if err != nil {
		t.Fatalf("fetch states: %v", err)
	}
	if len(states) != 120 {
		t.Fatalf("expected 120 states, got %d", len(states))
	}
}

func TestFetchCandidateIssuesReturnsDeterministicOrder(t *testing.T) {
	client := NewClient([]tracker.Issue{
		{ID: "2", Identifier: "ORC-20", State: "Todo"},
		{ID: "1", Identifier: "ORC-10", State: "Todo"},
		{ID: "3", Identifier: "ORC-30", State: "Todo"},
	})

	issues, err := client.FetchCandidateIssues(context.Background(), []string{"todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}

	if len(issues) != 3 {
		t.Fatalf("expected 3 issues, got %d", len(issues))
	}
	if issues[0].Identifier != "ORC-10" || issues[1].Identifier != "ORC-20" || issues[2].Identifier != "ORC-30" {
		t.Fatalf("unexpected order: %+v", issues)
	}
}

func TestNewClientWithWorkerAssigneesMarksAssignment(t *testing.T) {
	client := NewClientWithWorkerAssignees([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo", AssigneeID: "user-1"},
		{ID: "2", Identifier: "ORC-2", State: "Todo", AssigneeID: "user-2"},
	}, []string{"user-1"})

	issues, err := client.FetchCandidateIssues(context.Background(), []string{"todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}

	if !issues[0].AssignedToWorker || issues[0].AssigneeID != "user-1" {
		t.Fatalf("expected user-1 issue assigned_to_worker=true, got %+v", issues[0])
	}
	if issues[1].AssignedToWorker || issues[1].AssigneeID != "user-2" {
		t.Fatalf("expected user-2 issue assigned_to_worker=false, got %+v", issues[1])
	}
}

func TestMemoryClientPreservesRichIssueFields(t *testing.T) {
	seed := []tracker.Issue{{
		ID:               "1",
		Identifier:       "ORC-1",
		Title:            "Issue title",
		Description:      "Issue description",
		Priority:         2,
		State:            "Todo",
		BranchName:       "orc-1-branch",
		URL:              "https://tracker.local/ORC-1",
		AssigneeID:       "user-1",
		Labels:           []string{"backend", "urgent"},
		BlockedBy:        []tracker.Blocker{{ID: "b-1", Identifier: "ORC-B1", State: "In Progress"}},
		CreatedAt:        "2026-01-01T00:00:00Z",
		UpdatedAt:        "2026-01-02T00:00:00Z",
		AssignedToWorker: true,
	}}
	client := NewClient(seed)

	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"1"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(issues))
	}
	issue := issues[0]
	if issue.Description != "Issue description" || issue.Priority != 2 || issue.BranchName != "orc-1-branch" {
		t.Fatalf("expected rich fields preserved, got %+v", issue)
	}
	if issue.URL != "https://tracker.local/ORC-1" || issue.AssigneeID != "user-1" {
		t.Fatalf("expected URL and assignee preserved, got %+v", issue)
	}
	if len(issue.Labels) != 2 || issue.Labels[0] != "backend" || issue.Labels[1] != "urgent" {
		t.Fatalf("expected labels preserved, got %+v", issue.Labels)
	}
	if len(issue.BlockedBy) != 1 || issue.BlockedBy[0].Identifier != "ORC-B1" {
		t.Fatalf("expected blockers preserved, got %+v", issue.BlockedBy)
	}
	if issue.CreatedAt != "2026-01-01T00:00:00Z" || issue.UpdatedAt != "2026-01-02T00:00:00Z" {
		t.Fatalf("expected timestamps preserved, got created=%q updated=%q", issue.CreatedAt, issue.UpdatedAt)
	}
}
