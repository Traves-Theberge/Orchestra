package agentcatalog

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// omp agents live in ~/.omp/agent/agents (global) and .omp/agents (project);
// the catalog reports "omp-markdown" and must accept that format back on
// update (both format checks: targetPath and validateNativeContent).
func TestOMPCatalogRoundTripsAgentsAndListsSkills(t *testing.T) {
	_, database, home := testService(t)
	service, err := New(database, []string{home}, filepath.Join(home, "orchestra"), map[string]string{"OMP": "omp -p --mode json {{prompt}}"})
	if err != nil {
		t.Fatal(err)
	}
	content := "---\nname: scout\ndescription: Finds code\ntools:\n  - read\n---\n\nYou scout.\n"
	created, err := service.Mutate(context.Background(), MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OMP", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "scout", RequestID: uuid.NewString(), Format: "omp-markdown", Content: content})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if want := filepath.Join(home, ".omp", "agent", "agents", "scout.md"); filepath.Clean(created.Path) != want {
		t.Fatalf("created at %q, want %q", created.Path, want)
	}
	skill := filepath.Join(home, ".omp", "agent", "skills", "lint")
	if err = os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("---\nname: lint\ndescription: d\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(home, ".omp", "agent", "skills", "loose.md"), []byte("not a skill\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cat, err := service.List(context.Background(), Request{ProjectID: "fixture", Harness: "OMP", Scope: ScopeGlobal})
	if err != nil || cat.Observation != "observed" || !cat.Capabilities.Create {
		t.Fatalf("catalog %#v, %v", cat, err)
	}
	var agent, skillItem *Item
	for i := range cat.Items {
		switch cat.Items[i].Kind {
		case KindAgentDefinition:
			agent = &cat.Items[i]
		case KindSkill:
			if skillItem != nil {
				t.Fatalf("only SKILL.md directories are omp skills: %#v", cat.Items)
			}
			skillItem = &cat.Items[i]
		}
	}
	if agent == nil || agent.Format != "omp-markdown" || agent.Name != "scout" || agent.SelectionStatus != SelectionSelectablePrimary {
		t.Fatalf("agent item %#v", agent)
	}
	if skillItem == nil || skillItem.ID != "lint" {
		t.Fatalf("skill item %#v", skillItem)
	}
	if _, err = service.Mutate(context.Background(), MutationRequest{Operation: "update", ProjectID: "fixture", Harness: "OMP", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "scout", RequestID: uuid.NewString(), ExpectedHash: created.ContentHash, Format: agent.Format, Content: content + "More.\n"}); err != nil {
		t.Fatalf("update with listed format: %v", err)
	}
	for _, bad := range []string{"---\nname: x\n---\nNo description.\n", "No frontmatter.\n"} {
		if _, err = service.Mutate(context.Background(), MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OMP", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "bad", RequestID: uuid.NewString(), Format: "omp-markdown", Content: bad}); err == nil {
			t.Fatalf("invalid omp agent accepted: %q", bad)
		}
	}
	if _, err = service.Mutate(context.Background(), MutationRequest{Operation: "create", ProjectID: "fixture", Harness: "OMP", Scope: ScopeGlobal, Kind: KindAgentDefinition, ResourceID: "other", RequestID: uuid.NewString(), Format: "opencode-markdown", Content: content}); err == nil {
		t.Fatal("another harness's format was accepted for omp")
	}
}
