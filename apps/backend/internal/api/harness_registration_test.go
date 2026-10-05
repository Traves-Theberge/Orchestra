package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestHarnessRegistrationRoute(t *testing.T) {
	warehouse, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	service := orchestrator.NewService()
	service.SetDB(warehouse)
	commands := map[string]string{"CODEX": "codex exec {{prompt}}", "CLAUDE": "claude -p {{prompt}}"}
	registry := agents.NewRegistry(commands)
	service.SetAgentRegistry(registry, commands, "CODEX")
	router := NewRouter(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1"})
	call := func(provider, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/agents/"+provider+"/registration", bytes.NewBufferString(body))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	if got := call("CLAUDE", `{"registered":false,"expected_version":0}`); got.Code != http.StatusOK {
		t.Fatalf("unregister: %d %s", got.Code, got.Body.String())
	}
	if registry.HasProvider(agents.ProviderClaude) {
		t.Fatal("unregistered harness still available")
	}
	if got := call("CLAUDE", `{"registered":true,"expected_version":0}`); got.Code != http.StatusConflict {
		t.Fatalf("stale registration: %d", got.Code)
	}
	if got := call("CODEX", `{"registered":false,"expected_version":0}`); got.Code != http.StatusBadRequest {
		t.Fatalf("default unregister: %d", got.Code)
	}
	if got := call("GEMINI", `{"registered":true,"expected_version":0}`); got.Code != http.StatusBadRequest {
		t.Fatalf("retired harness: %d", got.Code)
	}
	if got := call("CLAUDE", `{"registered":true,"expected_version":1}`); got.Code != http.StatusOK {
		t.Fatalf("register: %d %s", got.Code, got.Body.String())
	}
	if !registry.HasProvider(agents.ProviderClaude) {
		t.Fatal("registered harness unavailable")
	}
	if got := call("CLAUDE", `{"registered":true}`); got.Code != http.StatusBadRequest || !strings.Contains(got.Body.String(), "expected_version") {
		t.Fatalf("missing version: %d %s", got.Code, got.Body.String())
	}
}
