package prompt

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/workflow"
)

type BuildInput struct {
	Issue   tracker.Issue
	Attempt int64
}

func Build(workflowFile string, input BuildInput) (string, error) {
	doc, err := workflow.LoadFile(workflowFile)
	if err != nil {
		return "", fmt.Errorf("load workflow file: %w", err)
	}

	promptTemplate := strings.TrimSpace(doc.Prompt)
	if promptTemplate == "" {
		return "", fmt.Errorf("workflow prompt is empty")
	}

	tpl, err := template.New("workflow_prompt").Option("missingkey=error").Parse(promptTemplate)
	if err != nil {
		return "", fmt.Errorf("parse prompt template: %w", err)
	}

	ctx := map[string]any{
		"Attempt": input.Attempt,
		"attempt": input.Attempt,
		"Issue":   issueTemplateContext(input.Issue),
		"issue":   issueTemplateContext(input.Issue),
	}

	var out bytes.Buffer
	if err := tpl.Execute(&out, ctx); err != nil {
		return "", fmt.Errorf("render prompt template: %w", err)
	}

	return out.String(), nil
}

func issueTemplateContext(issue tracker.Issue) map[string]any {
	blockedBy := make([]map[string]any, 0, len(issue.BlockedBy))
	for _, blocker := range issue.BlockedBy {
		blockedBy = append(blockedBy, map[string]any{
			"ID":         blocker.ID,
			"id":         blocker.ID,
			"Identifier": blocker.Identifier,
			"identifier": blocker.Identifier,
			"State":      blocker.State,
			"state":      blocker.State,
		})
	}

	return map[string]any{
		"ID":                 issue.ID,
		"id":                 issue.ID,
		"Identifier":         issue.Identifier,
		"identifier":         issue.Identifier,
		"Title":              issue.Title,
		"title":              issue.Title,
		"Description":        issue.Description,
		"description":        issue.Description,
		"Priority":           issue.Priority,
		"priority":           issue.Priority,
		"State":              issue.State,
		"state":              issue.State,
		"BranchName":         issue.BranchName,
		"branch_name":        issue.BranchName,
		"URL":                issue.URL,
		"url":                issue.URL,
		"AssigneeID":         issue.AssigneeID,
		"assignee_id":        issue.AssigneeID,
		"AssignedToWorker":   issue.AssignedToWorker,
		"assigned_to_worker": issue.AssignedToWorker,
		"Labels":             append([]string(nil), issue.Labels...),
		"labels":             append([]string(nil), issue.Labels...),
		"BlockedBy":          blockedBy,
		"blocked_by":         blockedBy,
		"CreatedAt":          issue.CreatedAt,
		"created_at":         issue.CreatedAt,
		"UpdatedAt":          issue.UpdatedAt,
		"updated_at":         issue.UpdatedAt,
	}
}
