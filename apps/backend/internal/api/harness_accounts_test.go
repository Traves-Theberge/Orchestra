package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestManagedAccountRoutesSelectWithVersionAndProtectRemoval(t *testing.T) {
	store, err := harnessaccounts.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	account, home, err := store.BeginCodex("Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Complete(account.ID); err != nil {
		t.Fatal(err)
	}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "test-token"}, nil, nil, nil, nil, nil, nil, nil, store)
	call := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var payload []byte
		if body != nil {
			payload, _ = json.Marshal(body)
		}
		request := httptest.NewRequest(method, path, bytes.NewReader(payload))
		request.Header.Set("Authorization", "Bearer test-token")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	if response := call(http.MethodGet, "/api/v1/agents/accounts", nil); response.Code != http.StatusOK || bytes.Contains(response.Body.Bytes(), []byte(home)) {
		t.Fatalf("accounts response = %d %s", response.Code, response.Body.String())
	}
	path := "/api/v1/agents/accounts/active/CODEX"
	if response := call(http.MethodPut, path, map[string]any{"account_id": account.ID, "version": 0}); response.Code != http.StatusOK {
		t.Fatalf("select = %d %s", response.Code, response.Body.String())
	}
	if response := call(http.MethodPut, path, map[string]any{"account_id": "", "version": 0}); response.Code != http.StatusConflict {
		t.Fatalf("stale switch = %d", response.Code)
	}
	if response := call(http.MethodDelete, "/api/v1/agents/accounts/"+account.ID, nil); response.Code != http.StatusConflict {
		t.Fatalf("deleted active account = %d", response.Code)
	}
	if response := call(http.MethodPut, path, map[string]any{"account_id": "", "version": 1}); response.Code != http.StatusOK {
		t.Fatalf("default = %d", response.Code)
	}
	if response := call(http.MethodDelete, "/api/v1/agents/accounts/"+account.ID, nil); response.Code != http.StatusNoContent {
		t.Fatalf("remove = %d %s", response.Code, response.Body.String())
	}
}

func TestManagedAccountListUsesEmptyArrays(t *testing.T) {
	store, err := harnessaccounts.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "test-token"}, nil, nil, nil, nil, nil, nil, nil, store)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/agents/accounts", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"accounts":[]`)) || !bytes.Contains(response.Body.Bytes(), []byte(`"selections":[]`)) {
		t.Fatalf("empty account list = %d %s", response.Code, response.Body.String())
	}
}
