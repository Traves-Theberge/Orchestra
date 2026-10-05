package control

import (
	"context"
	"strings"
	"testing"
)

func TestReviewControlsShareDurableReceiptWithoutDispatchReplay(t *testing.T) {
	s, _, project, _ := controlFixture(t)
	calls := 0
	s.ConfigureReviewExecutor(func(ctx context.Context, req Request) map[string]any {
		calls++
		if req.ExpectedHeadSHA != strings.Repeat("a", 40) || req.ReviewerAgentID != "provider-default" || req.Provider != "ANTIGRAVITY" {
			t.Errorf("review identity changed: %+v", req)
		}
		return success(map[string]any{"review_gate": map[string]any{"status": "running", "attempt_id": req.RequestID}, "task_state": "Review"})
	})
	args := map[string]any{"operation": "request_review", "project_id": project, "task_id": "exact-task", "request_id": "16f32f10-6613-4c8a-9ddc-dea8fa8397e9", "expected_state": "Review", "expected_pr_url": "https://github.com/example/repository/pull/42", "expected_head_sha": strings.Repeat("a", 40), "provider": "ANTIGRAVITY", "reviewer_agent_id": "provider-default"}
	for range 2 {
		if result := executeControl(s, args); result["success"] != true {
			t.Fatal(result)
		}
	}
	if calls != 1 {
		t.Fatalf("receipt replay dispatched %d times", calls)
	}
	args["expected_head_sha"] = strings.Repeat("b", 40)
	requireCode(t, executeControl(s, args), "request_identity_conflict")
	if calls != 1 {
		t.Fatal("changed receipt dispatched a review")
	}
}

func TestReviewControlRejectsPartialIdentityBeforeExecutor(t *testing.T) {
	s, _, project, _ := controlFixture(t)
	s.ConfigureReviewExecutor(func(context.Context, Request) map[string]any {
		t.Error("invalid review reached executor")
		return success(nil)
	})
	requireCode(t, executeControl(s, map[string]any{"operation": "approve_review", "project_id": project, "task_id": "exact-task", "request_id": "16f32f10-6613-4c8a-9ddc-dea8fa8397e9", "expected_state": "Review"}), "invalid_request")
}
