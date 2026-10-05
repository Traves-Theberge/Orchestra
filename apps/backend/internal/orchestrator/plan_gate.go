package orchestrator

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

var ErrTaskUnsettled = errors.New("task has an active or unresolved run")

// PlanGate returns the durable human-approval state for a source-empty local
// SQLite task. Hosted sources remain unsupported until they provide a durable
// source-native gate contract.
func (s *Service) PlanGate(ctx context.Context, issue tracker.Issue) tracker.PlanGate {
	s.mu.RLock()
	database := s.db
	registry := s.agentRegistry
	defaultProvider := s.agentProvider
	s.mu.RUnlock()
	return withPlanningCapability(planGateForDB(ctx, database, issue), issue, registry, defaultProvider)
}

func withPlanningCapability(gate tracker.PlanGate, issue tracker.Issue, registry *agents.Registry, defaultProvider string) tracker.PlanGate {
	if gate.Status != "planning" || registry == nil {
		return gate
	}
	if agents.NormalizeRuntimeTarget(issue.RuntimeTarget) != agents.RuntimeLocal {
		gate.Status = "unsupported"
		gate.Reason = "Enforced read-only planning is available only for the local runtime; select LOCAL or use the explicit replan control after configuring a supported runtime."
		return gate
	}
	provider := strings.TrimSpace(issue.Provider)
	if provider == "" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(issue.AssigneeID)), "agent-") {
		provider = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(issue.AssigneeID)), "AGENT-")
	}
	if provider == "" {
		provider = strings.TrimSpace(defaultProvider)
	}
	if provider == "" || !registry.CanReadOnlyStage(agents.Provider(provider)) {
		gate.Status = "unsupported"
		gate.Reason = "Configured harness has no enforced local read-only planning adapter; select a supported harness or wait for an adapter."
	}
	return gate
}

func planGateForDB(ctx context.Context, database interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, issue tracker.Issue) tracker.PlanGate {
	if database == nil || issue.ID == "" || issue.ProjectID == "" {
		return tracker.PlanGate{Status: "unsupported"}
	}
	var sourceType, trackerConfigID sql.NullString
	if err := database.QueryRowContext(ctx, `SELECT issue_source_type,tracker_config_id FROM projects WHERE id=?`, issue.ProjectID).Scan(&sourceType, &trackerConfigID); err != nil || strings.TrimSpace(sourceType.String) != "" || strings.TrimSpace(trackerConfigID.String) != "" {
		return tracker.PlanGate{Status: "unsupported"}
	}
	gate, err := plangate.Status(ctx, database, issue)
	if err != nil {
		return tracker.PlanGate{Status: "unsupported"}
	}
	return gate
}

func (s *Service) currentPlanGateLocked(ctx context.Context, issue tracker.Issue) tracker.PlanGate {
	if s.db == nil || issue.ID == "" || issue.ProjectID == "" {
		return tracker.PlanGate{Status: "unsupported"}
	}
	current, _, err := plangate.LoadLocalTask(ctx, s.db, issue.ID, issue.ProjectID)
	if err != nil {
		return tracker.PlanGate{Status: "unsupported"}
	}
	if plangate.Fingerprint(*current) != plangate.Fingerprint(issue) {
		return tracker.PlanGate{Status: "changed"}
	}
	return withPlanningCapability(planGateForDB(ctx, s.db, *current), *current, s.agentRegistry, s.agentProvider)
}

// RecordPlanResult stores a plan and its durable approval fingerprint while
// leaving the issue in Todo. Empty output is recorded as a failed planning
// result so periodic refresh does not launch the same planning turn forever.
func (s *Service) RecordPlanResult(ctx context.Context, projectID, taskID, plan, expectedFingerprint string) error {
	s.mu.RLock()
	database := s.db
	s.mu.RUnlock()
	if database == nil {
		return errors.New("warehouse database unavailable")
	}
	var sourceType, trackerConfigID sql.NullString
	if err := database.QueryRowContext(ctx, `SELECT issue_source_type,tracker_config_id FROM projects WHERE id=?`, projectID).Scan(&sourceType, &trackerConfigID); err != nil || strings.TrimSpace(sourceType.String) != "" || strings.TrimSpace(trackerConfigID.String) != "" {
		return errors.New("durable plan gate is available only for source-empty local projects")
	}
	err := s.WithSettledTask(taskID, func() error {
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		issue, updatedAt, err := plangate.LoadLocalTask(ctx, tx, taskID, projectID)
		if err != nil {
			return fmt.Errorf("load exact task for plan result: %w", err)
		}
		if !strings.EqualFold(issue.State, "Todo") {
			return fmt.Errorf("planning result rejected because task is %s, not Todo", issue.State)
		}
		if expectedFingerprint == "" || plangate.Fingerprint(*issue) != expectedFingerprint {
			return errors.New("planning context changed while the provider turn was active")
		}
		oldPlan := issue.Plan
		action := "plan_failed"
		if strings.TrimSpace(plan) != "" {
			issue.Plan = plan
			action = "plan_ready"
		}
		result, err := tx.ExecContext(ctx, `UPDATE issues SET plan=?,updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Todo' AND updated_at=?`, issue.Plan, taskID, projectID, updatedAt)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil || rows != 1 {
			return errors.New("task changed while plan result was being saved")
		}
		fingerprint := plangate.Fingerprint(*issue)
		if _, err := tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), taskID, "Orchestrator", action, oldPlan, fingerprint); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err == nil {
		s.QueueRefresh()
	}
	return err
}

// StopIssue is the explicit stop/reset path. It holds the task in Backlog and
// durably invalidates any local plan approval without deleting task or
// workspace context. Generic state updates remain unable to reopen execution
// tasks through this transition.
func (s *Service) StopIssue(ctx context.Context, identifier string) (*tracker.Issue, error) {
	s.mu.RLock()
	client, database := s.trackerClient, s.db
	s.mu.RUnlock()
	if client == nil {
		return nil, errors.New("tracker client unavailable")
	}
	issue, err := client.FetchIssueByIdentifier(ctx, identifier)
	if err != nil {
		return nil, err
	}
	if issue == nil {
		return nil, sql.ErrNoRows
	}

	if database != nil && issue.ID != "" && issue.ProjectID != "" {
		var sourceType, configID sql.NullString
		err := database.QueryRowContext(ctx, `SELECT issue_source_type,tracker_config_id FROM projects WHERE id=?`, issue.ProjectID).Scan(&sourceType, &configID)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(sourceType.String) == "" && strings.TrimSpace(configID.String) == "" {
			tx, err := database.BeginTx(ctx, nil)
			if err != nil {
				return nil, err
			}
			defer tx.Rollback()
			current, updatedAt, err := plangate.LoadLocalTask(ctx, tx, issue.ID, issue.ProjectID)
			if err != nil {
				return nil, err
			}
			fingerprint := plangate.Fingerprint(*current)
			result, err := tx.ExecContext(ctx, `UPDATE issues SET state='Backlog',updated_at=datetime('now') WHERE id=? AND project_id=? AND updated_at=? AND state=?`, current.ID, current.ProjectID, updatedAt, current.State)
			if err != nil {
				return nil, err
			}
			if rows, _ := result.RowsAffected(); rows != 1 {
				return nil, errors.New("task changed while stop was being recorded")
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), current.ID, "User", "plan_invalidated", "", fingerprint); err != nil {
				return nil, err
			}
			if !strings.EqualFold(current.State, "Backlog") {
				if _, err := tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), current.ID, "User", "state_change", current.State, "Backlog"); err != nil {
					return nil, err
				}
			}
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			s.QueueRefresh()
			return client.FetchIssueByIdentifier(ctx, identifier)
		}
	}

	updated, err := client.UpdateIssue(ctx, identifier, map[string]any{"state": "Backlog"})
	if err != nil {
		return nil, err
	}
	s.QueueRefresh()
	return updated, nil
}

// WithSettledTask serializes an approval/replan mutation against queueing and
// claiming. The callback must be a bounded database-only transaction.
func (s *Service) WithSettledTask(taskID string, effect func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	if s.db != nil {
		var table string
		if err := s.db.QueryRowContext(context.Background(), `SELECT name FROM sqlite_master WHERE type='table' AND name='pr_review_attempts'`).Scan(&table); err == nil {
			var running int
			if err := s.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM pr_review_attempts WHERE task_id=? AND status='running'`, taskID).Scan(&running); err != nil {
				return fmt.Errorf("could not verify active pull request review: %w", err)
			}
			if running > 0 {
				return ErrTaskUnsettled
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("could not inspect pull request review state: %w", err)
		}
	}
	return effect()
}

// Ensure sql.Tx satisfies the query interface used by plangate.LoadLocalTask.
var _ plangate.QueryRower = (*sql.Tx)(nil)
