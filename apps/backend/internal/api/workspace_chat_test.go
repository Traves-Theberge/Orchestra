package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/rs/zerolog"
)

type workspaceChatFixtureRunner struct{}

func (workspaceChatFixtureRunner) RunTurn(context.Context, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error) {
	return agents.TurnResult{Output: `{"result":"Fixture reply"}`}, nil
}

type httpNativeRegistry struct{ *agents.Registry }

func (httpNativeRegistry) NativeModels(context.Context, agents.Provider, agents.TurnRequest) ([]agents.NativeModel, error) {
	return []agents.NativeModel{{ID: "fixture-id", Model: "fixture-model", DisplayName: "Fixture"}}, nil
}

func (httpNativeRegistry) SupportsNativeSession(p agents.Provider) bool {
	return p == agents.ProviderCodex
}
func (httpNativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, _ agents.TurnRequest, _ string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	return &httpNativeSession{h: h, done: make(chan struct{})}, nil
}

type httpNativeSession struct {
	h    agents.NativeEventHandler
	done chan struct{}
	once sync.Once
}

const httpRequestID = `"provider/percent%3A +?"`

func (n *httpNativeSession) ThreadID() string { return "http-thread" }
func (n *httpNativeSession) ModelInfo() agents.NativeModelInfo {
	return agents.NativeModelInfo{Model: "fixture-model"}
}
func (n *httpNativeSession) SendTurn(ctx context.Context, _, _ string) (agents.NativeTurnResult, error) {
	n.h(agents.NativeEvent{Type: "server_request", TurnID: "turn", RequestID: httpRequestID, Payload: json.RawMessage(`{"method":"item/tool/requestUserInput","params":{"questions":[{"id":"choice","question":"Choose"}]}}`)})
	select {
	case <-n.done:
		return agents.NativeTurnResult{Status: "completed", Text: "answered"}, nil
	case <-ctx.Done():
		return agents.NativeTurnResult{}, ctx.Err()
	}
}
func (n *httpNativeSession) RespondRequest(_ context.Context, id string, _ json.RawMessage) error {
	if id != httpRequestID {
		return workspacechat.ErrInvalid
	}
	n.once.Do(func() { close(n.done) })
	return nil
}
func (n *httpNativeSession) Interrupt(context.Context) error {
	n.once.Do(func() { close(n.done) })
	return nil
}
func (n *httpNativeSession) Close() error { n.once.Do(func() { close(n.done) }); return nil }
func TestWorkspaceChatNativeReplyHTTPBoundary(t *testing.T) {
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(context.Background(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	r := agents.NewRegistry(nil)
	r.SetRunner(agents.ProviderCodex, workspaceChatFixtureRunner{})
	chat, err := workspacechat.New(database, httpNativeRegistry{r}, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer chat.Close()
	sess, err := chat.Create(context.Background(), pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = chat.Send(context.Background(), pid, sess.ID, workspacechat.SendRequest{ClientMessageID: "one", Text: "question"}); err != nil {
		t.Fatal(err)
	}
	var d workspacechat.Detail
	for i := 0; i < 500; i++ {
		d, err = chat.Detail(context.Background(), pid, sess.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(d.Requests) > 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if len(d.Requests) != 1 {
		t.Fatal(d)
	}
	cfg := &config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "fixture-token", ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, database, nil, nil, nil, nil, nil, chat)
	modelPath := "/api/v1/projects/" + pid + "/chat/providers/CODEX/models"
	modelCall := func(path string, auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", path, nil)
		if auth {
			req.Header.Set("Authorization", "Bearer fixture-token")
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	if out := modelCall(modelPath, false); out.Code != 401 {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := modelCall(modelPath, true); out.Code != 200 || !strings.Contains(out.Body.String(), `"model":"fixture-model"`) {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := modelCall("/api/v1/projects/missing/chat/providers/CODEX/models", true); out.Code != 404 {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := modelCall("/api/v1/projects/"+pid+"/chat/providers/CLAUDE/models", true); out.Code != 422 {
		t.Fatal(out.Code, out.Body.String())
	}
	path := "/api/v1/projects/" + pid + "/chat/sessions/" + sess.ID + "/requests/" + url.PathEscape(d.Requests[0].ID) + "/reply"
	call := func(path, body string, auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set("Authorization", "Bearer fixture-token")
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	body := `{"client_response_id":"reply","answer":{"answers":{"choice":{"answers":["yes"]}}}}`
	if out := call(path, body, false); out.Code != 401 {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := call(path, `{"client_response_id":"reply","answer":{"answers":{"wrong":{"answers":["yes"]}}}}`, true); out.Code != 400 {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := call(path, body, true); out.Code != 200 || !strings.Contains(out.Body.String(), `"status":"answered"`) {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := call(path, body, true); out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	if out := call(path, `{"client_response_id":"new","answer":{"answers":{"choice":{"answers":["yes"]}}}}`, true); out.Code != 409 {
		t.Fatal(out.Code, out.Body.String())
	}
}
func TestWorkspaceChatHTTPRoutes(t *testing.T) {
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(context.Background(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, workspaceChatFixtureRunner{})
	chat, err := workspacechat.New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer chat.Close()
	cfg := &config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "fixture-token", ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, database, nil, nil, nil, nil, nil, chat)
	// Exercise the real HTTP boundary, auth middleware, routes, and SQLite projection.
	server := httptest.NewServer(router)
	defer server.Close()
	call := func(method, path, body string, auth bool) (int, []byte) {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set("Authorization", "Bearer fixture-token")
		}
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var out bytes.Buffer
		out.ReadFrom(response.Body)
		return response.StatusCode, out.Bytes()
	}
	base := "/api/v1/projects/" + pid + "/chat"
	if status, _ := call("GET", base+"/sessions", "", false); status != 401 {
		t.Fatalf("auth: %d", status)
	}
	if status, data := call("GET", base+"/providers", "", true); status != 200 || !strings.Contains(string(data), `"provider_resume":false`) {
		t.Fatalf("providers %d %s", status, data)
	}
	if status, _ := call("POST", base+"/sessions", `{"provider":"GEMINI"}`, true); status != 422 {
		t.Fatalf("unsupported %d", status)
	}
	if status, _ := call("POST", base+"/sessions", `{"provider":"CODEX","cwd":"C:/arbitrary"}`, true); status != 400 {
		t.Fatalf("unknown cwd accepted %d", status)
	}
	status, data := call("POST", base+"/sessions", `{"provider":"CODEX","client_session_id":"37e6c5b8-c833-4c88-aa3e-989d8e6c021c"}`, true)
	if status != 201 {
		t.Fatalf("create %d %s", status, data)
	}
	var sess workspacechat.Session
	if err := json.Unmarshal(data, &sess); err != nil {
		t.Fatal(err)
	}
	if sess.ID != "37e6c5b8-c833-4c88-aa3e-989d8e6c021c" {
		t.Fatal(sess.ID)
	}
	if status, body := call("POST", base+"/sessions", `{"provider":"CODEX","client_session_id":"37e6c5b8-c833-4c88-aa3e-989d8e6c021c"}`, true); status != 201 || !strings.Contains(string(body), sess.ID) {
		t.Fatalf("create receipt %d %s", status, body)
	}
	if status, _ := call("POST", base+"/sessions", `{"provider":"CLAUDE","client_session_id":"37e6c5b8-c833-4c88-aa3e-989d8e6c021c"}`, true); status != 409 {
		t.Fatalf("identity conflict %d", status)
	}
	if status, _ := call("POST", base+"/sessions", `{"provider":"CODEX","client_session_id":"bad"}`, true); status != 400 {
		t.Fatalf("invalid identity %d", status)
	}
	path := base + "/sessions/" + sess.ID
	if status, _ := call("PATCH", path+"/title", `{"title":"Human label","expected_title":"New conversation"}`, false); status != 401 {
		t.Fatalf("rename auth %d", status)
	}
	if status, _ := call("PATCH", path+"/title", `{"title":" " ,"expected_title":"New conversation"}`, true); status != 400 {
		t.Fatalf("rename validation %d", status)
	}
	if status, body := call("PATCH", path+"/title", `{"title":"Human label","expected_title":"New conversation"}`, true); status != 200 || !strings.Contains(string(body), `"title":"Human label"`) {
		t.Fatalf("rename %d %s", status, body)
	}
	if status, _ := call("PATCH", path+"/title", `{"title":"Stale label","expected_title":"New conversation"}`, true); status != 409 {
		t.Fatalf("rename conflict %d", status)
	}
	if status, _ := call("PATCH", "/api/v1/projects/wrong/chat/sessions/"+sess.ID+"/title", `{"title":"Other","expected_title":"Human label"}`, true); status != 404 {
		t.Fatalf("rename scope %d", status)
	}
	if status, _ := call("GET", "/api/v1/projects/wrong/chat/sessions/"+sess.ID, "", true); status != 404 {
		t.Fatalf("scope %d", status)
	}
	if status, _ := call("POST", path+"/messages", `{"text":"hi","client_message_id":"unsupported","requested_model":"unavailable"}`, true); status != 422 {
		t.Fatalf("model %d", status)
	}
	if status, _ := call("POST", path+"/messages", `{"text":"hi","client_message_id":"unsupported-effort","requested_reasoning_effort":"low"}`, true); status != 422 {
		t.Fatalf("effort %d", status)
	}
	if status, data = call("POST", path+"/messages", `{"text":"hi","client_message_id":"first"}`, true); status != 202 {
		t.Fatalf("send %d %s", status, data)
	}
	var d workspacechat.Detail
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status, data = call("GET", path, "", true)
		json.Unmarshal(data, &d)
		if d.Session.Status == "idle" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if status != 200 || len(d.Messages) != 2 || d.Messages[1].Text != "Fixture reply" {
		t.Fatalf("history %d %s", status, data)
	}
	if status, data = call("POST", path+"/messages", `{"text":"hi","client_message_id":"first"}`, true); status != 202 {
		t.Fatalf("idempotent %d %s", status, data)
	}
	if status, _ := call("POST", path+"/stop", `{}`, true); status != 200 {
		t.Fatalf("stop %d", status)
	}
	// Reproduce a pre-workspace-binding conversation. The active root list has a
	// legacy fallback for this row, and archive must materialize the exact root
	// identity so its database-only catalog can retain it.
	if _, err = database.Exec(`DELETE FROM workspace_chat_workspaces WHERE session_id=?`, sess.ID); err != nil {
		t.Fatal(err)
	}
	archiveScope := "?workspace_id=" + url.QueryEscape(sess.WorkspaceID)
	if status, data = call("GET", base+"/sessions", "", true); status != 200 || !strings.Contains(string(data), sess.ID) || !strings.Contains(string(data), sess.WorkspaceID) {
		t.Fatalf("legacy root session was not listed in its workspace %d %s", status, data)
	}
	archiveBody, _ := json.Marshal(workspacechat.ArchiveRequest{WorkspaceID: sess.WorkspaceID, CWD: sess.WorkspacePath, ExpectedStatus: "idle", ExpectedVersion: 0})
	if status, data = call("POST", path+"/archive"+archiveScope, string(archiveBody), true); status != 200 || !strings.Contains(string(data), `"archived":true`) {
		t.Fatalf("archive %d %s", status, data)
	}
	if status, data = call("GET", base+"/sessions", "", true); status != 200 || strings.Contains(string(data), sess.ID) {
		t.Fatalf("default sessions list retained archive %d %s", status, data)
	}
	if status, data = call("GET", base+"/archives", "", true); status != 200 || !strings.Contains(string(data), sess.WorkspaceID) {
		t.Fatalf("archive catalog %d %s", status, data)
	}
	if status, data = call("GET", path+"/history?workspace_id="+url.QueryEscape(sess.WorkspaceID)+"&cwd="+url.QueryEscape(sess.WorkspacePath), "", true); status != 200 || !strings.Contains(string(data), "Fixture reply") {
		t.Fatalf("archive history %d %s", status, data)
	}
	unarchiveBody, _ := json.Marshal(workspacechat.ArchiveRequest{WorkspaceID: sess.WorkspaceID, CWD: sess.WorkspacePath, ExpectedStatus: "idle", ExpectedVersion: 1})
	if status, data = call("POST", path+"/unarchive"+archiveScope, string(unarchiveBody), true); status != 200 || !strings.Contains(string(data), `"archived":false`) {
		t.Fatalf("unarchive %d %s", status, data)
	}
}
