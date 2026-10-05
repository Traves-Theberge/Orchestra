package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/rs/zerolog"
)

func TestWorkspaceChatHTTPQueryScopesEveryOperation(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	base := t.TempDir()
	repo, child := filepath.Join(base, "repo"), filepath.Join(base, "child")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		c := exec.Command("git", args...)
		c.Dir = repo
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v %s %v", args, out, err)
		}
	}
	git("init")
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
	git("worktree", "add", "-b", "child", child)
	database, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(t.Context(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := workspace.ListProjectGitWorktrees(t.Context(), pid, repo, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	var childID string
	for _, row := range rows {
		if !row.Primary {
			childID = row.ID
			child = row.Path
		}
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, workspaceChatFixtureRunner{})
	chat, err := workspacechat.New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer chat.Close()
	rootChat, err := chat.Create(context.Background(), pid, "codex", "root")
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{WorkspaceRoot: base, Host: "127.0.0.1", APIToken: "fixture", ProjectRoots: []string{base}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, database, nil, nil, nil, nil, nil, chat)
	prefix := "/api/v1/projects/" + pid + "/chat"
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, prefix+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer fixture")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	out := call("POST", "/sessions?workspace_id="+childID, `{"provider":"CODEX","title":"child"}`)
	if out.Code != 201 {
		t.Fatalf("child create %d %s", out.Code, out.Body.String())
	}
	var created workspacechat.Session
	if err = json.Unmarshal(out.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.WorkspaceID != childID || created.WorkspacePath != child {
		t.Fatalf("wrong HTTP scope %+v", created)
	}
	out = call("GET", "/sessions?workspace_id="+childID, "")
	if out.Code != 200 || strings.Contains(out.Body.String(), rootChat.ID) || !strings.Contains(out.Body.String(), created.ID) {
		t.Fatalf("child list %d %s", out.Code, out.Body.String())
	}
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/providers", ""},
		{"GET", "/providers/CODEX/models", ""},
		{"GET", "/sessions", ""},
		{"POST", "/sessions", `{"provider":"CODEX"}`},
		{"GET", "/sessions/" + created.ID, ""},
		{"POST", "/sessions/" + created.ID + "/messages", `{"client_message_id":"one","text":"hello"}`},
		{"POST", "/sessions/" + created.ID + "/stop", `{}`},
		{"POST", "/sessions/" + created.ID + "/requests/request/reply", `{"client_response_id":"one","answer":{}}`},
	} {
		out = call(tc.method, tc.path+"?workspace_id=stale", tc.body)
		if out.Code != 403 {
			t.Fatalf("%s %s ignored scope: %d %s", tc.method, tc.path, out.Code, out.Body.String())
		}
	}
	out = call("GET", "/sessions/"+created.ID, "")
	if out.Code != 404 {
		t.Fatalf("root read child %d %s", out.Code, out.Body.String())
	}
}

func TestWorkspaceChatCreationModelPreferencesHTTP(t *testing.T) {
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(t.Context(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, workspaceChatFixtureRunner{})
	chat, err := workspacechat.New(database, httpNativeRegistry{registry}, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer chat.Close()
	cfg := &config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "fixture", ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, database, nil, nil, nil, nil, nil, chat)
	call := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("POST", "/api/v1/projects/"+pid+"/chat/sessions", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer fixture")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	body := `{"provider":"CODEX","client_session_id":"81786349-a124-4d84-8be8-9f9536319ad7","requested_model":"fixture-model"}`
	out := call(body)
	if out.Code != 201 {
		t.Fatalf("preference creation %d %s", out.Code, out.Body.String())
	}
	var session workspacechat.Session
	if err = json.Unmarshal(out.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.RequestedModel != "fixture-model" || session.EffectiveModel != "" || session.ProviderThreadID != "" {
		t.Fatalf("incorrect preference DTO %+v", session)
	}
	if out = call(body); out.Code != 201 {
		t.Fatalf("same creation %d %s", out.Code, out.Body.String())
	}
	if out = call(strings.ReplaceAll(body, "fixture-model", "different-model")); out.Code != 409 {
		t.Fatalf("changed identity %d %s", out.Code, out.Body.String())
	}
	if out = call(`{"provider":"CODEX","requested_model":"fixture-model","requested_reasoning_effort":"high"}`); out.Code != 422 {
		t.Fatalf("unadvertised effort %d %s", out.Code, out.Body.String())
	}
	var messages int
	if err = database.QueryRow("SELECT COUNT(*) FROM workspace_chat_messages").Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if messages != 0 {
		t.Fatalf("creation sent a message: %d", messages)
	}
}
