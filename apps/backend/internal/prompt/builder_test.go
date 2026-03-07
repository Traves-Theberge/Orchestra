package prompt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

func TestBuildRendersWorkflowPromptTemplate(t *testing.T) {
	workflowPath := filepath.Join(t.TempDir(), "WORKFLOW.md")
	content := "---\nserver:\n  host: 127.0.0.1\n---\nIssue {{ .Issue.Identifier }} / {{ .Issue.Title }} / attempt={{ .Attempt }}"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	prompt, err := Build(workflowPath, BuildInput{Issue: tracker.Issue{ID: "1", Identifier: "ORC-9", Title: "Fix bug", State: "Todo"}, Attempt: 2})
	if err != nil {
		t.Fatalf("build prompt: %v", err)
	}

	if !strings.Contains(prompt, "Issue ORC-9 / Fix bug / attempt=2") {
		t.Fatalf("unexpected prompt output: %q", prompt)
	}
}

func TestBuildFailsWhenTemplateMissingField(t *testing.T) {
	workflowPath := filepath.Join(t.TempDir(), "WORKFLOW.md")
	content := "---\n---\nIssue {{ .Issue.DoesNotExist }}"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	_, err := Build(workflowPath, BuildInput{Issue: tracker.Issue{ID: "1", Identifier: "ORC-10", Title: "Fix bug", State: "Todo"}, Attempt: 1})
	if err == nil {
		t.Fatalf("expected template error for missing key")
	}
}

func TestBuildSupportsLowercaseLiquidStyleKeysAndIssueParityFields(t *testing.T) {
	workflowPath := filepath.Join(t.TempDir(), "WORKFLOW.md")
	content := "---\n---\nIssue {{ .issue.identifier }} assignee={{ .issue.assignee_id }} assigned={{ .issue.assigned_to_worker }} blocker={{ (index .issue.blocked_by 0).id }} blocker_ident={{ (index .issue.blocked_by 0).identifier }} labels={{ len .issue.labels }} priority={{ .issue.priority }} branch={{ .issue.branch_name }}"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	prompt, err := Build(workflowPath, BuildInput{Issue: tracker.Issue{
		ID:               "1",
		Identifier:       "ORC-11",
		Title:            "Fix bug",
		State:            "Todo",
		Priority:         2,
		BranchName:       "orc-11-fix-bug",
		AssigneeID:       "user-1",
		AssignedToWorker: true,
		Labels:           []string{"backend", "urgent"},
		BlockedBy:        []tracker.Blocker{{ID: "B-1", Identifier: "ORC-B1", State: "In Progress"}},
	}, Attempt: 1})
	if err != nil {
		t.Fatalf("build prompt: %v", err)
	}

	if !strings.Contains(prompt, "Issue ORC-11 assignee=user-1 assigned=true blocker=B-1 blocker_ident=ORC-B1 labels=2 priority=2 branch=orc-11-fix-bug") {
		t.Fatalf("unexpected prompt output: %q", prompt)
	}
}

func TestBuildFailsWhenWorkflowPromptIsEmpty(t *testing.T) {
	workflowPath := filepath.Join(t.TempDir(), "WORKFLOW.md")
	content := "---\n---\n"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	_, err := Build(workflowPath, BuildInput{Issue: tracker.Issue{Identifier: "ORC-12"}, Attempt: 1})
	if err == nil {
		t.Fatalf("expected empty workflow prompt error")
	}
}

func TestBuildFailsWhenWorkflowFileMissing(t *testing.T) {
	_, err := Build(filepath.Join(t.TempDir(), "missing.md"), BuildInput{Issue: tracker.Issue{Identifier: "ORC-13"}, Attempt: 1})
	if err == nil {
		t.Fatalf("expected missing workflow file error")
	}
}
