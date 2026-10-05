package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCLIControlsShareAuthenticatedServiceAndKeepMutationIdentity(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "POST" || r.URL.Path != "/api/v1/orchestrator/control" || r.Header.Get("Authorization") != "Bearer fixture-secret" {
			t.Errorf("wrong control boundary %s %s", r.Method, r.URL)
		}
		var args map[string]string
		if err := json.NewDecoder(r.Body).Decode(&args); err != nil {
			t.Error(err)
		}
		if args["operation"] == "create" && (args["project_id"] != "project" || args["request_id"] != "fefeb817-67d8-4889-aa82-3867d633e29b" || args["title"] != "Task") {
			t.Errorf("lost create identity %+v", args)
		}
		fmt.Fprint(w, `{"success":true,"data":{"task":{"id":"task","state":"Backlog"}},"request_id":"fixture"}`)
	}))
	defer server.Close()
	for _, args := range [][]string{
		{"task", "create", "--project", "project", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--title", "Task", "--json"},
		{"task", "queue", "--project", "project", "--id", "task", "--request-id", "15e596c5-f2f0-48ff-bd0b-8cffde7a1d4a", "--expected-state", "Backlog", "--json"},
		{"control", "receipt", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--json"},
		{"control", "projects", "--json"}, {"control", "tasks", "--project", "project", "--json"}, {"control", "worktrees", "--project", "project", "--json"}, {"control", "status", "--json"},
	} {
		code, out, errOut := execute(t, context.Background(), args, server.URL)
		if code != 0 || !strings.Contains(out, `"source":"orchestra_control"`) {
			t.Fatalf("control %v %d %s %s", args, code, out, errOut)
		}
	}
	if calls.Load() != 7 {
		t.Fatalf("unexpected retries %d", calls.Load())
	}
}
func TestCLIControlUnknownResponseNeverAutomaticallyRetries(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(409)
		fmt.Fprint(w, `{"success":false,"error":{"code":"mutation_unknown","message":"inspect receipt before retrying"}}`)
	}))
	defer server.Close()
	code, _, errOut := execute(t, context.Background(), []string{"task", "create", "--project", "project", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--title", "Task"}, server.URL)
	if code != 1 || !strings.Contains(errOut, "mutation_unknown") || calls.Load() != 1 {
		t.Fatalf("unknown result %d %s calls=%d", code, errOut, calls.Load())
	}
}
