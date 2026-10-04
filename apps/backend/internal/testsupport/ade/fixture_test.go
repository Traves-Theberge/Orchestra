package ade

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func fixture(t *testing.T) *Fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f, err := NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.Close(); err != nil {
			t.Error(err)
		}
	})
	return f
}

func TestRecordingTurnChangesOnlyTaskWorktreeAndRunsRealCheck(t *testing.T) {
	f := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if _, err := f.Command(ctx, f.Manifest.Worktree, "go", "test", "./..."); err == nil {
		t.Fatal("baseline broken check unexpectedly passed")
	}
	req := agents.TurnRequest{SessionID: "session-1", Workspace: f.Manifest.Worktree, WorkspaceRoot: filepath.Dir(f.Manifest.Worktree), IssueIdentifier: "ADE-1", Prompt: "Implement Answer", Attempt: 2, AutoApprove: false, ToolSpecs: []map[string]any{{"name": "inspect", "schema": map[string]any{"type": "object"}}}, RuntimeTarget: agents.RuntimeLocal}
	var toolSeen bool
	req.ToolExecutor = func(ctx context.Context, name string, args map[string]any) map[string]any {
		toolSeen = name == "inspect" && args["path"] == "answer.go"
		return map[string]any{"ok": true}
	}
	r := NewRecordingRunner(f, Step{Tool: "inspect", Arguments: map[string]any{"path": "answer.go"}}, Step{WritePath: "answer.go", WriteContent: "package fixture\n\nfunc Answer() int { return 42 }\n"}, Step{Check: true}, Step{Event: &agents.Event{Kind: "turn_completed", Message: "verified", Usage: agents.TokenUsage{TotalTokens: 9}}})
	registry := agents.NewRegistry(nil)
	registry.SetRunner("ADE_FIXTURE", r)
	var events []agents.Event
	result, err := registry.RunTurn(ctx, "ADE_FIXTURE", req, func(e agents.Event) { events = append(events, e) })
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 0 || !toolSeen || len(events) != 2 || result.Usage.TotalTokens != 9 {
		t.Fatalf("result %+v, events %+v, tool %v", result, events, toolSeen)
	}
	calls := r.Invocations()
	if len(calls) != 1 || calls[0].Request.Prompt != req.Prompt || calls[0].Request.Attempt != 2 || calls[0].Request.AutoApprove || calls[0].Request.ToolExecutor == nil || !strings.Contains(calls[0].CheckOutput, "ok") {
		t.Fatalf("recording: %+v", calls)
	}
	req.ToolSpecs[0]["schema"].(map[string]any)["type"] = "changed"
	if r.Invocations()[0].Request.ToolSpecs[0]["schema"].(map[string]any)["type"] != "object" {
		t.Fatal("request snapshot was mutated")
	}
	for _, dir := range []string{f.Manifest.Repository, f.Manifest.Worktree} {
		status, err := f.Git(ctx, dir, "status", "--porcelain")
		if err != nil {
			t.Fatal(err)
		}
		if dir == f.Manifest.Repository && status != "" {
			t.Fatalf("project root modified: %q", status)
		}
		if dir == f.Manifest.Worktree && !strings.Contains(status, "answer.go") {
			t.Fatalf("missing actual diff: %q", status)
		}
	}
	remote, err := f.Git(ctx, f.Manifest.Root, "--git-dir", f.Manifest.Remote, "show", "main:answer.go")
	if err != nil || !strings.Contains(remote, "return 0") {
		t.Fatalf("remote baseline changed: %s %v", remote, err)
	}
}

func TestFixtureChildEnvironmentDoesNotInheritHomeCredentialsOrGitOverrides(t *testing.T) {
	t.Setenv("GH_TOKEN", "developer-secret")
	t.Setenv("GIT_DIR", "outside-repo")
	t.Setenv("GIT_CONFIG_COUNT", "1")
	t.Setenv("GOFLAGS", "-bad-flag")
	f := fixture(t)
	values := map[string]string{}
	for _, entry := range f.Env() {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	for _, key := range []string{"GH_TOKEN", "GIT_DIR", "GIT_CONFIG_COUNT", "GOFLAGS"} {
		if _, ok := values[key]; ok {
			t.Fatalf("inherited %s", key)
		}
	}
	if values["HOME"] != f.Manifest.Home || values["USERPROFILE"] != f.Manifest.Home || values["GIT_CONFIG_NOSYSTEM"] != "1" {
		t.Fatalf("bad isolated environment")
	}
	if err := os.WriteFile(filepath.Join(values["USERPROFILE"], "provider-settings.json"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := f.CheckOwned(filepath.Join(values["HOME"], "provider-settings.json")); err != nil {
		t.Fatal(err)
	}
}

func TestCancellationAndFailureDoNotFabricateCompletion(t *testing.T) {
	f := fixture(t)
	req := agents.TurnRequest{Workspace: f.Manifest.Worktree, SessionID: "cancel-session"}
	r := NewRecordingRunner(f, Step{Delay: time.Second}, Step{WritePath: "late.txt", WriteContent: "late"}, Step{Event: &agents.Event{Kind: "turn_completed"}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var events []agents.Event
	result, err := r.RunTurn(ctx, req, func(e agents.Event) { events = append(events, e) })
	if !errors.Is(err, context.Canceled) || result.ExitCode == 0 || len(events) != 0 {
		t.Fatalf("cancellation: %+v %v %+v", result, err, events)
	}
	if _, err := os.Stat(filepath.Join(req.Workspace, "late.txt")); !os.IsNotExist(err) {
		t.Fatal("cancelled turn edited file")
	}
	ctx, cancel = context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := r.RunTurn(ctx, req, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("delay cancellation: %v", err)
	}
	failure := errors.New("scripted provider failure")
	failed := NewRecordingRunner(f, Step{Failure: failure}, Step{Event: &agents.Event{Kind: "turn_completed"}})
	if _, err := failed.RunTurn(context.Background(), req, nil); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if failed.Invocations()[0].Error != failure.Error() {
		t.Fatal("failure not recorded")
	}
}

func TestWritesRejectTraversalAndSymlinkEscape(t *testing.T) {
	f := fixture(t)
	req := agents.TurnRequest{Workspace: f.Manifest.Worktree}
	for _, path := range []string{"../escaped.txt", f.Manifest.Repository, ".git"} {
		r := NewRecordingRunner(f, Step{WritePath: path, WriteContent: "bad"})
		if _, err := r.RunTurn(context.Background(), req, nil); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	outside := t.TempDir()
	link := filepath.Join(f.Manifest.Worktree, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Logf("symlink privilege unavailable: %v; traversal checks passed", err)
		return
	}
	r := NewRecordingRunner(f, Step{WritePath: "escape/nested/secret.txt", WriteContent: "bad"})
	if _, err := r.RunTurn(context.Background(), req, nil); err == nil {
		t.Fatal("accepted symlink escape")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("outside modified: %v %v", entries, err)
	}
}

func TestCleanupUsesPrivateOwnershipAndRejectsManifestMismatch(t *testing.T) {
	f := fixture(t)
	root := f.Manifest.Root
	manifestPath := filepath.Join(root, "ownership.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Manifest.Root = t.TempDir() // Public metadata cannot redirect cleanup.
	if err := os.WriteFile(manifestPath, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err == nil {
		t.Fatal("cleanup accepted changed ownership")
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal("refused cleanup deleted root")
	}
	if err := os.WriteFile(manifestPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("owned root not removed")
	}
	if err := f.Close(); err != nil {
		t.Fatal("cleanup not idempotent")
	}
}

func TestFixturesHaveIndependentHomesAndGitRoots(t *testing.T) {
	a, b := fixture(t), fixture(t)
	if reflect.DeepEqual(a.Manifest, b.Manifest) || a.Manifest.Root == b.Manifest.Root || a.Manifest.ID == b.Manifest.ID {
		t.Fatal("shared ownership")
	}
	if err := a.CheckOwned(b.Manifest.Worktree); err == nil {
		t.Fatal("accepted another fixture")
	}
	r := NewRecordingRunner(a, Step{WritePath: "answer.go", WriteContent: "bad"})
	if _, err := r.RunTurn(context.Background(), agents.TurnRequest{Workspace: b.Manifest.Worktree}, nil); err == nil {
		t.Fatal("runner accepted another fixture")
	}
}

func TestRequestSnapshotPreservesTypedSchemaArrays(t *testing.T) {
	input := agents.TurnRequest{ToolSpecs: []map[string]any{{"enum": []string{"a", "b"}, "nested": []map[string]any{{"value": 1}}}}}
	copy := cloneRequest(input)
	input.ToolSpecs[0]["enum"].([]string)[0] = "changed"
	input.ToolSpecs[0]["nested"].([]map[string]any)[0]["value"] = 2
	if copy.ToolSpecs[0]["enum"].([]string)[0] != "a" || copy.ToolSpecs[0]["nested"].([]map[string]any)[0]["value"] != 1 {
		t.Fatal("typed arrays share mutable data")
	}
}
