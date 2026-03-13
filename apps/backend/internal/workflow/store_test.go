package workflow

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreCurrentAndForceReload(t *testing.T) {
	temp := t.TempDir()
	path := filepath.Join(temp, "WORKFLOW.md")

	initial := "---\nserver:\n  host: 127.0.0.1\n---\nPrompt A"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatalf("write initial workflow: %v", err)
	}

	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	if store.Current().Prompt != "Prompt A" {
		t.Fatalf("expected Prompt A, got %q", store.Current().Prompt)
	}

	next := "---\nserver:\n  host: 0.0.0.0\n---\nPrompt B"
	if err := os.WriteFile(path, []byte(next), 0o644); err != nil {
		t.Fatalf("write updated workflow: %v", err)
	}

	if err := store.ForceReload(); err != nil {
		t.Fatalf("force reload: %v", err)
	}

	if store.Current().Prompt != "Prompt B" {
		t.Fatalf("expected Prompt B after reload, got %q", store.Current().Prompt)
	}
}

func TestStoreSetPath(t *testing.T) {
	temp := t.TempDir()
	pathA := filepath.Join(temp, "WORKFLOW.md")
	pathB := filepath.Join(temp, "WORKFLOW-ALT.md")

	if err := os.WriteFile(pathA, []byte("---\n---\nPrompt A"), 0o644); err != nil {
		t.Fatalf("write path A workflow: %v", err)
	}
	if err := os.WriteFile(pathB, []byte("---\n---\nPrompt B"), 0o644); err != nil {
		t.Fatalf("write path B workflow: %v", err)
	}

	store, err := NewStore(pathA)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	if err := store.SetPath(pathB); err != nil {
		t.Fatalf("set path: %v", err)
	}

	if store.Path() != pathB {
		t.Fatalf("expected path B, got %q", store.Path())
	}
	if store.Current().Prompt != "Prompt B" {
		t.Fatalf("expected Prompt B, got %q", store.Current().Prompt)
	}
}
