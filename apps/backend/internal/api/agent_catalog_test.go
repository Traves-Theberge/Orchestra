package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestAgentCatalogHTTPRoundTripAndGlobalOnlyOrchestrator(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	workspaceRoot := filepath.Join(home, "workspace")
	if err = os.MkdirAll(workspaceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{WorkspaceRoot: workspaceRoot, APIToken: "catalog-token", ProjectRoots: []string{home}}
	service := orchestrator.NewService()
	service.SetDB(database)
	router := NewRouterWithPubSub(zerolog.Nop(), service, cfg, nil, database, nil, nil, nil, nil, nil)
	server := httptest.NewServer(router)
	defer server.Close()
	call := func(method, route string, body any) (int, []byte) {
		t.Helper()
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		req, e := http.NewRequest(method, server.URL+route, bytes.NewReader(raw))
		if e != nil {
			t.Fatal(e)
		}
		req.Header.Set("Authorization", "Bearer catalog-token")
		req.Header.Set("Content-Type", "application/json")
		resp, e := server.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		var out bytes.Buffer
		_, _ = out.ReadFrom(resp.Body)
		return resp.StatusCode, out.Bytes()
	}
	content := "---\ndescription: Safe planner\nmode: primary\npermission:\n  edit: deny\nunknown: retained\n---\n\nPlan only.\n"
	base := "/api/v1/projects/__orchestrator__/agent-catalog"
	resource := base + "/resource?" + url.Values{"harness": {"OPENCODE"}, "scope": {"global"}, "kind": {"agent_definition"}, "resource_id": {"team/planner"}}.Encode()
	id := uuid.NewString()
	status, raw := call(http.MethodPost, resource, map[string]any{"request_id": id, "content": content, "format": "opencode-v1"})
	var receipt map[string]any
	_ = json.Unmarshal(raw, &receipt)
	if status != http.StatusOK || receipt["status"] != "completed" {
		t.Fatalf("create response %d %s", status, raw)
	}
	status, raw = call(http.MethodGet, base+"?harness=OPENCODE&scope=global", nil)
	var catalog struct {
		ProjectID string `json:"project_id"`
		Scope     string `json:"scope"`
		Items     []struct {
			ID              string `json:"id"`
			AgentID         string `json:"agent_id"`
			Content         string `json:"content"`
			ContentHash     string `json:"content_hash"`
			SelectionStatus string `json:"selection_status"`
		} `json:"items"`
	}
	_ = json.Unmarshal(raw, &catalog)
	if status != http.StatusOK || catalog.ProjectID != "__orchestrator__" || catalog.Scope != "global" || len(catalog.Items) != 1 || catalog.Items[0].ID != "team/planner" || catalog.Items[0].AgentID != "harness:global:opencode:team/planner" || catalog.Items[0].Content != "" || catalog.Items[0].ContentHash == "" || catalog.Items[0].SelectionStatus == "primary_selectable" {
		t.Fatalf("catalog response %d %s", status, raw)
	}
	detailURL := base + "/resource?harness=OPENCODE&scope=global&kind=agent_definition&resource_id=team%2Fplanner"
	status, raw = call(http.MethodGet, detailURL, nil)
	var detail struct {
		Content string `json:"content"`
	}
	_ = json.Unmarshal(raw, &detail)
	if status != http.StatusOK || detail.Content != content {
		t.Fatalf("detail response %d %s", status, raw)
	}
	status, raw = call(http.MethodGet, base+"/resource?harness=OPENCODE&scope=project&workspace_id=abc&kind=agent_definition&resource_id=planner", nil)
	if status != http.StatusForbidden {
		t.Fatalf("orchestrator project scope should be forbidden, got %d %s", status, raw)
	}
	status, raw = call(http.MethodGet, base+"/receipts/"+id, nil)
	if status != http.StatusOK || !bytes.Contains(raw, []byte(`"status":"completed"`)) {
		t.Fatalf("receipt response %d %s", status, raw)
	}
	status, raw = call(http.MethodDelete, resource, map[string]any{"request_id": uuid.NewString(), "expected_hash": catalog.Items[0].ContentHash})
	if status != http.StatusOK {
		t.Fatalf("delete response %d %s", status, raw)
	}
}
