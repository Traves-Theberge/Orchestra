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
	for _, args := range [][]string{{"project", "list"}, {"task", "list"}} {
		code, out, _ := execute(t, context.Background(), args, server.URL)
		if code != 0 || strings.Contains(out, `"data":null`) || strings.Contains(out, `"issues":null`) {
			t.Fatalf("empty shape: %d %s", code, out)
		}
	}
}
