package control

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func controlFixture(t *testing.T) (*Service, *db.DB, string, string) {
	t.Helper()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	first, err := database.UpsertProject(context.Background(), filepath.Join(t.TempDir(), "first"), "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := database.UpsertProject(context.Background(), filepath.Join(t.TempDir(), "second"), "")
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(database, orchestrator.NewService(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return service, database, first, second
}
func executeControl(s *Service, args map[string]any) map[string]any {
	return s.Execute(context.Background(), "orchestra_control", args)
}
func requireCode(t *testing.T, result map[string]any, code string) {
	t.Helper()
	if result["success"] != false || result["error"].(map[string]string)["code"] != code {
		t.Fatalf("want %s got %+v", code, result)
	}
}
func TestControlRequestIdentityAndInterruptedReceiptNeverReplay(t *testing.T) {
	service, database, first, _ := controlFixture(t)
	args := map[string]any{"operation": "create", "project_id": first, "title": "Backlog intent", "request_id": "c56f9f23-0eea-4331-bb77-93002d24dcd1"}
	if result := executeControl(service, args); result["success"] != true {
		t.Fatal(result)
	}
	if result := executeControl(service, args); result["success"] != true {
		t.Fatal(result)
	}
	args["title"] = "Different effect"
	requireCode(t, executeControl(service, args), "request_identity_conflict")
	client := trackersqlite.NewClient(database, nil)
	tasks, err := client.FetchIssues(context.Background(), tracker.IssueFilter{ProjectID: first})
	if err != nil || len(tasks) != 1 {
		t.Fatalf("duplicate task %+v %v", tasks, err)
	}
	args["request_id"] = "c4951f7d-f622-4f8b-b2b8-28d357511f7a"
	raw, _ := json.Marshal(args)
	sum := sha256.Sum256(raw)
	_, err = database.Exec(`INSERT INTO orchestrator_control_operations(request_id,digest,operation,project_id,task_id,status) VALUES(?,?, 'create',?, '', 'pending')`, args["request_id"], hex.EncodeToString(sum[:]), first)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(database, orchestrator.NewService(), nil)
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, executeControl(restarted, args), "mutation_unknown")
	tasks, _ = client.FetchIssues(context.Background(), tracker.IssueFilter{ProjectID: first})
	if len(tasks) != 1 {
		t.Fatal("pending intent was replayed")
	}
}
func TestQueueRequiresExactScopedIdentityAndCompleteBacklog(t *testing.T) {
	service, database, first, second := controlFixture(t)
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(context.Background(), "Task", "Description", "Backlog", 0, "owner", first, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"operation": "queue", "project_id": second, "task_id": task.ID, "expected_state": "Backlog", "request_id": "9dd65c5d-ea96-4a07-8998-674b1d239da3"}
	requireCode(t, executeControl(service, args), "task_not_found")
	args["project_id"] = first
	args["request_id"] = "b726492c-e981-426b-bba0-75e0be6b2d60"
	if result := executeControl(service, args); result["success"] != true {
		t.Fatal(result)
	}
	if result := executeControl(service, args); result["success"] != true {
		t.Fatal(result)
	}
	args["request_id"] = "3bd38321-c20a-4b43-b790-761e70306f71"
	requireCode(t, executeControl(service, args), "state_conflict")
	current, err := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if err != nil || current.State != "Todo" || current.ProjectID != first {
		t.Fatalf("queue %+v %v", current, err)
	}
	for _, op := range []string{"pause", "stop", "delete", "retry"} {
		requireCode(t, executeControl(service, map[string]any{"operation": op, "project_id": first}), "unsupported_operation")
	}
}
func TestConfiguredProjectTrackerFailureCannotFallBackToSQLite(t *testing.T) {
	service, database, first, _ := controlFixture(t)
	if err := database.UpdateProjectIssueSource(context.Background(), first, "github", "owner/repo", ""); err != nil {
		t.Fatal(err)
	}
	requireCode(t, executeControl(service, map[string]any{"operation": "create", "project_id": first, "title": "Must not fall back", "request_id": "cce185f7-08c2-401e-9f49-6c85c0de53da"}), "project_unavailable")
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM issues`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("fallback task %d %v", count, err)
	}
}
