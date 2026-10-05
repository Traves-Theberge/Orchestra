package api

import (
	"bytes"
	"context"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/cli"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	sqlitetracker "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/rs/zerolog"
)

func TestCLIAssignUsesAuthenticatedAPIAndSQLiteControl(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(root, "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	workItems := sqlitetracker.NewClient(database, nil)
	task, err := workItems.CreateIssue(ctx, "Assign safely", "Only assign this task", "Backlog", 0, "", projectID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	prURL := "https://github.com/example/repo/pull/17"
	if _, err := workItems.UpdateIssue(ctx, task.ID, map[string]any{"pr_url": prURL}); err != nil {
		t.Fatal(err)
	}

	providerRegistry := agents.NewRegistry(nil)
	chat, err := workspacechat.New(database, providerRegistry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer chat.Close()
	service := orchestrator.NewService()
	service.SetDB(database)
	service.SetTrackerClient(workItems)
	server := httptest.NewServer(NewRouterWithPubSub(
		zerolog.Nop(), service,
		&config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "isolated-token", ProjectRoots: []string{root}},
		nil, database, nil, nil, nil, nil, nil, chat,
	))
	defer server.Close()
	getenv := func(key string) string {
		switch key {
		case "ORCHESTRA_BASE_URL":
			return server.URL
		case "ORCHESTRA_API_TOKEN":
			return "isolated-token"
		default:
			return ""
		}
	}

	var stdout, stderr bytes.Buffer
	exit := cli.Run(ctx, []string{"task", "list", "--project", projectID, "--unassigned"}, &stdout, &stderr, getenv)
	if exit != 0 || stderr.Len() != 0 || !strings.Contains(stdout.String(), task.Identifier+" — Assign safely") || !strings.Contains(stdout.String(), "Assignee: unassigned") || !strings.Contains(stdout.String(), "PR: "+prURL) {
		t.Fatalf("CLI list did not return the exact unassigned SQLite row and PR: exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
	}

	stdout.Reset()
	stderr.Reset()
	exit = cli.Run(ctx, []string{
		"task", "assign", "--project", projectID, "--id", task.ID,
		"--request-id", "bd60e6ec-5c67-4937-9c72-3e46513b5fad", "--assignee", "worker-7",
	}, &stdout, &stderr, getenv)
	if exit != 0 || stderr.Len() != 0 || !strings.Contains(stdout.String(), "Task assigned; it remains in Backlog and was not queued.") || !strings.Contains(stdout.String(), "PR: "+prURL) {
		t.Fatalf("CLI assignment failed through authenticated API: exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
	}

	stored, err := workItems.FetchIssueByIdentifier(ctx, task.ID)
	if err != nil || stored.ProjectID != projectID || stored.ID != task.ID || stored.State != "Backlog" || stored.AssigneeID != "worker-7" || stored.Provider != "" || stored.PRURL != prURL {
		t.Fatalf("SQLite did not preserve exact Backlog assignment/linkage: %+v %v", stored, err)
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 || len(snapshot.Retrying) != 0 {
		t.Fatalf("assignment unexpectedly started execution: %+v", snapshot)
	}
}
