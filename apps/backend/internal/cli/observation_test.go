package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func execute(t *testing.T, ctx context.Context, args []string, endpoint string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Run(ctx, args, &out, &errOut, func(key string) string {
		switch key {
		case "ORCHESTRA_BASE_URL":
			return endpoint
		case "ORCHESTRA_API_TOKEN":
			return "fixture-secret"
		}
		return ""
	})
	if code == 0 {
		if !json.Valid(out.Bytes()) || errOut.Len() != 0 {
			t.Fatalf("success streams: %q %q", out.String(), errOut.String())
		}
	} else {
		if !json.Valid(errOut.Bytes()) || out.Len() != 0 {
			t.Fatalf("failure streams: %q %q", out.String(), errOut.String())
		}
	}
	if strings.Contains(out.String()+errOut.String(), "fixture-secret") {
		t.Fatal("API credential leaked")
	}
	return code, out.String(), errOut.String()
}

func TestObservationsUseAuthenticatedSharedAPIs(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer fixture-secret" {
			t.Errorf("wrong request authorization/method")
		}
		requests = append(requests, r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v1/state":
			fmt.Fprint(w, `{"counts":{"running":0,"retrying":0},"running":[],"retrying":[],"echo":"fixture-secret"}`)
		case "/api/v1/projects":
			fmt.Fprint(w, `[{"id":"p1","name":"Project","github_token":"other-secret"}]`)
		case "/api/v1/issues":
			fmt.Fprint(w, `{"issues":[{"id":"opaque-1","identifier":"REPO-1","source":"sqlite","project_id":"p1","state":"Todo","requested_model":"wanted","requested_max_turns":null}],"total":1}`)
		default:
			t.Errorf("unexpected detail lookup %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	for _, args := range [][]string{{"status", "--json"}, {"project", "list", "--json"}, {"project", "show", "p1", "--json"}, {"task", "list", "--project", "p1", "--states", "Todo,Backlog", "--json"}, {"task", "show", "--id", "opaque-1", "--project", "p1", "--json"}, {"task", "show", "--identifier", "REPO-1", "--json"}} {
		code, out, _ := execute(t, context.Background(), args, server.URL)
		if code != 0 {
			t.Fatalf("%v failed", args)
		}
		if strings.Contains(out, "other-secret") {
			t.Fatal("project token exposed")
		}
		if !strings.Contains(out, `"schema_version":1`) {
			t.Fatal("missing envelope version")
		}
		if !strings.Contains(out, `"backend_base_url":"`+server.URL+`"`) {
			t.Fatal("observation origin missing")
		}
		if args[0] == "task" && (!strings.Contains(out, `"requested_model":"wanted"`) || strings.Contains(out, "workspace_path")) {
			t.Fatalf("lost intent or invented workspace: %s", out)
		}
	}
	if !strings.Contains(strings.Join(requests, "\n"), "project_id=p1&states=Todo%2CBacklog") {
		t.Fatalf("filter query missing: %v", requests)
	}
}

func TestTaskListFiltersUseExplicitAssigneeSemantics(t *testing.T) {
	var queries [][2]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects" {
			fmt.Fprint(w, `[{"id":"p1","name":"Project"}]`)
			return
		}
		queries = append(queries, [2]string{r.URL.Query().Get("assignee_id"), r.URL.Query().Get("unassigned")})
		fmt.Fprint(w, `{"issues":[{"id":"task-1","identifier":"P-1","project_id":"p1","state":"Backlog","pr_url":"https://example.test/pr/1"}],"total":1}`)
	}))
	defer server.Close()
	for _, args := range [][]string{
		{"task", "list", "--project", "p1", "--assignee", "worker-7", "--json"},
		{"task", "list", "--project", "p1", "--unassigned", "--json"},
	} {
		code, _, errOut := execute(t, context.Background(), args, server.URL)
		if code != 0 {
			t.Fatalf("%v: %s", args, errOut)
		}
	}
	if len(queries) != 2 || queries[0] != [2]string{"worker-7", ""} || queries[1] != [2]string{"", "true"} {
		t.Fatalf("assignee filters were not distinct and exact: %v", queries)
	}
	for _, args := range [][]string{
		{"task", "list", "--unassigned", "--assignee", "worker-7"},
		{"task", "assign", "--project", "p1", "--id", "task-1", "--request-id", "not-a-uuid"},
	} {
		code, _, _ := execute(t, context.Background(), args, "")
		if code != 2 {
			t.Fatalf("expected invalid CLI arguments for %v, got %d", args, code)
		}
	}
}

func TestTaskAssignUsesSharedControlAndShowsPersistedPRLink(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/orchestrator/control" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		fmt.Fprint(w, `{"success":true,"data":{"task":{"id":"task-1","identifier":"P-1","project_id":"p1","title":"Fix task","state":"Backlog","assignee_id":"worker-7","pr_url":"https://github.com/example/repo/pull/12"},"effect":"assigned","execution":"not_started","provider":"unchanged"}}`)
	}))
	defer server.Close()
	var stdout, stderr bytes.Buffer
	code := Run(context.Background(), []string{"task", "assign", "--project", "p1", "--id", "task-1", "--request-id", "bd60e6ec-5c67-4937-9c72-3e46513b5fad", "--assignee", "worker-7"}, &stdout, &stderr, func(key string) string {
		if key == "ORCHESTRA_BASE_URL" {
			return server.URL
		}
		if key == "ORCHESTRA_API_TOKEN" {
			return "fixture-secret"
		}
		return ""
	})
	if code != 0 || stderr.Len() != 0 || !strings.Contains(stdout.String(), "PR: https://github.com/example/repo/pull/12") || !strings.Contains(stdout.String(), "Assignee: worker-7") || !strings.Contains(stdout.String(), "Harness: not set") {
		t.Fatalf("human task assignment output: %d %s %s", code, stdout.String(), stderr.String())
	}
	if body["operation"] != "assign" || body["project_id"] != "p1" || body["task_id"] != "task-1" || body["assignee_id"] != "worker-7" || body["expected_state"] != "Backlog" || body["request_id"] != "bd60e6ec-5c67-4937-9c72-3e46513b5fad" || body["provider"] != nil {
		t.Fatalf("assignment control arguments confused assignee with provider or lost scope: %+v", body)
	}
}

func TestHumanTaskListAndShowPrintPersistedPRURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `[{"id":"p1","name":"Project"}]`)
		case "/api/v1/issues":
			fmt.Fprint(w, `{"issues":[{"id":"task-1","identifier":"P-1","project_id":"p1","title":"Fix task","state":"Backlog","assignee_id":"worker-7","pr_url":"https://github.com/example/repo/pull/12"},{"id":"task-2","identifier":"P-2","project_id":"p1","title":"No linked pull request","state":"Backlog","assignee_id":"worker-8"}],"total":2}`)
		case "/api/v1/orchestrator/control":
			fmt.Fprint(w, `{"success":true,"data":{"project_id":"p1","tasks":[{"id":"task-1","identifier":"P-1","project_id":"p1","title":"Fix task","state":"Backlog","assignee_id":"worker-7","pr_url":"https://github.com/example/repo/pull/12"},{"id":"task-2","identifier":"P-2","project_id":"p1","title":"No linked pull request","state":"Backlog","assignee_id":"worker-8"}]}}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	for _, args := range [][]string{
		{"task", "list", "--project", "p1"},
		{"task", "show", "--project", "p1", "--id", "task-1"},
		{"control", "tasks", "--project", "p1"},
	} {
		var stdout, stderr bytes.Buffer
		code := Run(context.Background(), args, &stdout, &stderr, func(key string) string {
			if key == "ORCHESTRA_BASE_URL" {
				return server.URL
			}
			if key == "ORCHESTRA_API_TOKEN" {
				return "fixture-secret"
			}
			return ""
		})
		if code != 0 || stderr.Len() != 0 || !strings.Contains(stdout.String(), "P-1 — Fix task") || !strings.Contains(stdout.String(), "PR: https://github.com/example/repo/pull/12") {
			t.Fatalf("human output for %v: %d %s %s", args, code, stdout.String(), stderr.String())
		}
		if args[1] != "show" && (!strings.Contains(stdout.String(), "P-2 — No linked pull request") || !strings.Contains(stdout.String(), "PR: none")) {
			t.Fatalf("human task inventory did not report absent PR linkage for %v: %s", args, stdout.String())
		}
	}
}

func TestTaskIdentityAndProjectScopeFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		args       []string
		want       string
	}{
		{"duplicate", `{"issues":[{"id":"1","identifier":"SAME"},{"id":"2","identifier":"SAME"}]}`, []string{"task", "show", "--identifier", "SAME"}, "ambiguous_identity"},
		{"opaque id is not identifier", `{"issues":[{"id":"opaque","identifier":"REPO-1"}]}`, []string{"task", "show", "--identifier", "opaque"}, "not_found"},
		{"outside project", `{"issues":[{"id":"1","identifier":"A","project_id":"other"}]}`, []string{"task", "list", "--project", "p1"}, "scope_conflict"},
		{"unknown project", `{"issues":[]}`, []string{"task", "list", "--project", "missing"}, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var issueCalls int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/projects" {
					fmt.Fprint(w, `[{"id":"p1"}]`)
				} else {
					issueCalls++
					fmt.Fprint(w, tc.body)
				}
			}))
			defer server.Close()
			code, _, errOut := execute(t, context.Background(), tc.args, server.URL)
			if code != 1 || !strings.Contains(errOut, tc.want) {
				t.Fatalf("got %d %s", code, errOut)
			}
			if tc.name == "unknown project" && issueCalls != 0 {
				t.Fatal("unknown project fell back to global issue source")
			}
		})
	}
}

func TestRedirectDoesNotForwardCredentials(t *testing.T) {
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	code, _, errOut := execute(t, context.Background(), []string{"status", "--json"}, server.URL)
	if code != 1 || calls.Load() != 0 || !strings.Contains(errOut, "307") {
		t.Fatalf("redirect followed or hidden: %d %s", code, errOut)
	}
}

func TestFailureBodiesAndMalformedResponsesAreNotPrinted(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		want       string
	}{
		{"unauthorized", "fixture-secret other-private", 401, "http_error"},
		{"malformed", "fixture-secret other-private", 200, "invalid_response"},
		{"trailing", `{} {}`, 200, "invalid_response"},
		{"wrong shape", `[]`, 200, "invalid_response"},
		{"missing snapshot counts", `{}`, 200, "invalid_response"},
		{"missing snapshot entries", `{"counts":{"running":0,"retrying":0}}`, 200, "invalid_response"},
		{"oversized", strings.Repeat("x", maxResponseBytes+1), 200, "invalid_response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer server.Close()
			code, _, errOut := execute(t, context.Background(), []string{"status"}, server.URL)
			if code != 1 || !strings.Contains(errOut, tc.want) || strings.Contains(errOut, "other-private") {
				t.Fatalf("%d %s", code, errOut)
			}
		})
	}
}

func TestArgumentsAndEndpointFailBeforeNetworking(t *testing.T) {
	for _, args := range [][]string{{"task", "show", "--id", "a", "--identifier", "b"}, {"task", "show", "REPO-1"}, {"task", "list", "--unknown", "x"}, {"project", "list", "--project", "a"}, {"status", "--base-url", "http://remote.invalid"}, {"status", "--base-url", "http://user:fixture-secret@localhost"}, {"status", "--base-url", "http://localhost/api"}, {"status", "--base-url", "http://localhost?token=fixture-secret"}, {"task", "list", "--states"}} {
		code, _, _ := execute(t, context.Background(), args, "")
		if code != 2 {
			t.Fatalf("args %v code %d", args, code)
		}
	}
	var out, errOut bytes.Buffer
	code := Run(context.Background(), []string{"status"}, &out, &errOut, func(key string) string {
		if key == "ORCHESTRA_BASE_URL" {
			return "http://127.0.0.1:1"
		}
		return ""
	})
	if code != 2 || !strings.Contains(errOut.String(), "missing_auth") {
		t.Fatalf("missing auth: %d %s", code, errOut.String())
	}
}

func TestCallerCancellationBoundsRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	code, _, errOut := execute(t, ctx, []string{"status"}, server.URL)
	if code != 1 || !strings.Contains(errOut, "request_failed") || time.Since(start) > time.Second {
		t.Fatalf("cancellation not bounded: %d %s", code, errOut)
	}
}

func TestEmptyCollectionsAreArrays(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects" {
			fmt.Fprint(w, `null`)
		} else {
			fmt.Fprint(w, `{"issues":null,"total":0}`)
		}
	}))
	defer server.Close()
	for _, args := range [][]string{{"project", "list"}, {"task", "list", "--json"}} {
		code, out, _ := execute(t, context.Background(), args, server.URL)
		if code != 0 || strings.Contains(out, `"data":null`) || strings.Contains(out, `"issues":null`) {
			t.Fatalf("empty shape: %d %s", code, out)
		}
	}
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"task", "list"}, "No tasks found."},
		{[]string{"task", "list", "--unassigned"}, "No unassigned tasks found."},
	} {
		var out, errOut bytes.Buffer
		code := Run(context.Background(), tc.args, &out, &errOut, func(key string) string {
			if key == "ORCHESTRA_BASE_URL" {
				return server.URL
			}
			if key == "ORCHESTRA_API_TOKEN" {
				return "fixture-secret"
			}
			return ""
		})
		if code != 0 || !strings.Contains(out.String(), tc.want) || errOut.Len() != 0 {
			t.Fatalf("null inventory human output for %v: code=%d out=%q err=%q", tc.args, code, out.String(), errOut.String())
		}
	}
}
