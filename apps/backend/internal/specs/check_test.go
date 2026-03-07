package specs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckPassesForValidWorkflow(t *testing.T) {
	temp := t.TempDir()
	workflowPath := filepath.Join(temp, "WORKFLOW.md")
	content := "---\nagent:\n  provider: codex\n---\nImplement {{ .Issue.Identifier }}"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	t.Setenv("ORCHESTRA_WORKFLOW_FILE", workflowPath)

	if err := Check(); err != nil {
		t.Fatalf("expected check success, got %v", err)
	}
}

func TestCheckFailsForEmptyPrompt(t *testing.T) {
	temp := t.TempDir()
	workflowPath := filepath.Join(temp, "WORKFLOW.md")
	content := "---\nagent:\n  provider: codex\n---\n"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	t.Setenv("ORCHESTRA_WORKFLOW_FILE", workflowPath)

	if err := Check(); err == nil {
		t.Fatalf("expected check failure for empty prompt")
	}
}

func TestCheckFailsWhenProviderCommandMissing(t *testing.T) {
	temp := t.TempDir()
	workflowPath := filepath.Join(temp, "WORKFLOW.md")
	content := "---\nagent:\n  provider: mystery\n---\nPrompt"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	t.Setenv("ORCHESTRA_WORKFLOW_FILE", workflowPath)

	err := Check()
	if err == nil {
		t.Fatalf("expected check failure for missing provider command")
	}
	if !strings.Contains(err.Error(), "agent command missing for provider mystery") {
		t.Fatalf("unexpected check error: %v", err)
	}
}
