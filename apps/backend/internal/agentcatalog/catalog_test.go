package agentcatalog

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func testService(t *testing.T) (*Service, *db.DB, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	database, err := db.Connect(filepath.Join(t.TempDir(), "catalog.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	service, err := New(database, []string{home}, filepath.Join(home, "orchestra"))
	if err != nil {
		t.Fatal(err)
	}
	return service, database, home
}

func TestCatalogNativeOpenCodeDefinitionRoundTripAndReceipts(t *testing.T) {
	service, _, home := testService(t)
	content := "---\ndescription: Planner\nmode: primary\npermission:\n  edit: deny\ncustom: retained\n---\n\nPlan changes without editing.\n"
	requestID := uuid.NewString()
	mutation := MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "team/planner", RequestID: requestID, Format: "opencode-v1", Content: content}
	receipt, err := service.Mutate(context.Background(), mutation)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if receipt.Status != "completed" || receipt.ContentHash != contentHash([]byte(content)) {
		t.Fatalf("receipt: %#v", receipt)
	}
	path := filepath.Join(home, ".config", "opencode", "agents", "team", "planner.md")
	if got, err := os.ReadFile(path); err != nil || string(got) != content {
		t.Fatalf("native definition was not written exactly: %v", err)
	}
	cat, err := service.List(context.Background(), Request{ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal})
	if err != nil {
		t.Fatal(err)
	}
	if cat.SelectionCapability != SelectionUnavailable || len(cat.Items) != 1 {
		t.Fatalf("catalog did not report truthful unavailable selection: %#v", cat)
	}
	if cat.Items[0].ID != "team/planner" || cat.Items[0].AgentID != "team/planner" || cat.Items[0].Content != "" || cat.Items[0].SelectionStatus != SelectionUnavailable {
		t.Fatalf("unexpected metadata/list content: %#v", cat.Items[0])
	}
	loaded, err := service.Get(context.Background(), Request{ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal}, KindAgentDefinition, "team/planner")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Content != content || loaded.ContentHash != receipt.ContentHash {
		t.Fatalf("get did not preserve raw native content: %#v", loaded)
	}

	updated := strings.Replace(content, "Plan changes", "Review changes", 1)
	update := mutation
	update.Operation = "update"
	update.RequestID = uuid.NewString()
	update.ExpectedHash = receipt.ContentHash
	update.Content = updated
	updatedReceipt, err := service.Mutate(context.Background(), update)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updatedReceipt.ContentHash != contentHash([]byte(updated)) {
		t.Fatalf("updated hash: %#v", updatedReceipt)
	}
	// Replaying the same identity must not perform a second write.
	updatedAgain, err := service.Mutate(context.Background(), update)
	if err != nil || updatedAgain.ContentHash != updatedReceipt.ContentHash {
		t.Fatalf("idempotent replay: %#v, %v", updatedAgain, err)
	}
	conflict := update
	conflict.Content = content
	if _, err = service.Mutate(context.Background(), conflict); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed mutation replay should conflict, got %v", err)
	}
	stale := update
	stale.RequestID = uuid.NewString()
	stale.ExpectedHash = receipt.ContentHash
	if _, err = service.Mutate(context.Background(), stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update should conflict, got %v", err)
	}

	deleteRequest := MutationRequest{Operation: "delete", ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "team/planner", RequestID: uuid.NewString(), ExpectedHash: updatedReceipt.ContentHash}
	deleted, err := service.Mutate(context.Background(), deleteRequest)
	if err != nil || deleted.Status != "completed" {
		t.Fatalf("delete: %#v, %v", deleted, err)
	}
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("definition still exists after delete: %v", err)
	}
}

func TestCatalogRejectsPathTraversalAndUnallowlistedConfig(t *testing.T) {
	service, _, _ := testService(t)
	request := MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "../escape", RequestID: uuid.NewString(), Format: "opencode-v1", Content: "---\nmode: primary\n---\n\nNo.\n"}
	if _, err := service.Mutate(context.Background(), request); !errors.Is(err, ErrInvalid) {
		t.Fatalf("path traversal accepted: %v", err)
	}
	config := MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OPENCODE", Scope: ScopeGlobal, Kind: KindOrchestraConfig, ResourceID: "opencode.json", RequestID: uuid.NewString(), Content: "{}\n"}
	if _, err := service.Mutate(context.Background(), config); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unallowlisted config was accepted: %v", err)
	}
}

func TestAntigravityCatalogUsesNativeCLIPathsAndPreservesProfileRole(t *testing.T) {
	service, _, _ := testService(t)
	catalog, err := service.List(context.Background(), Request{ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeGlobal})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Harness != "ANTIGRAVITY" || catalog.Observation != "observed" || catalog.SelectionCapability != SelectionUnavailable || !catalog.Capabilities.Create || catalog.Capabilities.SelectPrimary || len(catalog.Items) != 0 {
		t.Fatalf("Antigravity authoring/discovery capability is wrong: %#v", catalog)
	}
	if _, err = service.List(context.Background(), Request{ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeProject}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("orchestrator project scope should fail closed: %v", err)
	}

	content := "---\nname: security-reviewer\ndescription: Security review profile\nsubagent: true\nmainAgent: false\nmodel: pro\ncustomPermission: preserve-me\n---\n\nReview code for security issues.\n"
	created, err := service.Mutate(context.Background(), MutationRequest{Operation: "create", ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "security-reviewer", RequestID: uuid.NewString(), Format: "antigravity-markdown", Content: content})
	if err != nil {
		t.Fatal(err)
	}
	wantProfile := filepath.Join(os.Getenv("USERPROFILE"), ".gemini", "config", "agents", "security-reviewer", "agent.md")
	if filepath.Clean(created.Path) != filepath.Clean(wantProfile) {
		t.Fatalf("profile was written outside documented AGY path: got %s want %s", created.Path, wantProfile)
	}
	got, err := service.Get(context.Background(), Request{ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeGlobal}, KindAgentDefinition, "security-reviewer")
	if err != nil {
		t.Fatal(err)
	}
	if got.Harness != "ANTIGRAVITY" || got.Content != content || got.Format != "antigravity-markdown" || got.Mode != "subagent" || got.SelectionStatus != SelectionConfiguredUnapplied || got.SelectableAsPrimary {
		t.Fatalf("profile identity, raw content, or role changed: %#v", got)
	}
	if _, err = service.Get(context.Background(), Request{ProjectID: "__orchestrator__", Harness: "GEMINI", Scope: ScopeGlobal}, KindAgentDefinition, "security-reviewer"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Antigravity profile appeared under legacy Gemini: %v", err)
	}

	skill := "---\nname: security-checklist\ndescription: Review guide\n---\n# Security checklist\n"
	_, err = service.Mutate(context.Background(), MutationRequest{Operation: "create", ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeGlobal, Kind: KindSkill, ResourceID: "security-checklist", RequestID: uuid.NewString(), Content: skill})
	if err != nil {
		t.Fatal(err)
	}
	gotSkill, err := service.Get(context.Background(), Request{ProjectID: "__orchestrator__", Harness: "ANTIGRAVITY", Scope: ScopeGlobal}, KindSkill, "security-checklist")
	if err != nil || gotSkill.Content != skill {
		t.Fatalf("global CLI skill missing or changed: %#v %v", gotSkill, err)
	}
}

func TestCatalogResolvesProjectResourcesToSelectedCheckout(t *testing.T) {
	service, database, home := testService(t)
	root := filepath.Join(home, "project")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "init", "-q", root).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", output, err)
	}
	projectID, err := database.UpsertProject(context.Background(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	content := "---\ndescription: Build\nmode: subagent\n---\n\nHelp build.\n"
	req := MutationRequest{Operation: "create", ProjectID: projectID, Harness: "OPENCODE", Scope: ScopeProject, Kind: KindAgentDefinition, ResourceID: "build", RequestID: uuid.NewString(), Format: "opencode-v2", Content: content}
	created, err := service.Mutate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, ".opencode", "agents", "build.md")
	if filepath.Clean(created.Path) != filepath.Clean(want) {
		t.Fatalf("path not bound to exact project checkout: %s", created.Path)
	}
	cat, err := service.List(context.Background(), Request{ProjectID: projectID, Harness: "OPENCODE", Scope: ScopeProject})
	if err != nil {
		t.Fatal(err)
	}
	if cat.Root != root || len(cat.Items) != 1 || cat.Items[0].SelectionStatus != "subagent_only" {
		t.Fatalf("project catalog scope/mode wrong: %#v", cat)
	}
}
