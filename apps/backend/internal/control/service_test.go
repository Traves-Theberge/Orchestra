package control

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
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
	service.orchestrator.SetDB(database)
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

func TestCreateRejectsRetiredGeminiProviderBeforeMutation(t *testing.T) {
	service, database, first, _ := controlFixture(t)
	result := executeControl(service, map[string]any{
		"operation": "create", "project_id": first, "title": "Should not be created",
		"provider": "gemini", "request_id": "e92d350f-6142-44a3-a978-743811a8e6bf",
	})
	requireCode(t, result, "invalid_request")
	tasks, err := trackersqlite.NewClient(database, nil).FetchIssues(context.Background(), tracker.IssueFilter{ProjectID: first})
	if err != nil || len(tasks) != 0 {
		t.Fatalf("retired provider created a task: %+v %v", tasks, err)
	}
}

func TestAssignUnassignedBacklogTaskIsExactScopedAndPreservesPRLink(t *testing.T) {
	service, database, first, second := controlFixture(t)
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(context.Background(), "PR-linked task", "Description", "Backlog", 0, "", first, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	prURL := "https://github.com/example/project/pull/17"
	if _, err := client.UpdateIssue(context.Background(), task.ID, map[string]any{"pr_url": prURL}); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"operation": "assign", "project_id": first, "task_id": task.ID, "expected_state": "Backlog", "assignee_id": "worker-7", "request_id": "bd60e6ec-5c67-4937-9c72-3e46513b5fad"}
	wrongScope := map[string]any{}
	for key, value := range args {
		wrongScope[key] = value
	}
	wrongScope["project_id"] = second
	wrongScope["request_id"] = "124c23a0-6614-4fa2-9123-470cb36fb5a5"
	requireCode(t, executeControl(service, wrongScope), "task_not_found")

	result := executeControl(service, args)
	if result["success"] != true {
		t.Fatal(result)
	}
	data := result["data"].(map[string]any)
	updated := data["task"].(*tracker.Issue)
	if updated.ID != task.ID || updated.ProjectID != first || updated.State != "Backlog" || updated.AssigneeID != "worker-7" || updated.Provider != "" || updated.PRURL != prURL || data["effect"] != "assigned" || data["execution"] != "not_started" {
		t.Fatalf("assignment changed identity/readiness or lost PR linkage: %+v", result)
	}
	if replay := executeControl(service, args); replay["success"] != true {
		t.Fatalf("same request did not reconcile: %+v", replay)
	}
	conflict := map[string]any{}
	for key, value := range args {
		conflict[key] = value
	}
	conflict["assignee_id"] = "worker-other"
	requireCode(t, executeControl(service, conflict), "request_identity_conflict")

	reassigned := map[string]any{}
	for key, value := range args {
		reassigned[key] = value
	}
	reassigned["request_id"] = "8228bcb7-85f1-424b-8fbe-18345e6d605c"
	requireCode(t, executeControl(service, reassigned), "assignee_conflict")

	if list := executeControl(service, map[string]any{"operation": "tasks", "project_id": first, "unassigned": true}); list["success"] != true || len(list["data"].(map[string]any)["tasks"].([]tracker.Issue)) != 0 {
		t.Fatalf("assigned task remained in unassigned view: %+v", list)
	}
	assigned := executeControl(service, map[string]any{"operation": "tasks", "project_id": first, "assignee_id": "worker-7"})
	if assigned["success"] != true {
		t.Fatal(assigned)
	}
	rows := assigned["data"].(map[string]any)["tasks"].([]tracker.Issue)
	if len(rows) != 1 || rows[0].PRURL != prURL {
		t.Fatalf("strict task inventory lost assignment/PR link: %+v", assigned)
	}
	queue := map[string]any{"operation": "queue", "project_id": first, "task_id": task.ID, "expected_state": "Backlog", "request_id": "c2112626-aad4-437e-b337-22f4ca8ce6bb"}
	requireCode(t, executeControl(service, queue), "incomplete_task")
	current, err := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if err != nil || current.State != "Backlog" || current.AssigneeID != "worker-7" || current.Provider != "" || current.PRURL != prURL {
		t.Fatalf("partial assignment implicitly queued or changed task linkage: %+v %v", current, err)
	}

	readyTask, err := client.CreateIssue(context.Background(), "Complete before queue", "Has a full description", "Backlog", 0, "", first, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	readyAssignment := map[string]any{
		"operation": "assign", "project_id": first, "task_id": readyTask.ID,
		"expected_state": "Backlog", "assignee_id": "worker-8", "provider": "codex",
		"request_id": "d7d43361-b3b3-4f2d-93a3-3da090894879",
	}
	if assigned := executeControl(service, readyAssignment); assigned["success"] != true {
		t.Fatalf("explicit assignment/provider was rejected: %+v", assigned)
	}
	ready, err := client.FetchIssueByIdentifier(context.Background(), readyTask.ID)
	if err != nil || ready.Provider != "CODEX" || ready.AssigneeID != "worker-8" || ready.State != "Backlog" {
		t.Fatalf("assignment did not apply only the explicit metadata: %+v %v", ready, err)
	}
	queueReady := map[string]any{
		"operation": "queue", "project_id": first, "task_id": readyTask.ID,
		"expected_state": "Backlog", "request_id": "2d1227c5-9c2c-4403-9d54-773e13fa53d4",
	}
	if queued := executeControl(service, queueReady); queued["success"] != true {
		t.Fatalf("fully configured task could not be queued separately: %+v", queued)
	}
	ready, err = client.FetchIssueByIdentifier(context.Background(), readyTask.ID)
	if err != nil || ready.State != "Todo" || ready.AssigneeID != "worker-8" || ready.Provider != "CODEX" {
		t.Fatalf("queue failed to retain the explicit assignment: %+v %v", ready, err)
	}
}

func TestPlanApprovalAndReplanAreDurableExactAndReplayable(t *testing.T) {
	service, database, projectID, _ := controlFixture(t)
	client := trackersqlite.NewClient(database, nil)
	service.orchestrator.SetTrackerClient(client)
	task, err := client.CreateIssue(context.Background(), "Plan before execution", "Implement the requested behavior", "Todo", 0, "worker-1", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	const planFeedback = "Add an explicit regression case"
	if _, err := client.UpdateIssue(context.Background(), task.ID, map[string]any{"feedback": planFeedback}); err != nil {
		t.Fatal(err)
	}
	current, err := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	expected := plangate.Fingerprint(*current)
	if err := service.orchestrator.RecordPlanResult(context.Background(), projectID, task.ID, "- [ ] inspect\n- [ ] implement", expected); err != nil {
		t.Fatal(err)
	}
	listed := executeControl(service, map[string]any{"operation": "tasks", "project_id": projectID})
	rows := listed["data"].(map[string]any)["tasks"].([]tracker.Issue)
	if len(rows) != 1 || rows[0].State != "Todo" || rows[0].PlanGate == nil || rows[0].PlanGate.Status != "awaiting_approval" || rows[0].PlanGate.PlanHash == "" {
		t.Fatalf("planning did not remain Todo awaiting approval: %+v", listed)
	}
	approval := map[string]any{"operation": "approve_plan", "project_id": projectID, "task_id": task.ID, "expected_state": "Todo", "expected_plan_hash": rows[0].PlanGate.PlanHash, "request_id": "39c4919d-b0e8-48d9-9fd5-9178b67fc322"}
	approved := executeControl(service, approval)
	if approved["success"] != true {
		t.Fatalf("approve failed: %+v", approved)
	}
	data := approved["data"].(map[string]any)
	updated := data["task"].(*tracker.Issue)
	if data["effect"] != "plan_approved" || data["execution"] != "queued" || updated.State != "In Progress" || updated.PlanGate == nil || updated.PlanGate.Status != "approved" || approved["receipt_status"] != "completed" {
		t.Fatalf("approval response does not confirm exact queued transition: %+v (task_state=%q gate=%+v hash=%q expected=%q)", approved, updated.State, updated.PlanGate, updated.PlanGate.PlanHash, rows[0].PlanGate.PlanHash)
	}
	if _, err := service.orchestrator.UpdateIssue(context.Background(), task.ID, map[string]any{"state": "Backlog"}); !errors.Is(err, orchestrator.ErrReplanRequired) {
		t.Fatalf("approved task could take generic In Progress→Backlog path: %v", err)
	}
	unchanged, err := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if err != nil || unchanged.State != "In Progress" {
		t.Fatalf("blocked stale-approval path mutated task: %+v %v", unchanged, err)
	}
	if replay := executeControl(service, approval); replay["success"] != true || replay["receipt_status"] != "completed" {
		t.Fatalf("approval receipt replay failed: %+v", replay)
	}

	replan := map[string]any{"operation": "replan", "project_id": projectID, "task_id": task.ID, "expected_state": "In Progress", "expected_plan_hash": updated.PlanGate.PlanHash, "feedback": planFeedback, "request_id": "ed3b8e38-7d92-4560-ad39-d3c5f337b928"}
	replanned := executeControl(service, replan)
	if replanned["success"] != true {
		t.Fatalf("replan failed: %+v", replanned)
	}
	data = replanned["data"].(map[string]any)
	updated = data["task"].(*tracker.Issue)
	if data["effect"] != "replan_requested" || data["execution"] != "not_started" || updated.State != "Todo" || updated.Feedback != planFeedback || updated.Plan != "- [ ] inspect\n- [ ] implement" || updated.PlanGate == nil || updated.PlanGate.Status != "stale" || replanned["receipt_status"] != "completed" {
		t.Fatalf("replan did not preserve plan and invalidate approval: %+v", replanned)
	}
	if err := service.orchestrator.RecordPlanResult(context.Background(), projectID, task.ID, "- [ ] inspect\n- [ ] implement", plangate.Fingerprint(*updated)); err != nil {
		t.Fatalf("same-context replacement plan: %v", err)
	}
	afterReplacement, err := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if err != nil || service.orchestrator.PlanGate(context.Background(), *afterReplacement).Status != "awaiting_approval" {
		t.Fatalf("replacement plan inherited stale approval: issue=%+v err=%v gate=%+v", afterReplacement, err, service.orchestrator.PlanGate(context.Background(), *afterReplacement))
	}
	if replay := executeControl(service, replan); replay["success"] != true || replay["receipt_status"] != "completed" {
		t.Fatalf("replan receipt replay failed: %+v", replay)
	}
}

func TestPlanGateRejectsStaleHashUnsettledAndHostedScope(t *testing.T) {
	service, database, projectID, otherID := controlFixture(t)
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(context.Background(), "Plan", "Description", "Todo", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	current, _ := client.FetchIssueByIdentifier(context.Background(), task.ID)
	hash := plangate.Fingerprint(*current)
	if err := service.orchestrator.RecordPlanResult(context.Background(), projectID, task.ID, "- [ ] work", hash); err != nil {
		t.Fatal(err)
	}
	stale := map[string]any{"operation": "approve_plan", "project_id": projectID, "task_id": task.ID, "expected_state": "Todo", "expected_plan_hash": "stale", "request_id": "586eb8bd-25d1-42c9-85ac-f4561d9e5c13"}
	requireCode(t, executeControl(service, stale), "plan_conflict")
	foreign := map[string]any{"operation": "approve_plan", "project_id": otherID, "task_id": task.ID, "expected_state": "Todo", "expected_plan_hash": hash, "request_id": "48889020-7785-4d84-84a8-6ad0653c984d"}
	requireCode(t, executeControl(service, foreign), "task_not_found")
}

func TestPlanResultRejectsChangedContext(t *testing.T) {
	service, database, projectID, _ := controlFixture(t)
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(context.Background(), "Plan", "Original description", "Todo", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	original, _ := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if _, err := client.UpdateIssue(context.Background(), task.ID, map[string]any{"description": "Changed while planning"}); err != nil {
		t.Fatal(err)
	}
	if err := service.orchestrator.RecordPlanResult(context.Background(), projectID, task.ID, "- [ ] stale output", plangate.Fingerprint(*original)); err == nil {
		t.Fatal("plan output from changed task context was accepted")
	}
	current, _ := client.FetchIssueByIdentifier(context.Background(), task.ID)
	if current.Plan != "" {
		t.Fatalf("stale plan output was saved: %q", current.Plan)
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
