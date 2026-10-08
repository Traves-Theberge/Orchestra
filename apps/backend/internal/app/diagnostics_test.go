package app

import (
	"context"
	"encoding/json"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTaskDiagnosticsRecordsObservedAttemptFailure(t *testing.T) {
	root, project, database := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, database, project)
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, ProjectID: project, Provider: "UNREGISTERED", State: issue.State, StartedAt: time.Now().UTC().Format(time.RFC3339)}})
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	// The task's explicit provider is absent; no execution occurs.
	registry := agents.NewRegistry(map[string]string{"CODEX": "unused"})
	processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderCodex, "CODEX", root, "missing", 0, nil, nil, workspace.Hooks{}, nil, database, nil, nil, &config.Config{}, nil, zerolog.Nop(), recorder)
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{TaskID: issue.ID})
	if err != nil || page.Total != 1 {
		t.Fatalf("missing exact task attempt: %+v %v", page, err)
	}
	detail, err := recorder.Trace(context.Background(), page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Trace.Status != "error" || detail.Trace.Attempt != 1 || detail.Trace.ProjectID != project {
		t.Fatalf("incorrect outcome/identity: %+v", detail.Trace)
	}
	for _, span := range detail.Spans {
		if span.Name == "provider.turn" {
			t.Fatal("invented provider execution for rejected dispatch")
		}
	}
	found := false
	for _, event := range detail.Logs {
		if event.Name == "task.retry.scheduled" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing observed retry scheduling event")
	}
}

type diagnosticFinalizationTracker struct {
	tracker.Client
	service        *orchestrator.Service
	onFinalization func([]tracker.Issue)
	triggered      bool
}

func (c *diagnosticFinalizationTracker) FetchIssuesByIDs(ctx context.Context, ids []string) ([]tracker.Issue, error) {
	issues, err := c.Client.FetchIssuesByIDs(ctx, ids)
	if err == nil && !c.triggered && c.service.Snapshot().Counts.Running == 0 {
		c.triggered = true
		c.onFinalization(issues)
	}
	return issues, err
}

func TestTaskDiagnosticsDiscardAtFinalizationFence(t *testing.T) {
	for _, outcome := range []string{"cancelled", "unknown"} {
		t.Run(outcome, func(t *testing.T) {
			root, project, database := testProjectSetup(t)
			service := orchestrator.NewService()
			issue := setupApprovedLocalTask(t, service, database, project)
			service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, ProjectID: project, Provider: "OPENCODE", State: issue.State, StartedAt: time.Now().UTC().Format(time.RFC3339)}})
			observer := &diagnosticFinalizationTracker{Client: trackersqlite.NewClient(database, []string{"agent-opencode"}), service: service}
			observer.onFinalization = func(issues []tracker.Issue) {
				if outcome == "cancelled" {
					if !service.StopSession(issue.ID, "") {
						t.Fatal("finalization cancel registration missing")
					}
				} else {
					for i := range issues {
						issues[i].State = "Backlog"
					}
				}
			}
			service.SetTrackerClient(observer)
			registry := agents.NewRegistry(map[string]string{"opencode": "unused"})
			registry.SetRunner(agents.ProviderOpenCode, &fakeLifecycleRunner{})
			recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
			if err != nil {
				t.Fatal(err)
			}
			defer recorder.Close()
			processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderOpenCode, "opencode", root, "missing", 0, nil, nil, workspace.Hooks{}, nil, database, nil, nil, &config.Config{}, nil, zerolog.Nop(), recorder)
			if !observer.triggered {
				t.Fatal("finalization fence was not reached")
			}
			if err := recorder.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{TaskID: issue.ID})
			if err != nil || page.Total != 1 || page.Items[0].Status != outcome {
				t.Fatalf("finalization outcome: %+v %v", page, err)
			}
			detail, err := recorder.Trace(context.Background(), page.Items[0].TraceID)
			if err != nil {
				t.Fatal(err)
			}
			for _, span := range detail.Spans {
				if span.Name == "provider.turn" && span.Status != "ok" {
					t.Fatalf("provider outcome changed: %+v", span)
				}
				if span.Name == "task.finalize" && span.Status != outcome {
					t.Fatalf("finalization outcome lost: %+v", span)
				}
			}
		})
	}
}

func TestTaskDiagnosticsObservedWorkerOutcomesAndRetryIdentity(t *testing.T) {
	root, project, database := testProjectSetup(t)
	// A local bare origin exercises successful finalization without network access.
	origin := filepath.Join(t.TempDir(), "origin.git")
	for _, args := range [][]string{{"init", "--bare", origin}, {"-C", filepath.Join(root, "repo"), "remote", "add", "origin", origin}} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("local origin: %s %v", out, err)
		}
	}
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, database, project)
	service.SetMaxTurns(10)
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	for attempt, command := range []string{"exit 2", "printf completed > result.txt; printf '{\"event\":\"turn.completed\",\"message\":\"PRIVATE_PROVIDER_RESPONSE\"}\\n'"} {
		now := time.Now().UTC().Format(time.RFC3339)
		service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, ProjectID: project, Provider: "OPENCODE", State: issue.State, StartedAt: now, LastEventAt: now, TurnCount: int64(attempt)}})
		registry := agents.NewRegistry(map[string]string{"opencode": command})
		processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderOpenCode, "opencode", root, "missing", 0, nil, nil, workspace.Hooks{}, nil, database, nil, nil, &config.Config{}, nil, zerolog.Nop(), recorder)
		if attempt == 0 && service.Snapshot().Counts.Retrying != 1 {
			t.Fatal("failed fixture did not schedule retry")
		}
	}
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{TaskID: issue.ID})
	if err != nil || page.Total != 2 {
		t.Fatalf("attempt traces: %+v %v", page, err)
	}
	seen := map[int]string{}
	runs := map[string]bool{}
	for _, summary := range page.Items {
		detail, err := recorder.Trace(context.Background(), summary.TraceID)
		if err != nil {
			t.Fatal(err)
		}
		seen[summary.Attempt] = summary.Status
		runs[summary.RunID] = true
		if summary.Name != "task.attempt" || summary.ProjectID != project {
			t.Fatalf("task root: %+v", summary)
		}
		children := map[string]bool{}
		for _, span := range detail.Spans {
			children[span.Name] = true
			if span.TaskID != issue.ID || span.Attempt != summary.Attempt || span.RunID != summary.RunID {
				t.Fatalf("child identity: %+v", span)
			}
			if span.Name != "task.attempt" && span.ParentSpanID != summary.SpanID {
				t.Fatalf("child parent: %+v", span)
			}
			if span.Name == "provider.turn" && (span.Status != summary.Status || span.InputTokens != nil || span.OutputTokens != nil) {
				t.Fatalf("provider outcome/unknown usage: %+v", span)
			}
		}
		for _, name := range []string{"task.prepare", "provider.turn", "task.finalize"} {
			if !children[name] {
				t.Fatalf("missing observed %s", name)
			}
		}
		if summary.Attempt == 1 {
			retry := false
			for _, event := range detail.Logs {
				retry = retry || event.Name == "task.retry.scheduled"
			}
			if !retry {
				t.Fatal("failed attempt omitted scheduled retry")
			}
		}
	}
	if seen[1] != "error" || seen[2] != "ok" || len(runs) != 2 {
		t.Fatalf("attempt outcomes/runs: %+v %+v", seen, runs)
	}
	export, err := recorder.Export(context.Background(), diagnostics.Filter{})
	raw, _ := json.Marshal(export)
	if err != nil || strings.Contains(string(raw), "PRIVATE_PROVIDER_RESPONSE") || strings.Contains(string(raw), root) || strings.Contains(string(raw), "printf") {
		t.Fatalf("diagnostic privacy: %s %v", raw, err)
	}
}

func TestTaskToolDiagnosticsObservedOutcomeAndPrivacy(t *testing.T) {
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	parent, root := recorder.Start(context.Background(), "task.attempt", diagnostics.Fields{TaskID: "tool-task"})
	for _, outcome := range []string{"ok", "error", "unknown", "cancelled"} {
		ctx, cancel := context.WithCancel(context.Background())
		if outcome == "cancelled" {
			cancel()
		}
		execute := diagnosticTaskToolExecutor(recorder, parent, diagnostics.Fields{TaskID: "tool-task"}, func(ctx context.Context, name string, args map[string]any) map[string]any {
			result := map[string]any{"content": "PRIVATE_TOOL_RESULT"}
			if outcome != "unknown" {
				result["success"] = outcome == "ok"
			}
			return result
		})
		result := execute(ctx, "PRIVATE_TOOL_NAME", map[string]any{"password": "PRIVATE_TOOL_ARGS"})
		cancel()
		if result["content"] != "PRIVATE_TOOL_RESULT" {
			t.Fatal("diagnostics changed tool result")
		}
	}
	root.End("ok")
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{TaskID: "tool-task"})
	if err != nil || page.Total != 1 {
		t.Fatalf("tool trace: %+v %v", page, err)
	}
	detail, err := recorder.Trace(context.Background(), page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]int{}
	for _, span := range detail.Spans {
		if span.Name == "tool.execute" {
			statuses[span.Status]++
			if span.ParentSpanID != page.Items[0].SpanID {
				t.Fatal("tool lost execution parent")
			}
		}
	}
	for _, status := range []string{"ok", "error", "unknown", "cancelled"} {
		if statuses[status] != 1 {
			t.Fatalf("tool statuses: %+v", statuses)
		}
	}
	raw, _ := json.Marshal(detail)
	if strings.Contains(string(raw), "PRIVATE_TOOL") {
		t.Fatalf("tool content leaked: %s", raw)
	}
}

func TestTaskToolDiagnosticsDoesNotResurrectFencedParent(t *testing.T) {
	for _, fence := range []string{"clear", "disable"} {
		t.Run(fence, func(t *testing.T) {
			recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
			if err != nil {
				t.Fatal(err)
			}
			defer recorder.Close()
			parent, root := recorder.Start(context.Background(), "task.attempt", diagnostics.Fields{TaskID: "fenced-task"})
			if err := recorder.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if fence == "clear" {
				if err := recorder.Clear(context.Background()); err != nil {
					t.Fatal(err)
				}
			} else {
				settings, err := recorder.Settings(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				settings.Enabled = false
				if err := recorder.UpdateSettings(context.Background(), settings); err != nil {
					t.Fatal(err)
				}
				settings.Enabled = true
				if err := recorder.UpdateSettings(context.Background(), settings); err != nil {
					t.Fatal(err)
				}
			}
			executed := false
			execute := diagnosticTaskToolExecutor(recorder, parent, diagnostics.Fields{TaskID: "fenced-task"}, func(context.Context, string, map[string]any) map[string]any {
				executed = true
				return map[string]any{"success": true}
			})
			execute(context.Background(), "private-tool", nil)
			root.End("ok")
			if !executed {
				t.Fatal("telemetry fence blocked tool execution")
			}
			if err := recorder.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{})
			expected := 0
			if fence == "disable" {
				expected = 1
			}
			if err != nil || page.Total != expected {
				t.Fatalf("fenced task resurrected: %+v %v", page, err)
			}
			if fence == "disable" {
				detail, err := recorder.Trace(context.Background(), page.Items[0].TraceID)
				if err != nil {
					t.Fatal(err)
				}
				for _, span := range detail.Spans {
					if span.Name == "tool.execute" {
						t.Fatalf("disabled parent accepted late tool: %+v", span)
					}
				}
			}
		})
	}
}

type diagnosticCancelledRunner struct{ cancel context.CancelFunc }

func (r diagnosticCancelledRunner) RunTurn(_ context.Context, request agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	r.cancel()
	return agents.TurnResult{ExitCode: 0, SessionID: request.SessionID}, nil
}

func TestTaskDiagnosticsRejectsLateProviderSuccessAfterCancellation(t *testing.T) {
	root, project, database := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, database, project)
	stage, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.SetStageContext(stage)
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, ProjectID: project, Provider: "OPENCODE", State: issue.State, StartedAt: time.Now().UTC().Format(time.RFC3339)}})
	registry := agents.NewRegistry(map[string]string{"opencode": "unused"})
	registry.SetRunner(agents.ProviderOpenCode, diagnosticCancelledRunner{cancel: cancel})
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "diagnostics.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderOpenCode, "opencode", root, "missing", 0, nil, nil, workspace.Hooks{}, nil, database, nil, nil, &config.Config{}, nil, zerolog.Nop(), recorder)
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	page, err := recorder.ListTraces(context.Background(), diagnostics.Filter{TaskID: issue.ID})
	if err != nil || page.Total != 1 || page.Items[0].Status != "cancelled" {
		t.Fatalf("cancelled attempt: %+v %v", page, err)
	}
	detail, err := recorder.Trace(context.Background(), page.Items[0].TraceID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, span := range detail.Spans {
		if span.Name == "provider.turn" {
			found = true
			if span.Status != "cancelled" {
				t.Fatalf("late success recorded: %+v", span)
			}
		}
	}
	if !found {
		t.Fatal("missing observed cancelled provider")
	}
	live, err := service.FetchIssueByID(context.Background(), issue.ID)
	if err != nil || live.State != "In Progress" {
		t.Fatalf("late result changed task: %+v %v", live, err)
	}
}
