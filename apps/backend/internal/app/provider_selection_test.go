package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

type selectionRecordingRunner struct{ calls int }

func (r *selectionRecordingRunner) RunTurn(context.Context, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error) {
	r.calls++
	return agents.TurnResult{}, nil
}

func TestResolveDispatchProvider(t *testing.T) {
	registry := agents.NewRegistry(nil)
	for _, p := range []agents.Provider{agents.ProviderClaude, agents.ProviderCodex, "CUSTOM"} {
		registry.SetRunner(p, &selectionRecordingRunner{})
	}
	for _, tc := range []struct {
		name, provider, assignee string
		want                     agents.Provider
		fail                     bool
	}{
		{"default", "", "", agents.ProviderClaude, false},
		{"template alias", " CLAUDE-code ", "", agents.ProviderClaude, false},
		{"task wins", "codex", "agent-claude", agents.ProviderCodex, false},
		{"agent alias", "", " Agent-Claude-Code ", agents.ProviderClaude, false},
		{"human assignee", "", "person-123", agents.ProviderClaude, false},
		{"configured custom", " custom ", "", "CUSTOM", false},
		{"unknown task", "antigravity", "agent-claude", "ANTIGRAVITY", true},
		{"unknown agent", "", "agent-unknown", "UNKNOWN", true},
		{"blank explicit", "   ", "agent-claude", "", true},
		{"empty agent", "", "agent-", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveDispatchProvider(registry, agents.ProviderClaude, orchestrator.RunningEntry{Provider: tc.provider, AssigneeID: tc.assignee})
			if got != tc.want || (err != nil) != tc.fail {
				t.Fatalf("got provider %q, error %v; want %q fail=%v", got, err, tc.want, tc.fail)
			}
		})
	}
	if _, err := resolveDispatchProvider(registry, "MISSING", orchestrator.RunningEntry{}); err == nil {
		t.Fatal("unconfigured default accepted")
	}
}

func TestExplicitProviderSurvivesRepeatedFailureAndRetryRelease(t *testing.T) {
	commands := map[string]string{
		"CODEX":       "codex app-server",
		"ANTIGRAVITY": "agy",
	}
	registry := agents.NewRegistry(commands)
	service := orchestrator.NewService()
	// The global default differs from the task's explicit selection.
	service.SetAgentRegistry(registry, commands, "ANTIGRAVITY")
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "task-2",
		IssueIdentifier: "ORCHESTRA-2",
		State:           "In Progress",
		AssigneeID:      "agent-CODEX",
		Provider:        "CODEX",
		TurnCount:       2,
	}})

	service.RecordRunFailure("task-2", "CODEX", "ORCHESTRA-2", 3, time.Now().UTC().Add(-time.Second), errors.New("invalid global Codex rules"))
	if err := service.PerformRefreshForClient(context.Background(), nil); err != nil {
		t.Fatalf("release retry: %v", err)
	}
	entry, ok := service.ClaimNextRunnable()
	if !ok {
		t.Fatal("retry was not released to the running queue")
	}
	if entry.Provider != "CODEX" {
		t.Fatalf("retry provider changed to %q; want frozen CODEX selection", entry.Provider)
	}
	got, err := resolveDispatchProvider(registry, agents.ProviderAntigravity, entry)
	if err != nil || got != agents.ProviderCodex {
		t.Fatalf("retry resolved to %q, err=%v; want CODEX", got, err)
	}
}

func TestProcessExecutionTickRejectsUnknownProviderBeforeEffects(t *testing.T) {
	for _, tc := range []struct{ name, provider, assignee string }{
		{"task", "antigravity", ""}, {"agent", "", "agent-unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			marker := filepath.Join(root, "hook-was-run")
			service := orchestrator.NewService()
			now := time.Now().UTC().Format(time.RFC3339)
			service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", Provider: tc.provider, AssigneeID: tc.assignee, StartedAt: now, LastEventAt: now}})
			registry := agents.NewRegistry(nil)
			runner := &selectionRecordingRunner{}
			registry.SetRunner(agents.ProviderClaude, runner)
			pubsub := observability.NewPubSub()
			ch, unsubscribe := pubsub.Subscribe(10)
			defer unsubscribe()
			processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderClaude, "claude", root, "", 0, nil, nil,
				workspace.Hooks{BeforeRun: "touch " + marker}, pubsub, nil, nil, nil, &config.Config{}, nil, zerolog.Nop())
			if runner.calls != 0 {
				t.Fatalf("default runner invoked %d times", runner.calls)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("workspace/hook effects: %v, %v", entries, err)
			}
			snapshot := service.Snapshot()
			if snapshot.Counts.Running != 0 || len(snapshot.Retrying) != 1 || !strings.Contains(snapshot.Retrying[0].Error, "selected agent provider") {
				t.Fatalf("selection rejection not recorded: %+v", snapshot)
			}
			select {
			case event := <-ch:
				data, ok := event.Data.(map[string]any)
				if event.Type != "RUN_FAILED" || !ok || data["cause"] != "provider_not_configured" {
					t.Fatalf("unexpected event %+v", event)
				}
			default:
				t.Fatal("missing explicit failure event")
			}
		})
	}
}

func TestProcessExecutionTickRejectsRequestedConfigBeforeWorkspaceEffects(t *testing.T) {
	for _, tc := range []struct {
		name, model string
		maxTurns    *int
	}{
		{"model", "requested-model", nil},
		{"one turn", "", selectionIntPointer(1)},
		{"many turns", "", selectionIntPointer(8)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, projectID, warehouse := testProjectSetup(t)
			project, err := warehouse.GetProjectByID(context.Background(), projectID)
			if err != nil {
				t.Fatal(err)
			}
			worktrees := func() string {
				t.Helper()
				output, err := exec.Command("git", "-C", project.RootPath, "worktree", "list", "--porcelain").CombinedOutput()
				if err != nil {
					t.Fatalf("worktree list: %s: %v", output, err)
				}
				return string(output)
			}
			before := worktrees()
			marker := filepath.Join(root, "hook-was-run")
			service := orchestrator.NewService()
			now := time.Now().UTC().Format(time.RFC3339)
			service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", ProjectID: projectID, Provider: "claude-code", RequestedModel: tc.model, RequestedMaxTurns: tc.maxTurns, StartedAt: now, LastEventAt: now}})
			registry := agents.NewRegistry(nil)
			runner := &selectionRecordingRunner{}
			registry.SetRunner(agents.ProviderClaude, runner)
			pubsub := observability.NewPubSub()
			ch, unsubscribe := pubsub.Subscribe(10)
			defer unsubscribe()
			processExecutionTick(service, workspace.Service{Root: root}, registry, agents.ProviderClaude, "claude", root, "", 0, nil, nil,
				workspace.Hooks{AfterCreate: "touch '" + marker + "'", BeforeRun: "touch '" + marker + "'"}, pubsub, warehouse, nil, nil, &config.Config{}, nil, zerolog.Nop())
			if runner.calls != 0 {
				t.Fatalf("runner invoked %d times", runner.calls)
			}
			if got := worktrees(); got != before {
				t.Fatalf("worktrees changed:\nbefore %s\nafter %s", before, got)
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatalf("hook marker exists or inaccessible: %v", err)
			}
			snapshot := service.Snapshot()
			if len(snapshot.Retrying) != 1 || !strings.Contains(snapshot.Retrying[0].Error, "not supported") {
				t.Fatalf("rejection not recorded: %+v", snapshot)
			}
			event := <-ch
			data, ok := event.Data.(map[string]any)
			if event.Type != "RUN_FAILED" || !ok || data["cause"] != "requested_config_unsupported" {
				t.Fatalf("unexpected event %+v", event)
			}
		})
	}
}

func TestDispatchRequestedOptionsCopiesMaxTurns(t *testing.T) {
	turns := 8
	entry := orchestrator.RunningEntry{RequestedModel: "requested", RequestedMaxTurns: &turns}
	request := dispatchRequestedOptions(entry)
	turns = 1
	if request.RequestedMaxTurns == nil || *request.RequestedMaxTurns != 8 || request.RequestedModel != "requested" || request.RuntimeTarget != agents.RuntimeLocal {
		t.Fatalf("incorrect request %+v", request)
	}
}

func selectionIntPointer(value int) *int { return &value }
