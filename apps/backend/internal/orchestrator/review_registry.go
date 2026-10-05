package orchestrator

import (
	"context"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/reviewgate"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// AgentRegistry returns the configured adapter catalog for bounded stage
// execution. An entry is not proof of supported stage policies or a live run.
func (s *Service) AgentRegistry() *agents.Registry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.agentRegistry
}

func (s *Service) SetStageContext(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stageContext = ctx
}

func (s *Service) StageContext() context.Context {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.stageContext == nil {
		return context.Background()
	}
	return s.stageContext
}

// CheckTaskRuntimeSettled ignores the review attempt itself; the review gate
// separately serializes review admission and settlement in its transaction.
func (s *Service) CheckTaskRuntimeSettled(ctx context.Context, projectID, taskID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, entry := range s.running {
		if entry.IssueID == taskID {
			return ErrTaskUnsettled
		}
	}
	for _, entry := range s.retrying {
		if entry.IssueID == taskID {
			return ErrTaskUnsettled
		}
	}
	return nil
}

// ReviewGate presents durable last-attempt evidence. Fresh PR identity is
// checked independently by every approval and completion operation.
func (s *Service) ReviewGate(ctx context.Context, issue tracker.Issue) *tracker.ReviewGate {
	s.mu.RLock()
	database := s.db
	s.mu.RUnlock()
	gate := reviewgate.Gate{Status: "unsupported"}
	if database == nil || issue.ID == "" || issue.ProjectID == "" {
		result := tracker.ReviewGate(gate)
		return &result
	}
	observed, err := reviewgate.ObserveStored(ctx, database, issue.ProjectID, issue.ID)
	if err != nil {
		result := tracker.ReviewGate(gate)
		return &result
	}
	if observed.PRURL != "" && (observed.PRURL != issue.PRURL || issue.State != "Review" && issue.State != "Done") {
		observed.Status = "stale"
	}
	result := tracker.ReviewGate(observed)
	return &result
}
