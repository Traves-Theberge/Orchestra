package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestHarnessSetupReportsIndependentHostObservations(t *testing.T) {
	orch := orchestrator.NewService()
	orch.SetAgentRegistry(nil, map[string]string{"CODEX": "codex exec {{prompt}}"}, "CODEX")
	router := NewRouter(zerolog.Nop(), orch, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "test-token"})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/agents/setup", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Harnesses []struct {
			ID                string `json:"id"`
			Registered        bool   `json:"registered"`
			CommandConfigured bool   `json:"command_configured"`
			Installation      string `json:"installation"`
			Authentication    string `json:"authentication"`
			TerminalSupported bool   `json:"terminal_supported"`
		} `json:"harnesses"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Harnesses) != 5 {
		t.Fatalf("harnesses = %d, want 5", len(payload.Harnesses))
	}
	codex := payload.Harnesses[0]
	if codex.ID != "CODEX" || !codex.Registered || !codex.CommandConfigured {
		t.Fatalf("Codex registration: %+v", codex)
	}
	if codex.Installation != "detected" && codex.Installation != "missing" {
		t.Fatalf("invalid installation observation: %+v", codex)
	}
	if codex.Authentication != "signed_in" && codex.Authentication != "signed_out" && codex.Authentication != "unknown" {
		t.Fatalf("invalid authentication observation: %+v", codex)
	}
	if runtime.GOOS == "windows" && codex.TerminalSupported {
		t.Fatal("Windows backend was advertised as having an interactive PTY")
	}
	for _, row := range payload.Harnesses[1:] {
		if row.ID != "CLAUDE" && row.Authentication != "unknown" {
			t.Fatalf("unsupported auth probe claimed sign-in: %+v", row)
		}
	}
}

func TestCodexDeviceLoginDoesNotExposeAnotherAttempt(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "test-token"})
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		request := httptest.NewRequest(method, "/api/v1/agents/setup/codex/device-login/not-this-host", nil)
		request.Header.Set("Authorization", "Bearer test-token")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d: %s", method, response.Code, response.Body.String())
		}
	}
}
