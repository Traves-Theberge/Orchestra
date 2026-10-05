package api

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestEmbeddedOpenAPISpecMatchesRepositorySource(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "openapi.yaml"))
	if err != nil {
		t.Fatalf("read source OpenAPI spec: %v", err)
	}
	if !bytes.Equal(openAPISpec, source) {
		t.Fatal("embedded API spec differs from docs/openapi.yaml")
	}
}

func TestOpenAPIWorkItemIdentityScopesAreDocumented(t *testing.T) {
	var document struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]struct {
					Description string `yaml:"description"`
				} `yaml:"properties"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(openAPISpec, &document); err != nil {
		t.Fatalf("parse OpenAPI identity schema: %v", err)
	}
	workItem, ok := document.Components.Schemas["WorkItem"]
	if !ok {
		t.Fatal("OpenAPI schemas missing WorkItem")
	}
	for _, field := range []string{"id", "source_id", "source_project_id", "project_id"} {
		if strings.TrimSpace(workItem.Properties[field].Description) == "" {
			t.Errorf("WorkItem.%s must distinguish its identity scope", field)
		}
	}
}

func TestOpenAPILifecycleAndAgentCatalogRoutesParse(t *testing.T) {
	var document struct {
		OpenAPI string                          `yaml:"openapi"`
		Paths   map[string]map[string]yaml.Node `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &document); err != nil {
		t.Fatalf("parse embedded OpenAPI document: %v", err)
	}
	if document.OpenAPI != "3.0.3" {
		t.Fatalf("unexpected OpenAPI version %q", document.OpenAPI)
	}
	want := map[string][]string{
		"/api/v1/projects/{project_id}/agent-catalog":                        {"get"},
		"/api/v1/projects/{project_id}/agent-catalog/resource":               {"get", "post", "put", "delete"},
		"/api/v1/projects/{project_id}/agent-catalog/receipts/{request_id}":  {"get"},
		"/api/v1/projects/{project_id}/git/worktrees/{workspace_id}":         {"delete"},
		"/api/v1/projects/{project_id}/worktree-removals/{request_id}":       {"get"},
		"/api/v1/projects/{project_id}/chat/archives":                        {"get"},
		"/api/v1/projects/{project_id}/chat/sessions/{session_id}/archive":   {"post"},
		"/api/v1/projects/{project_id}/chat/sessions/{session_id}/unarchive": {"post"},
		"/api/v1/projects/{project_id}/chat/sessions/{session_id}/history":   {"get"},
	}
	for path, methods := range want {
		operations, ok := document.Paths[path]
		if !ok {
			t.Errorf("OpenAPI paths missing implemented route %s", path)
			continue
		}
		for _, method := range methods {
			if _, ok := operations[method]; !ok {
				t.Errorf("OpenAPI route %s missing method %s", path, method)
			}
		}
	}
}
