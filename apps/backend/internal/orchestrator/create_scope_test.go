package orchestrator

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func TestSourceEmptyProjectCreationUsesConfiguredWorkerAllowlist(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	const projectID = "project-local"
	if _, err := database.Exec(`INSERT INTO projects(id,name,root_path,remote_url) VALUES(?,?,?,?)`, projectID, "Local", filepath.Join(t.TempDir(), "repo"), ""); err != nil {
		t.Fatalf("insert project: %v", err)
	}

	service := NewService()
	service.SetDB(database)
	service.SetTrackerWorkerAssigneeIDs([]string{"agent-CODEX"})
	client, source, err := service.clientForCreation(context.Background(), projectID)
	if err != nil {
		t.Fatalf("resolve local project client: %v", err)
	}
	if source != "sqlite" {
		t.Fatalf("expected local sqlite source, got %q", source)
	}

	worker, err := client.CreateIssue(context.Background(), "Worker task", "description", "Backlog", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatalf("create worker task: %v", err)
	}
	human, err := client.CreateIssue(context.Background(), "Human task", "description", "Backlog", 0, "person-smoke", projectID, "CODEX", nil)
	if err != nil {
		t.Fatalf("create human task: %v", err)
	}
	if !worker.AssignedToWorker {
		t.Fatalf("configured worker assignee was not classified as routable: %+v", worker)
	}
	if human.AssignedToWorker {
		t.Fatalf("human assignee was classified as a worker: %+v", human)
	}
}
