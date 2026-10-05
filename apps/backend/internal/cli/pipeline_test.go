package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlanApprovalAndReplanKeepExactContract(t *testing.T) {
	hash := strings.Repeat("a", 64)
	requestID := "fefeb817-67d8-4889-aa82-3867d633e29b"
	for _, test := range []struct {
		name string
		args []string
		want map[string]string
	}{
		{"approval", []string{"task", "approve-plan", "--project", "project-1", "--id", "task-1", "--request-id", requestID, "--expected-plan-hash", hash}, map[string]string{"operation": "approve_plan", "project_id": "project-1", "task_id": "task-1", "request_id": requestID, "expected_state": "Todo", "expected_plan_hash": hash}},
		{"replan", []string{"task", "replan", "--project", "project-1", "--id", "task-1", "--request-id", requestID, "--expected-state", "Review", "--expected-plan-hash", hash, "--feedback", "Review found a race; retain the existing diff."}, map[string]string{"operation": "replan", "project_id": "project-1", "task_id": "task-1", "request_id": requestID, "expected_state": "Review", "expected_plan_hash": hash, "feedback": "Review found a race; retain the existing diff."}},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != http.MethodPost || r.URL.Path != "/api/v1/orchestrator/control" || r.Header.Get("Authorization") != "Bearer fixture-secret" {
					t.Errorf("unexpected control boundary")
				}
				var got map[string]string
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Error(err)
					return
				}
				if len(got) != len(test.want) {
					t.Errorf("extra or missing fields: %v", got)
				}
				for key, want := range test.want {
					if got[key] != want {
						t.Errorf("%s: got %q, want %q", key, got[key], want)
					}
				}
				fmt.Fprint(w, `{"success":true,"data":{"task":{"id":"task-1","project_id":"project-1","state":"Todo"}}}`)
			}))
			defer server.Close()
			code, out, errOut := execute(t, context.Background(), test.args, server.URL)
			if code != 0 || calls != 1 || !strings.Contains(out, `"source":"orchestra_control"`) {
				t.Fatalf("code=%d calls=%d out=%s error=%s", code, calls, out, errOut)
			}
		})
	}
}

func TestGateCommandsRejectIncompleteOrGuessedIdentity(t *testing.T) {
	for _, args := range [][]string{
		{"task", "approve-plan", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b"},
		{"task", "approve-plan", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-plan-hash", "guess"},
		{"task", "replan", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-state", "Done", "--feedback", "replan"},
		{"task", "replan", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-state", "Review"},
	} {
		if _, err := parse(args); err == nil {
			t.Fatalf("accepted invalid gate command: %v", args)
		}
	}
}

func TestReviewCLIUsesExactSharedContractAcrossHarnesses(t *testing.T) {
	sha := strings.Repeat("a", 40)
	for _, provider := range []string{"CODEX", "CLAUDE", "ANTIGRAVITY", "OPENCODE", "8GENT"} {
		t.Run(provider, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var got map[string]string
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Error(err)
					return
				}
				if got["operation"] != "request_review" || got["provider"] != provider || got["expected_head_sha"] != sha || got["expected_state"] != "Review" || got["reviewer_agent_id"] != "provider-default" || got["review_attempt_id"] != "" {
					t.Errorf("unexpected review contract: %+v", got)
				}
				fmt.Fprint(w, `{"success":true,"data":{"review_gate":{"status":"running"},"task_state":"Review"}}`)
			}))
			defer server.Close()
			code, _, errors := execute(t, context.Background(), []string{"task", "request-review", "--project", "project-1", "--id", "task-1", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-pr-url", "https://github.com/example/repository/pull/42", "--expected-head-sha", sha, "--provider", provider, "--reviewer-agent", "provider-default"}, server.URL)
			if code != 0 {
				t.Fatal(errors)
			}
		})
	}
}

func TestGeminiIsNotSelectableForNewCLIWork(t *testing.T) {
	for _, args := range [][]string{
		{"task", "create", "--project", "p", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--title", "new work", "--provider", "GEMINI"},
		{"task", "assign", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--assignee", "worker", "--provider", "gemini"},
		{"task", "request-review", "--project", "p", "--id", "t", "--request-id", "fefeb817-67d8-4889-aa82-3867d633e29b", "--expected-pr-url", "https://github.com/example/repository/pull/42", "--expected-head-sha", strings.Repeat("a", 40), "--provider", "GEMINI", "--reviewer-agent", "provider-default"},
	} {
		if _, err := parse(args); err == nil || !strings.Contains(err.Error(), "Antigravity") {
			t.Fatalf("retired harness was accepted: %v, %v", args, err)
		}
	}
	if !strings.Contains(Help, "ANTIGRAVITY") || strings.Contains(Help, "OPENCODE|GEMINI") {
		t.Fatal("CLI catalog help still advertises Gemini")
	}
}
