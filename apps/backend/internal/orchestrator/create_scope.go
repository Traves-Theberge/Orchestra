package orchestrator

import (
	"context"
	"errors"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

var ErrCreateSourceUnavailable = errors.New("selected project tracker unavailable; creation not sent")
var ErrCreateUnconfirmed = errors.New("task creation may have landed; inspect selected tracker before repeating")

// Creation never inherits another project's global tracker. Legacy unscoped
// requests retain their existing single-tracker behavior.
func (s *Service) clientForCreation(ctx context.Context, projectID string) (tracker.Client, string, error) {
	s.mu.RLock()
	database, registry, global := s.db, s.trackerReg, s.trackerClient
	workerIDs := append([]string(nil), s.trackerWorkerAssigneeIDs...)
	s.mu.RUnlock()
	if projectID == "" {
		return global, "", nil
	}
	if database == nil {
		return nil, "", ErrCreateSourceUnavailable
	}
	project, err := database.GetProjectByID(ctx, projectID)
	if err != nil {
		return nil, "", ErrCreateSourceUnavailable
	}
	if project.IssueSourceType == "" && project.TrackerConfigID == "" {
		return trackersqlite.NewClient(database, workerIDs), "sqlite", nil
	}
	if registry == nil {
		return nil, "", ErrCreateSourceUnavailable
	}
	var client tracker.Client
	source := project.IssueSourceType
	if source != "" {
		client, err = registry.GetForProjectDirect(project)
	} else {
		cfg, lookupErr := database.GetTrackerConfigForProject(ctx, projectID)
		if lookupErr != nil || cfg == nil {
			return nil, "", ErrCreateSourceUnavailable
		}
		source = cfg.Type
		client, err = registry.GetForProject(ctx, projectID)
	}
	if err != nil || client == nil || source == "" {
		return nil, "", ErrCreateSourceUnavailable
	}
	return client, source, nil
}

func confirmedCreatedIdentity(issue *tracker.Issue, projectID, source string) bool {
	if issue == nil || strings.TrimSpace(issue.ID) == "" || strings.TrimSpace(issue.Identifier) == "" {
		return false
	}
	if projectID == "" {
		return true
	}
	// SQLite's legacy projection omits Source; the selected client is known local.
	return issue.ProjectID == projectID && (issue.Source == source || source == "sqlite" && issue.Source == "")
}
