package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/cli"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/rs/zerolog"
)

// Separate native harness process. It speaks the installed app-server contract,
// asks real Orchestra tools to mutate SQLite tasks, and never performs inference.
func TestGlobalOrchestratorHarnessProcess(t *testing.T) {
	if os.Getenv("ORCHESTRA_GLOBAL_NATIVE_FIXTURE") != "1" {
		return
	}
	workingDirectory, err := os.Getwd()
	if err != nil || filepath.Base(workingDirectory) != "orchestrator" || filepath.Base(filepath.Dir(workingDirectory)) != ".orchestra" {
		os.Exit(18)
	}
	send := func(v any) { raw, _ := json.Marshal(v); fmt.Println(string(raw)) }
	scan := bufio.NewScanner(os.Stdin)
	thread := "global-native-fixture"
	turn := 0
	call := 0
	project := ""
	taskID := ""
	createArgs := map[string]any{}
	next := func() {
		var args map[string]any
		switch call {
		case 0:
			args = map[string]any{"operation": "projects"}
		case 1, 2:
			args = createArgs
		case 3:
			args = map[string]any{"operation": "queue", "project_id": project, "task_id": taskID, "expected_state": "Backlog", "request_id": "18654129-f35d-4aca-9558-7d84b9ddff1c"}
		case 4:
			args = map[string]any{"operation": "tasks", "project_id": project}
		default:
			send(map[string]any{"method": "item/agentMessage/delta", "params": map[string]any{"threadId": thread, "turnId": fmt.Sprintf("turn-%d", turn), "itemId": "reply", "delta": "Task queued through native Orchestra control"}})
			send(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": thread, "turn": map[string]string{"id": fmt.Sprintf("turn-%d", turn), "status": "completed"}}})
			return
		}
		send(map[string]any{"id": fmt.Sprintf("tool-%d", call), "method": "item/tool/call", "params": map[string]any{"threadId": thread, "turnId": fmt.Sprintf("turn-%d", turn), "callId": fmt.Sprintf("call-%d", call), "tool": "orchestra_control", "arguments": args}})
	}
	for scan.Scan() {
		var msg struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		_ = json.Unmarshal(scan.Bytes(), &msg)
		respond := func(v any) { send(map[string]any{"id": msg.ID, "result": v}) }
		switch msg.Method {
		case "initialize":
			respond(map[string]any{})
		case "thread/start", "thread/resume":
			var p map[string]any
			_ = json.Unmarshal(msg.Params, &p)
			if msg.Method == "thread/start" {
				specs, ok := p["dynamicTools"].([]any)
				if !ok || len(specs) != 1 {
					os.Exit(11)
				}
				tool := specs[0].(map[string]any)
				if tool["name"] != "orchestra_control" || tool["type"] != "function" {
					os.Exit(12)
				}
			} else {
				thread = p["threadId"].(string)
			}
			if !strings.Contains(fmt.Sprint(p["developerInstructions"]), "persistent cross-project orchestrator") {
				os.Exit(13)
			}
			respond(map[string]any{"thread": map[string]string{"id": thread}, "model": "native-fixture-model", "approvalPolicy": "on-request", "sandbox": map[string]string{"type": "workspaceWrite"}})
		case "turn/start":
			var p struct {
				Input []struct {
					Text string `json:"text"`
				} `json:"input"`
			}
			_ = json.Unmarshal(msg.Params, &p)
			turn++
			call = 0
			if len(p.Input) != 1 {
				os.Exit(14)
			}
			var input map[string]any
			_ = json.Unmarshal([]byte(p.Input[0].Text), &input)
			project, _ = input["project_id"].(string)
			createArgs = map[string]any{"operation": "create", "project_id": project, "title": "Native controlled task", "description": "Verify scoped control via real harness process", "provider": "CODEX", "assignee_id": "fixture-owner", "request_id": "ec4b469b-ea7a-4d45-96d6-2b34c8578b65"}
			respond(map[string]any{"turn": map[string]string{"id": fmt.Sprintf("turn-%d", turn)}})
			if p.Input[0].Text == "resume-only" {
				call = 5
				next()
				continue
			}
			// Foreign-thread tools must never reach the control callback.
			send(map[string]any{"id": "foreign-tool", "method": "item/tool/call", "params": map[string]any{"threadId": "other-thread", "turnId": fmt.Sprintf("turn-%d", turn), "callId": "foreign-call", "tool": "orchestra_control", "arguments": createArgs}})
		case "":
			if string(msg.ID) == `"foreign-tool"` {
				if len(msg.Error) == 0 {
					os.Exit(15)
				}
				next()
				continue
			}
			if !strings.HasPrefix(string(msg.ID), `"tool-`) {
				continue
			}
			var result struct {
				Success bool `json:"success"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"contentItems"`
			}
			if json.Unmarshal(msg.Result, &result) != nil || !result.Success || len(result.Content) != 1 || result.Content[0].Type != "inputText" {
				os.Exit(16)
			}
			if call == 1 || call == 2 {
				var receipt struct {
					Data struct {
						Task struct {
							ID string `json:"id"`
						} `json:"task"`
					} `json:"data"`
				}
				_ = json.Unmarshal([]byte(result.Content[0].Text), &receipt)
				if receipt.Data.Task.ID == "" || (taskID != "" && taskID != receipt.Data.Task.ID) {
					os.Exit(17)
				}
				taskID = receipt.Data.Task.ID
			}
			call++
			next()
		}
	}
	os.Exit(0)
}

func TestGlobalOrchestratorNativeControlsPersistAndCLIReconciles(t *testing.T) {
	t.Setenv("ORCHESTRA_GLOBAL_NATIVE_FIXTURE", "1")
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	// No provider account HOME/config mutation: only a test binary is launched.
	project, err := database.UpsertProject(context.Background(), filepath.Join(root, "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, workspaceChatFixtureRunner{})
	registry.SetNativeCommand(agents.ProviderCodex, "'"+strings.ReplaceAll(filepath.ToSlash(exe), "'", "'\"'\"'")+"' -test.run=^TestGlobalOrchestratorHarnessProcess$")
	cfg := &config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "fixture-token", ProjectRoots: []string{root}}
	chat, err := workspacechat.New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	service := orchestrator.NewService()
	service.SetDB(database)
	service.SetTrackerClient(trackersqlite.NewClient(database, nil))
	server := httptest.NewServer(NewRouterWithPubSub(zerolog.Nop(), service, cfg, nil, database, nil, nil, nil, nil, nil, chat))
	defer server.Close()
	defer chat.Close()
	call := func(method, path string, body any, auth bool) (int, []byte) {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set("Authorization", "Bearer fixture-token")
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, out
	}
	base := "/api/v1/orchestrator/chat"
	if status, _ := call("GET", base+"/sessions", nil, false); status != 401 {
		t.Fatalf("unauth global status %d", status)
	}
	if status, out := call("POST", base+"/sessions", map[string]string{"provider": "CLAUDE"}, true); status != 422 {
		t.Fatalf("unsupported harness %d %s", status, out)
	}
	status, raw := call("POST", base+"/sessions", map[string]string{"provider": "CODEX", "client_session_id": "79c2c344-4f38-4c3a-8397-f12c202fa3c8"}, true)
	var session workspacechat.Session
	_ = json.Unmarshal(raw, &session)
	if status != 201 || session.ProjectID != workspacechat.OrchestratorScope {
		t.Fatalf("global create %d %s", status, raw)
	}
	prompt, _ := json.Marshal(map[string]string{"project_id": project})
	if status, out := call("POST", base+"/sessions/"+session.ID+"/messages", workspacechat.SendRequest{ClientMessageID: "native-control", Text: string(prompt)}, true); status != 202 {
		t.Fatalf("send %d %s", status, out)
	}
	deadline := time.Now().Add(5 * time.Second)
	var detail workspacechat.Detail
	for time.Now().Before(deadline) {
		_, out := call("GET", base+"/sessions/"+session.ID, nil, true)
		_ = json.Unmarshal(out, &detail)
		if detail.Session.Status != "running" {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if detail.Session.Status != "idle" || detail.Session.ProviderThreadID != "global-native-fixture" {
		t.Fatalf("native outcome %+v", detail)
	}
	tasks, err := trackersqlite.NewClient(database, nil).FetchIssues(context.Background(), tracker.IssueFilter{ProjectID: project})
	if err != nil || len(tasks) != 1 || tasks[0].State != "Todo" {
		t.Fatalf("native task effects %+v %v", tasks, err)
	}
	var toolCompleted int
	for _, event := range detail.Events {
		if event.Type == "orchestra/tool/completed" {
			toolCompleted++
		}
	}
	if toolCompleted != 5 {
		t.Fatalf("native callback observations %d", toolCompleted)
	}
	var stdout, stderr bytes.Buffer
	exit := cli.Run(context.Background(), []string{"control", "receipt", "--request-id", "ec4b469b-ea7a-4d45-96d6-2b34c8578b65", "--json"}, &stdout, &stderr, func(key string) string {
		if key == "ORCHESTRA_BASE_URL" {
			return server.URL
		}
		if key == "ORCHESTRA_API_TOKEN" {
			return "fixture-token"
		}
		return ""
	})
	if exit != 0 || !strings.Contains(stdout.String(), tasks[0].ID) || strings.Contains(stdout.String(), "fixture-token") {
		t.Fatalf("CLI reconciliation %d %s %s", exit, stdout.String(), stderr.String())
	}
	cliEnv := func(key string) string {
		if key == "ORCHESTRA_BASE_URL" {
			return server.URL
		}
		if key == "ORCHESTRA_API_TOKEN" {
			return "fixture-token"
		}
		return ""
	}
	stdout.Reset()
	stderr.Reset()
	exit = cli.Run(context.Background(), []string{"task", "create", "--project", project, "--request-id", "cff696c2-b068-48ba-b127-a4716d5e3144", "--title", "CLI controlled task", "--description", "Actual shared CLI mutation", "--assignee", "fixture-owner", "--provider", "CODEX", "--json"}, &stdout, &stderr, cliEnv)
	if exit != 0 {
		t.Fatalf("CLI create %d %s", exit, stderr.String())
	}
	var cliCreate struct {
		Data struct {
			Data struct {
				Task tracker.Issue `json:"task"`
			} `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &cliCreate); err != nil || cliCreate.Data.Data.Task.ID == "" {
		t.Fatalf("CLI create payload %s %v", stdout.String(), err)
	}
	stdout.Reset()
	stderr.Reset()
	exit = cli.Run(context.Background(), []string{"task", "queue", "--project", project, "--id", cliCreate.Data.Data.Task.ID, "--request-id", "b4d1e2fb-e0a4-400a-918b-7da7c6170a2c", "--expected-state", "Backlog", "--json"}, &stdout, &stderr, cliEnv)
	if exit != 0 {
		t.Fatalf("CLI queue %d %s", exit, stderr.String())
	}
	queued, err := trackersqlite.NewClient(database, nil).FetchIssueByIdentifier(context.Background(), cliCreate.Data.Data.Task.ID)
	if err != nil || queued.State != "Todo" || queued.ProjectID != project {
		t.Fatalf("CLI queue effect %+v %v", queued, err)
	}
	chat.Close()
	server.Close()
	// Recreate the service/router against the same durable store, with no catalog sentinel.
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	service.SetDB(reopened)
	service.SetTrackerClient(trackersqlite.NewClient(reopened, nil))
	restarted, err := workspacechat.New(reopened, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	second := httptest.NewServer(NewRouterWithPubSub(zerolog.Nop(), service, cfg, nil, reopened, nil, nil, nil, nil, nil, restarted))
	defer second.Close()
	recovered, err := restarted.DetailAfter(context.Background(), workspacechat.OrchestratorScope, session.ID, 0)
	if err != nil || recovered.Session.ProviderThreadID != "global-native-fixture" || len(recovered.Messages) != 2 || recovered.Cursor != detail.Cursor {
		t.Fatalf("global restore %+v %v", recovered, err)
	}
	projects, err := reopened.GetProjects(context.Background())
	if err != nil || len(projects) != 1 || projects[0].ID != project {
		t.Fatalf("fake project inserted %+v %v", projects, err)
	}
	if _, err := restarted.DetailAfter(context.Background(), project, session.ID, 0); err == nil {
		t.Fatal("global thread leaked into project scope")
	}
	if _, err := restarted.Send(context.Background(), workspacechat.OrchestratorScope, session.ID, workspacechat.SendRequest{ClientMessageID: "resume-confirmation", Text: "resume-only"}); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		recovered, err = restarted.DetailAfter(context.Background(), workspacechat.OrchestratorScope, session.ID, 0)
		if err != nil {
			t.Fatal(err)
		}
		if recovered.Session.Status != "running" {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if recovered.Session.Status != "idle" || recovered.Session.ProviderThreadID != "global-native-fixture" || len(recovered.Messages) != 4 {
		t.Fatalf("native resume %+v", recovered)
	}
}
