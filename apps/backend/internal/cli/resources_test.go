package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestResourceListAndShowUseExactScopedCatalogAPI(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-secret" || r.Header.Get("Accept") != "application/json" {
			t.Errorf("auth or accept header missing")
		}
		paths = append(paths, r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v1/projects/project-1/agent-catalog":
			if r.Method != http.MethodGet || r.URL.Query().Get("scope") != "effective" || r.URL.Query().Get("harness") != "OPENCODE" || r.URL.Query().Get("workspace_id") != "ws-1" || r.URL.Query().Get("kind") != "" {
				t.Errorf("wrong catalog query: %s %s", r.Method, r.URL.RequestURI())
			}
			fmt.Fprint(w, `{"project_id":"project-1","workspace_id":"ws-1","harness":"OPENCODE","scope":"effective","items":[{"id":"team/planner","kind":"agent_definition"},{"id":"writer","kind":"skill"}]}`)
		case "/api/v1/projects/project-1/agent-catalog/resource":
			if r.Method != http.MethodGet || r.URL.Query().Get("resource_id") != "team/planner" || r.URL.Query().Get("kind") != "agent_definition" {
				t.Errorf("nested native ID changed: %s %s", r.Method, r.URL.RequestURI())
			}
			fmt.Fprint(w, `{"id":"team/planner","kind":"agent_definition","content":"native content","content_hash":"sha256:abcd"}`)
		default:
			t.Errorf("unexpected route: %s", r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	for _, args := range [][]string{
		{"agent", "list", "--project", "project-1", "--harness", "opencode", "--scope", "effective", "--workspace", "ws-1", "--json"},
		{"agent", "show", "--project", "project-1", "--harness", "OPENCODE", "--scope", "effective", "--workspace", "ws-1", "--id", "team/planner"},
		{"skill", "list", "--project", "project-1", "--harness", "OPENCODE", "--scope", "effective", "--workspace", "ws-1"},
	} {
		code, out, errOut := execute(t, context.Background(), args, server.URL)
		if code != 0 || errOut != "" || !strings.Contains(out, `"source":"agent_catalog"`) {
			t.Fatalf("%v: %d %s %s", args, code, out, errOut)
		}
		if args[1] == "list" {
			if args[0] == "agent" && (strings.Contains(out, `"kind":"skill"`) || !strings.Contains(out, `"kind":"agent_definition"`)) {
				t.Fatalf("agent list leaked other resource kinds: %s", out)
			}
			if args[0] == "skill" && (strings.Contains(out, `"kind":"agent_definition"`) || !strings.Contains(out, `"kind":"skill"`)) {
				t.Fatalf("skill list leaked other resource kinds: %s", out)
			}
		}
	}
	if len(paths) != 3 || !strings.Contains(paths[1], "resource_id=team%2Fplanner") {
		t.Fatalf("unexpected paths: %v", paths)
	}
}

func TestResourceMutationReadsExplicitFileAndDoesNotRetry(t *testing.T) {
	content := "---\nmode: primary\n---\n\nRaw line.\n"
	file := filepath.Join(t.TempDir(), "agent.md")
	if err := os.WriteFile(file, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	const requestID = "fefeb817-67d8-4889-aa82-3867d633e29b"
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/projects/__orchestrator__/agent-catalog/resource" || r.URL.Query().Get("scope") != "global" || r.URL.Query().Get("resource_id") != "team/planner" {
			t.Errorf("wrong mutation boundary %s %s", r.Method, r.URL)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["request_id"] != requestID || body["content"] != content || body["format"] != "opencode-v1" || body["expected_hash"] != "" {
			t.Errorf("mutation body changed: %#v", body)
		}
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error":{"code":"private","message":"private response body"}}`)
	}))
	defer server.Close()
	code, out, errOut := execute(t, context.Background(), []string{"agent", "create", "--project", "__orchestrator__", "--harness", "OPENCODE", "--scope", "global", "--id", "team/planner", "--request-id", requestID, "--format", "opencode-v1", "--content-file", file}, server.URL)
	if code != 1 || out != "" || !strings.Contains(errOut, "mutation_unknown") || !strings.Contains(errOut, requestID) || strings.Contains(errOut, "private response body") || calls.Load() != 1 {
		t.Fatalf("unknown mutation behavior: %d %s %s calls=%d", code, out, errOut, calls.Load())
	}
}

func TestResourceArgumentsFailClosed(t *testing.T) {
	valid := []string{"agent", "update", "--project", "p", "--harness", "CODEX", "--scope", "project", "--id", "nested/agent", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-hash", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "--content-file", "agent.toml"}
	cases := [][]string{
		{"agent", "mutate", "--project", "p"},
		append(append([]string{}, valid...), "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b"),
		{"agent", "update", "--project", "p", "--harness", "CODEX", "--scope", "effective", "--id", "a", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-hash", "sha256:x", "--content-file", "file"},
		{"agent", "list", "--project", "__orchestrator__", "--harness", "OPENCODE", "--scope", "effective"},
		{"skill", "delete", "--project", "p", "--harness", "CODEX", "--scope", "project", "--id", "skill", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b"},
		{"skill", "receipt", "--project", "p", "--request-id", "bad"},
		{"agent", "list", "--project", "p", "--harness", "CODEX", "--scope", "global", "--workspace", "ws"},
	}
	for _, args := range cases {
		var out, errOut strings.Builder
		code := Run(context.Background(), args, &out, &errOut, func(key string) string {
			if key == "ORCHESTRA_BASE_URL" {
				return "http://127.0.0.1:1"
			}
			if key == "ORCHESTRA_API_TOKEN" {
				return "fixture-secret"
			}
			return ""
		})
		if code != 2 || out.Len() != 0 || !strings.Contains(errOut.String(), "invalid_argument") {
			t.Fatalf("invalid args passed parse: %v => %d %s %s", args, code, out.String(), errOut.String())
		}
	}
}

func TestResourceMutationUsesSingleRequestAndReceiptEndpoint(t *testing.T) {
	const requestID = "fefeb817-67d8-4889-aa82-3867d633e29b"
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/v1/projects/p/agent-catalog/receipts/"+requestID || r.Method != http.MethodGet {
			t.Errorf("wrong receipt route: %s %s", r.Method, r.URL)
		}
		fmt.Fprint(w, `{"request_id":"`+requestID+`","status":"unknown","project_id":"p"}`)
	}))
	defer server.Close()
	code, out, errOut := execute(t, context.Background(), []string{"skill", "receipt", "--project", "p", "--request-id", requestID}, server.URL)
	if code != 0 || errOut != "" || calls.Load() != 1 || !strings.Contains(out, `"status":"unknown"`) {
		t.Fatalf("receipt lookup: %d %s %s calls=%d", code, out, errOut, calls.Load())
	}
}
