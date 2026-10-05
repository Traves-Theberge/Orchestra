package jira

import "testing"

func TestMapIssueExtractsCloudADFDescriptionAndNativeScope(t *testing.T) {
	issue := jiraIssue{ID: "10001", Key: "PROJ-1"}
	issue.Fields.Project.Key = "PROJ"
	issue.Fields.Description = map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "First line"}}},
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Second line"}}},
		},
	}

	item := mapIssue(issue, nil, "https://jira.example")
	if item.Description != "First line\nSecond line" {
		t.Fatalf("description: %q", item.Description)
	}
	if item.SourceID != "10001" || item.SourceProjectID != "PROJ" {
		t.Fatalf("native identities: %+v", item)
	}
}
