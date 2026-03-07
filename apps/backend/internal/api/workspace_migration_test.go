package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestPostWorkspaceMigrateDryRun(t *testing.T) {
	temp := t.TempDir()
	from := filepath.Join(temp, "orchestra_workspaces_prev")
	to := filepath.Join(temp, "orchestra_workspaces")

	if err := os.MkdirAll(filepath.Join(from, "MT-1"), 0o755); err != nil {
		t.Fatalf("mkdir old root: %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"from":    from,
		"to":      to,
		"dry_run": true,
	})

	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), to, "127.0.0.1", "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/migrate", bytes.NewReader(body))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["dry_run"] != true {
		t.Fatalf("expected dry_run true, got %v", payload["dry_run"])
	}

	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	if result["applied"] != false {
		t.Fatalf("expected dry-run migration to be unapplied")
	}

	assertWorkspaceMigrationFixtureShape(t, payload)
	assertResponseMatchesSchema(t, res.Body.Bytes(), "workspace.migrate.response.schema.json")
}

func TestPostWorkspaceMigrateApply(t *testing.T) {
	temp := t.TempDir()
	from := filepath.Join(temp, "orchestra_workspaces_prev")
	to := filepath.Join(temp, "orchestra_workspaces")

	if err := os.MkdirAll(filepath.Join(from, "MT-2"), 0o755); err != nil {
		t.Fatalf("mkdir old root: %v", err)
	}

	dryRun := false
	body, _ := json.Marshal(map[string]any{
		"from":    from,
		"to":      to,
		"dry_run": dryRun,
	})

	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), to, "127.0.0.1", "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/migrate", bytes.NewReader(body))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.Code)
	}

	if _, err := os.Stat(filepath.Join(to, "MT-2")); err != nil {
		t.Fatalf("expected workspace migrated to new root: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["dry_run"] != false {
		t.Fatalf("expected dry_run false, got %v", payload["dry_run"])
	}

	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	if result["applied"] != true {
		t.Fatalf("expected applied true for non-dry-run migration")
	}

	assertWorkspaceMigrationFixtureShape(t, payload)
	assertResponseMatchesSchema(t, res.Body.Bytes(), "workspace.migrate.response.schema.json")
}

func assertWorkspaceMigrationFixtureShape(t *testing.T, payload map[string]any) {
	t.Helper()
	fixture := decodeFixtureMap(t, "workspace.migrate.response.json")
	assertShape(t, payload, fixture)
}
