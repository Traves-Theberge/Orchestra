package orchestrator

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func TestUpdateIssueCannotBypassPlanOrReviewGate(t *testing.T) {
	ctx := context.Background()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := trackersqlite.NewClient(database, nil)
	todo, err := client.CreateIssue(ctx, "Todo", "Description", "Todo", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	review, err := client.CreateIssue(ctx, "Review", "Description", "Review", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService()
	service.SetDB(database)
	service.SetTrackerClient(client)
	if _, err := service.UpdateIssue(ctx, todo.ID, map[string]any{"state": "In Progress"}); !errors.Is(err, ErrPlanApprovalRequired) {
		t.Fatalf("Todo→In Progress bypass returned %v", err)
	}
	if _, err := service.UpdateIssue(ctx, review.ID, map[string]any{"state": "In Progress"}); !errors.Is(err, ErrReplanRequired) {
		t.Fatalf("Review→In Progress bypass returned %v", err)
	}
	if _, err := service.UpdateIssue(ctx, review.ID, map[string]any{"state": "Done"}); !errors.Is(err, ErrReviewApprovalRequired) {
		t.Fatalf("Review→Done bypass returned %v", err)
	}
	unchangedTodo, _ := client.FetchIssueByIdentifier(ctx, todo.ID)
	unchangedReview, _ := client.FetchIssueByIdentifier(ctx, review.ID)
	if unchangedTodo.State != "Todo" || unchangedReview.State != "Review" {
		t.Fatalf("blocked updates mutated state: todo=%s review=%s", unchangedTodo.State, unchangedReview.State)
	}
}

func TestServiceRejectsNewGeminiAssignmentsButPreservesLegacyTasks(t *testing.T) {
	ctx := context.Background()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := trackersqlite.NewClient(database, nil)
	legacy, err := client.CreateIssue(ctx, "Archived task", "Keep history", "Backlog", 0, "", projectID, "GEMINI", nil)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService()
	service.SetDB(database)
	service.SetTrackerClient(client)
	if _, err := service.CreateIssue(ctx, "New task", "Description", "Backlog", 0, "", projectID, "GEMINI", "", nil); err == nil {
		t.Fatal("new task accepted retired Gemini provider")
	}
	if _, err := service.UpdateIssue(ctx, legacy.ID, map[string]any{"provider": "gemini"}); err == nil {
		t.Fatal("new Gemini assignment was accepted")
	}
	if _, err := service.UpdateIssue(ctx, legacy.ID, map[string]any{"title": "Retained legacy task"}); err != nil {
		t.Fatalf("unrelated legacy task edit failed: %v", err)
	}
	retained, err := client.FetchIssueByIdentifier(ctx, legacy.ID)
	if err != nil || retained.Provider != "GEMINI" || retained.Title != "Retained legacy task" {
		t.Fatalf("legacy provider identity was not preserved: %+v %v", retained, err)
	}
}

func TestRetiredLegacyDefaultIsPreservedOnUnrelatedAgentConfigUpdate(t *testing.T) {
	service := NewService()
	service.SetAgentRegistry(agents.NewRegistry(nil), map[string]string{"GEMINI": "legacy gemini --prompt {{prompt}}"}, "GEMINI")
	if err := service.UpdateAgentConfig(map[string]string{"CODEX": "codex exec {{prompt}}"}, ""); err != nil {
		t.Fatalf("unrelated command update: %v", err)
	}
	commands, provider := service.GetAgentConfig()
	if provider != "GEMINI" {
		t.Fatalf("legacy provider default changed without an explicit replacement: %q", provider)
	}
	if commands["GEMINI"] != "legacy gemini --prompt {{prompt}}" || commands["CODEX"] == "" {
		t.Fatalf("legacy settings were not preserved/merged: %+v", commands)
	}
	if err := service.UpdateAgentConfig(nil, "GEMINI"); !errors.Is(err, ErrRetiredHarness) {
		t.Fatalf("explicit retired default returned %v", err)
	}
}

func TestUnsupportedTodoPlanningStageIsVisibleAndNotQueued(t *testing.T) {
	ctx := context.Background()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(ctx, "Plan me", "Description", "Todo", 0, "agent-ANTIGRAVITY", projectID, "ANTIGRAVITY", nil)
	if err != nil {
		t.Fatal(err)
	}
	commands := map[string]string{"ANTIGRAVITY": "agy --mode accept-edits {{prompt}}"}
	service := NewService()
	service.SetDB(database)
	service.SetTrackerClient(client)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetAgentRegistry(agents.NewRegistry(commands), commands, "ANTIGRAVITY")
	gate := service.PlanGate(ctx, *task)
	if gate.Status != "unsupported" || gate.PlanHash == "" || gate.Reason == "" {
		t.Fatalf("unsupported planning capability was not projected clearly: %+v", gate)
	}
	service.QueueRefresh()
	if err := service.PerformRefresh(ctx); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 || len(snapshot.Retrying) != 0 {
		t.Fatalf("unsupported planning stage was retried or queued: %+v", snapshot)
	}
}

func TestRemoteRuntimePlanningIsVisibleAndNotQueued(t *testing.T) {
	ctx := context.Background()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(ctx, "Remote plan", "Description", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(ctx, task.ID, map[string]any{"runtime_target": "TAILSCALE"}); err != nil {
		t.Fatal(err)
	}
	current, err := client.FetchIssueByIdentifier(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	commands := map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"}
	service := NewService()
	service.SetDB(database)
	service.SetTrackerClient(client)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetAgentRegistry(agents.NewRegistry(commands), commands, "CODEX")
	gate := service.PlanGate(ctx, *current)
	if gate.Status != "unsupported" || gate.PlanHash == "" || !strings.Contains(gate.Reason, "local runtime") {
		t.Fatalf("remote planning capability was not projected clearly: %+v", gate)
	}
	service.QueueRefresh()
	if err := service.PerformRefresh(ctx); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 || len(snapshot.Retrying) != 0 {
		t.Fatalf("unsupported remote planning stage was retried or queued: %+v", snapshot)
	}
}

func TestWithSettledTaskRejectsActivePRReview(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.Exec(`CREATE TABLE pr_review_attempts (task_id TEXT NOT NULL,status TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO pr_review_attempts(task_id,status) VALUES('task-1','running')`); err != nil {
		t.Fatal(err)
	}
	service := NewService()
	service.SetDB(database)
	if err := service.WithSettledTask("task-1", func() error { return nil }); !errors.Is(err, ErrTaskUnsettled) {
		t.Fatalf("active PR review was not treated as unsettled: %v", err)
	}
	if err := service.WithSettledTask("task-2", func() error { return nil }); err != nil {
		t.Fatalf("unrelated task was blocked by review: %v", err)
	}
}
