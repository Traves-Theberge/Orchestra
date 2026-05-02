package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

// newTestRouterWithDB creates a router backed by a real SQLite database in a
// temp directory. The caller gets back the HTTP handler and the raw *db.DB for
// seeding test data.
func newTestRouterWithDB(t *testing.T) (http.Handler, *db.DB) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, ".orchestra", "warehouse.db")

	warehouseDB, err := db.Connect(dbPath)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() { warehouseDB.Close() })

	cfg := &config.Config{
		WorkspaceRoot: tmpDir,
		Host:          "127.0.0.1",
		APIToken:      "",
		ProjectRoots:  []string{tmpDir, os.TempDir(), "/tmp"},
	}

	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, warehouseDB, nil, nil, nil)
	return router, warehouseDB
}

func TestGetProjects(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// The response is a JSON array (possibly null when no projects exist).
	var payload []any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response as array: %v", err)
	}

	if len(payload) != 0 {
		t.Fatalf("expected empty project list, got %d items", len(payload))
	}
}

func TestCreateProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	// Create a real directory to use as the project root.
	projDir := t.TempDir()

	body, _ := json.Marshal(map[string]string{"root_path": projDir})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	id, ok := payload["id"].(string)
	if !ok || id == "" {
		t.Fatalf("expected non-empty id string, got %v", payload["id"])
	}
}

func TestCreateProjectRejectsEmptyPath(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	body, _ := json.Marshal(map[string]string{"root_path": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	errObj, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error envelope, got %v", payload)
	}
	if errObj["code"] != "invalid_request" {
		t.Fatalf("expected invalid_request code, got %v", errObj["code"])
	}
}

func TestDeleteProjectReturns204(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	// Seed a project directly via the DB.
	projDir := t.TempDir()
	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/"+id, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectReturnsStats(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	// Seed a project.
	projDir := t.TempDir()
	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+id, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var stats map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Verify the expected stat fields exist.
	for _, key := range []string{"total_sessions", "total_input", "total_output", "last_active"} {
		if _, ok := stats[key]; !ok {
			t.Fatalf("missing expected key %q in stats response: %v", key, stats)
		}
	}
}
