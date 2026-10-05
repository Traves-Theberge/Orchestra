package cli

import (
	"fmt"

	"github.com/orchestra/orchestra/apps/backend/internal/control"
)

func validateCLIReview(c command) error {
	// Match the shared boundary before HTTP rather than emitting a partial
	// review intent for an invented head, profile or attempt.
	if c.project == "" || c.id == "" || c.requestID == "" {
		return fmt.Errorf("review commands require --project, --id and --request-id")
	}
	return control.ValidateReviewRequest(control.Request{
		Operation: operationForReview(c.name), ProjectID: c.project, TaskID: c.id,
		ExpectedState: "Review", ExpectedPRURL: c.expectedPRURL,
		ExpectedHeadSHA: c.expectedHeadSHA, Provider: c.provider,
		ReviewAttemptID: c.reviewAttemptID, ReviewerAgentID: c.reviewerAgentID,
	})
}

func operationForReview(name string) string {
	switch name {
	case "task request-review":
		return "request_review"
	case "task approve-review":
		return "approve_review"
	default:
		return "complete_review"
	}
}
