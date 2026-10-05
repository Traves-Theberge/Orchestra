package api

import (
	"context"
	"errors"

	"github.com/orchestra/orchestra/apps/backend/internal/control"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/reviewgate"
	"github.com/orchestra/orchestra/apps/backend/internal/reviewpipeline"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
)

func (s *Server) configureReviewControl(controls *control.Service) error {
	registry := s.orchestrator.AgentRegistry()
	if registry == nil {
		return nil
	}
	runner, err := reviewpipeline.New(s.orchestrator.StageContext(), s.db, registry,
		reviewpipeline.SnapshotLoaderFunc(func(ctx context.Context, project db.Project, number int) (*ghutil.ReviewSnapshot, error) {
			token, err := s.resolveGitHubToken(ctx, project)
			if err != nil {
				return nil, errors.New("Project GitHub credentials could not be resolved")
			}
			return ghutil.GetReviewSnapshot(ctx, project.GitHubOwner, project.GitHubRepo, token, number)
		}))
	if err != nil {
		return err
	}
	runner.SetSettledGuard(s.orchestrator.CheckTaskRuntimeSettled)
	controls.ConfigureReviewExecutor(func(ctx context.Context, request control.Request) map[string]any {
		if request.Operation == "reviewers" {
			return map[string]any{"success": true, "data": map[string]any{"providers": runner.Reviewers()}}
		}
		stageRequest := reviewpipeline.Request{
			Operation: request.Operation, ProjectID: request.ProjectID, TaskID: request.TaskID,
			ExpectedState: request.ExpectedState,
			RequestID:     request.RequestID, ExpectedPRURL: request.ExpectedPRURL,
			ExpectedHeadSHA: request.ExpectedHeadSHA, ReviewAttemptID: request.ReviewAttemptID,
			ReviewerProvider: request.Provider, ReviewerAgentID: request.ReviewerAgentID,
		}
		var gate reviewgate.Gate
		var err error
		switch request.Operation {
		case "approve_review":
			gate, err = runner.Approve(ctx, stageRequest)
		case "complete_review":
			var completion reviewgate.Completion
			completion, err = runner.CompleteMerged(ctx, stageRequest)
			gate = completion.Gate
		default:
			gate, err = runner.Execute(ctx, stageRequest)
		}
		if err != nil {
			code, message := "review_rejected", "PR review control could not be confirmed; refresh its exact task and PR before retrying"
			switch {
			case errors.Is(err, reviewpipeline.ErrUnsupportedReviewer), errors.Is(err, reviewpipeline.ErrReviewerExecutable):
				code, message = "reviewer_unavailable", "Selected harness does not support the required review stage controls"
			case errors.Is(err, reviewgate.ErrInvalidStatus):
				code, message = "review_state_conflict", "Review attempt is not ready for this operation"
			case errors.Is(err, reviewgate.ErrTaskUnsettled):
				code, message = "task_unsettled", "Task is not settled in Review"
			case errors.Is(err, reviewgate.ErrIdentityChanged), errors.Is(err, reviewpipeline.ErrPRSnapshotChanged), errors.Is(err, ghutil.ErrReviewSnapshotChanged):
				code, message = "review_identity_conflict", "Task or PR head changed; refresh before continuing"
			}
			return map[string]any{"success": false, "error": map[string]string{"code": code, "message": message}}
		}
		state := "Review"
		if request.Operation == "complete_review" {
			state = "Done"
		}
		return map[string]any{"success": true, "data": map[string]any{"review_gate": gate, "task_state": state}}
	})
	return nil
}
