package control

import (
	"context"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// ConfigureReviewExecutor binds a provider-independent review stage before
// publishing the shared control executor to HTTP and native agent sessions.
func (s *Service) ConfigureReviewExecutor(executor func(context.Context, Request) map[string]any) {
	s.reviewExecutor = executor
}

func reviewMutation(operation string) bool {
	return operation == "request_review" || operation == "approve_review" || operation == "complete_review"
}

func ValidateReviewRequest(req Request) error {
	if req.TaskID == "" || req.ProjectID == "" || req.ExpectedState != "Review" || req.ExpectedPlanHash != "" || req.Feedback != "" || req.Title != "" || req.Description != "" || req.AssigneeID != "" || req.Unassigned {
		return errors.New("Review controls require exact project/task IDs, expected_state Review and no task metadata changes")
	}
	u, err := url.Parse(req.ExpectedPRURL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("Review requires the canonical linked GitHub PR URL")
	}
	if len(req.ExpectedHeadSHA) != 40 {
		return errors.New("Review requires the exact full head SHA")
	}
	if _, err := hex.DecodeString(req.ExpectedHeadSHA); err != nil {
		return errors.New("Review head SHA must be hexadecimal")
	}
	if req.Operation == "request_review" {
		if strings.TrimSpace(req.Provider) == "" || req.ReviewerAgentID != "provider-default" || req.ReviewAttemptID != "" {
			return errors.New("Request review requires a registered provider and the supported provider-default reviewer profile")
		}
	} else {
		id, err := uuid.Parse(req.ReviewAttemptID)
		if err != nil || id == uuid.Nil || id.String() != req.ReviewAttemptID || req.Provider != "" || req.ReviewerAgentID != "" {
			return errors.New("Review approval/completion requires the exact canonical attempt UUID and no reviewer changes")
		}
	}
	return nil
}
