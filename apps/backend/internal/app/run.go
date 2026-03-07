package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/api"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/logfile"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/prompt"
	"github.com/orchestra/orchestra/apps/backend/internal/runtime"
	"github.com/orchestra/orchestra/apps/backend/internal/tools"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackergraphql "github.com/orchestra/orchestra/apps/backend/internal/tracker/graphql"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

func Run(logger zerolog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.APIToken == "" && runtime.HostRequiresToken(cfg.Host) {
		return fmt.Errorf("non-loopback host %q requires ORCHESTRA_API_TOKEN", cfg.Host)
	}

	addr := cfg.Host + ":" + cfg.PortString()
	orchestratorService := orchestrator.NewService()
	orchestratorService.SetStateSets(cfg.ActiveStates, cfg.TerminalStates)
	orchestratorService.SetMaxConcurrent(cfg.MaxConcurrent)
	orchestratorService.SetMaxConcurrentByState(cfg.MaxConcurrentByState)
	trackerClient := newTrackerClient(cfg)
	orchestratorService.SetTrackerClient(trackerClient)
	pubsub := observability.NewPubSub()

	agentRegistry := agents.NewRegistry(cfg.AgentCommands)
	provider := agents.Provider(cfg.AgentProvider)
	if !agentRegistry.HasProvider(provider) {
		return fmt.Errorf("agent provider %q is not configured", cfg.AgentProvider)
	}
	logger.Info().Str("agent_provider", cfg.AgentProvider).Str("service_id", runtime.ServiceOrchestrator).Msg("agent provider configured")

	router := api.NewRouterWithPubSub(logger, orchestratorService, cfg.WorkspaceRoot, cfg.Host, cfg.APIToken, pubsub)

	workspaceService := workspace.Service{Root: cfg.WorkspaceRoot}
	cleanupTerminalWorkspaces(orchestratorService, trackerClient, workspaceService, cfg.WorkspaceHooks, logger)

	go startRefreshWorker(orchestratorService, pubsub, logger)
	toolExecutor := tools.NewTrackerToolExecutor(trackerClient)
	go startExecutionWorker(orchestratorService, agentRegistry, provider, cfg.AgentProvider, cfg.WorkspaceRoot, cfg.WorkflowFile, cfg.AgentMaxTurns, toolExecutor.Execute, tools.TrackerToolSpecs(), cfg.WorkspaceHooks, pubsub, logger)

	logger.Info().Str("addr", addr).Str("service_id", runtime.ServiceOrchestrator).Msg("starting orchestrad")
	if err := http.ListenAndServe(addr, router); err != nil {
		return fmt.Errorf("listen and serve: %w", err)
	}

	return nil
}

func newTrackerClient(cfg config.Config) tracker.Client {
	if cfg.TrackerEndpoint != "" {
		return trackergraphql.NewClient(cfg.TrackerEndpoint, cfg.TrackerToken, cfg.TrackerProject, cfg.TrackerWorkerAssigneeIDs, nil)
	}
	return memory.NewClientWithWorkerAssignees(nil, cfg.TrackerWorkerAssigneeIDs)
}

func startExecutionWorker(
	service *orchestrator.Service,
	registry *agents.Registry,
	provider agents.Provider,
	providerName string,
	workspaceRoot string,
	workflowFile string,
	agentMaxTurns int,
	toolExecutor agents.ToolExecutor,
	toolSpecs []map[string]any,
	workspaceHooks workspace.Hooks,
	pubsub *observability.PubSub,
	logger zerolog.Logger,
) {
	workspaceService := workspace.Service{Root: workspaceRoot}
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		processExecutionTick(service, workspaceService, registry, provider, providerName, workspaceRoot, workflowFile, agentMaxTurns, toolExecutor, toolSpecs, workspaceHooks, pubsub, logger)
	}
}

func processExecutionTick(
	service *orchestrator.Service,
	workspaceService workspace.Service,
	registry *agents.Registry,
	provider agents.Provider,
	providerName string,
	workspaceRoot string,
	workflowFile string,
	agentMaxTurns int,
	toolExecutor agents.ToolExecutor,
	toolSpecs []map[string]any,
	workspaceHooks workspace.Hooks,
	pubsub *observability.PubSub,
	logger zerolog.Logger,
) {
	entry, ok := service.ClaimNextRunnable()
	if !ok {
		return
	}

	shouldDispatch, revalidateErr := service.RevalidateClaimedIssue(context.Background(), entry.IssueID)
	if revalidateErr != nil {
		service.ReleaseClaim(entry.IssueID)
		logger.Warn().Err(revalidateErr).Str("issue_id", entry.IssueID).Msg("issue revalidation failed; skipping dispatch")
		publishSnapshot(pubsub, service)
		return
	}
	if !shouldDispatch {
		logger.Info().Str("issue_id", entry.IssueID).Msg("issue no longer dispatchable after revalidation")
		publishSnapshot(pubsub, service)
		return
	}

	workspacePath, _, err := workspaceService.EnsureIssueWorkspace(entry.IssueIdentifier, workspaceHooks)
	if err != nil {
		attempt := entry.TurnCount + 1
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "run_failed", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         providerName,
			"attempt":          attempt,
			"error":            err.Error(),
			"cause":            "workspace_prepare_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "retry_scheduled", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         providerName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "workspace_prepare_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, entry.IssueIdentifier, attempt, dueAt, err)
		logger.Error().Err(err).Str("issue_id", entry.IssueID).Msg("workspace preparation failed")
		publishSnapshot(pubsub, service)
		return
	}
	runAfterHook := func() {
		_ = workspaceService.RunAfterRunHook(workspacePath, workspaceHooks)
	}

	if entry.TurnCount == 0 {
		if err := workspaceService.RunBeforeRunHook(workspacePath, workspaceHooks); err != nil {
			runAfterHook()
			attempt := entry.TurnCount + 1
			dueAt := service.NextRetryDue(entry.IssueID, attempt)
			publishLifecycleEvent(pubsub, "run_failed", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         providerName,
				"attempt":          attempt,
				"error":            err.Error(),
				"cause":            "before_run_hook_failed",
			})
			if service.ShouldRetryAttempt(attempt) {
				publishLifecycleEvent(pubsub, "retry_scheduled", map[string]any{
					"issue_id":         entry.IssueID,
					"issue_identifier": entry.IssueIdentifier,
					"provider":         providerName,
					"attempt":          attempt,
					"due_at":           dueAt.UTC().Format(time.RFC3339),
					"cause":            "before_run_hook_failed",
				})
			}
			service.RecordRunFailure(entry.IssueID, entry.IssueIdentifier, attempt, dueAt, err)
			logger.Error().Err(err).Str("issue_id", entry.IssueID).Msg("workspace before_run hook failed")
			publishSnapshot(pubsub, service)
			return
		}
	}

	attempt := entry.TurnCount + 1
	publishLifecycleEvent(pubsub, "run_started", map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         providerName,
		"attempt":          attempt,
	})
	renderedPrompt, promptErr := prompt.Build(workflowFile, prompt.BuildInput{
		Issue:   tracker.Issue{ID: entry.IssueID, Identifier: entry.IssueIdentifier, Title: entry.Title, State: entry.State},
		Attempt: attempt,
	})
	if promptErr != nil {
		logger.Warn().Err(promptErr).Str("issue_id", entry.IssueID).Msg("prompt build failed; using fallback prompt")
		renderedPrompt = buildExecutionPrompt(entry.IssueIdentifier, attempt)
	}

	result, runErr := registry.RunTurn(context.Background(), provider, agents.TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   workspaceRoot,
		Prompt:          renderedPrompt,
		IssueIdentifier: entry.IssueIdentifier,
		Attempt:         int(attempt),
		Timeout:         30 * time.Minute,
		AutoApprove:     true,
		ToolExecutor:    toolExecutor,
		ToolSpecs:       toolSpecs,
	}, func(event agents.Event) {
		service.RecordRunEvent(entry.IssueID, event)
		publishRunEvent(pubsub, entry, providerName, event)
	})

	if runErr != nil {
		runAfterHook()
		logPath, logErr := logfile.WriteSessionLog(workspaceRoot, entry.IssueIdentifier, result.SessionID, result.Output)
		if logErr == nil {
			service.RecordRunArtifact(entry.IssueID, result.SessionID, logPath)
		}
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "run_failed", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         providerName,
			"attempt":          attempt,
			"error":            runErr.Error(),
			"cause":            "agent_run_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "retry_scheduled", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         providerName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "agent_run_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, entry.IssueIdentifier, attempt, dueAt, runErr)
		logger.Error().Err(runErr).Str("issue_id", entry.IssueID).Msg("agent run failed")
		publishSnapshot(pubsub, service)
		return
	}

	logPath, logErr := logfile.WriteSessionLog(workspaceRoot, entry.IssueIdentifier, result.SessionID, result.Output)
	if logErr == nil {
		service.RecordRunArtifact(entry.IssueID, result.SessionID, logPath)
	}

	service.RecordRunResult(entry.IssueID, result.SessionID, result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.TotalTokens)

	continueTurn, checkErr := service.ShouldContinueTurn(context.Background(), entry.IssueID, attempt, agentMaxTurns)
	if checkErr != nil {
		runAfterHook()
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "run_failed", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         providerName,
			"attempt":          attempt,
			"error":            checkErr.Error(),
			"cause":            "continuation_check_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "retry_scheduled", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         providerName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "continuation_check_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, entry.IssueIdentifier, attempt, dueAt, checkErr)
		logger.Error().Err(checkErr).Str("issue_id", entry.IssueID).Msg("failed to check turn continuation")
		publishSnapshot(pubsub, service)
		return
	}

	if continueTurn {
		service.PrepareNextTurn(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "run_continues", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         providerName,
			"attempt":          attempt,
			"session_id":       result.SessionID,
		})
		logger.Info().Str("issue_id", entry.IssueID).Str("session_id", result.SessionID).Int64("attempt", attempt).Msg("turn completed; continuing")
		publishSnapshot(pubsub, service)
		return
	}

	service.RecordRunSuccess(entry.IssueID)
	publishLifecycleEvent(pubsub, "run_succeeded", map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         providerName,
		"attempt":          attempt,
		"session_id":       result.SessionID,
	})

	runAfterHook()

	logger.Info().Str("issue_id", entry.IssueID).Str("session_id", result.SessionID).Msg("agent run completed")
	publishSnapshot(pubsub, service)
}

func buildExecutionPrompt(issueIdentifier string, attempt int64) string {
	return fmt.Sprintf("Issue %s attempt %d. Follow WORKFLOW.md and implement required changes.", issueIdentifier, attempt)
}

func cleanupTerminalWorkspaces(service *orchestrator.Service, trackerClient tracker.Client, workspaceService workspace.Service, hooks workspace.Hooks, logger zerolog.Logger) {
	if trackerClient == nil {
		return
	}
	terminalStates := service.TerminalStates()
	issues, err := trackerClient.FetchIssuesByStates(context.Background(), terminalStates)
	if err != nil {
		logger.Warn().Err(err).Msg("startup terminal workspace cleanup skipped")
		return
	}

	for _, issue := range issues {
		if err := workspaceService.RemoveIssueWorkspaces(issue.Identifier, hooks); err != nil {
			logger.Warn().Err(err).Str("issue_identifier", issue.Identifier).Msg("startup workspace cleanup failed")
		}
	}
}

func startRefreshWorker(service *orchestrator.Service, pubsub *observability.PubSub, logger zerolog.Logger) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	service.QueueRefresh()

	for range ticker.C {
		service.QueueRefresh()
		if !service.RefreshPending() {
			continue
		}
		before := service.Snapshot()

		if err := service.PerformRefresh(context.Background()); err != nil {
			logger.Error().Err(err).Str("service_id", runtime.ServiceOrchestrator).Msg("refresh worker failed")
			publishSnapshot(pubsub, service)
			continue
		}
		after := service.Snapshot()
		publishRefreshRetryLifecycleEvents(pubsub, before, after)
		publishSnapshot(pubsub, service)
	}
}

func publishSnapshot(pubsub *observability.PubSub, service *orchestrator.Service) {
	if pubsub == nil || service == nil {
		return
	}
	pubsub.Publish(observability.Event{Type: "snapshot", Data: service.Snapshot()})
}

func publishLifecycleEvent(pubsub *observability.PubSub, eventType string, data map[string]any) {
	if pubsub == nil {
		return
	}
	if strings.TrimSpace(eventType) == "" {
		return
	}
	pubsub.Publish(observability.Event{Type: eventType, Data: data})
}

func publishRunEvent(pubsub *observability.PubSub, entry orchestrator.RunningEntry, providerName string, event agents.Event) {
	if pubsub == nil {
		return
	}

	pubsub.Publish(observability.Event{Type: "run_event", Data: map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         providerName,
		"event":            event,
	}})
}

func publishRefreshRetryLifecycleEvents(pubsub *observability.PubSub, before orchestrator.Snapshot, after orchestrator.Snapshot) {
	if pubsub == nil {
		return
	}

	existing := map[string]struct{}{}
	for _, retry := range before.Retrying {
		existing[retryLifecycleKey(retry)] = struct{}{}
	}

	for _, retry := range after.Retrying {
		key := retryLifecycleKey(retry)
		if _, ok := existing[key]; ok {
			continue
		}
		publishLifecycleEvent(pubsub, "run_failed", map[string]any{
			"issue_id":         retry.IssueID,
			"issue_identifier": retry.IssueIdentifier,
			"attempt":          retry.Attempt,
			"error":            retry.Error,
			"source":           "refresh",
			"cause":            classifyRefreshRetryCause(retry.Error),
		})
		publishLifecycleEvent(pubsub, "retry_scheduled", map[string]any{
			"issue_id":         retry.IssueID,
			"issue_identifier": retry.IssueIdentifier,
			"attempt":          retry.Attempt,
			"due_at":           retry.DueAt,
			"source":           "refresh",
			"error":            retry.Error,
			"cause":            classifyRefreshRetryCause(retry.Error),
		})
	}
}

func retryLifecycleKey(entry orchestrator.RetryEntry) string {
	return strings.TrimSpace(entry.IssueID) + "|" + fmt.Sprintf("%d", entry.Attempt) + "|" + strings.TrimSpace(entry.Error)
}

func classifyRefreshRetryCause(message string) string {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if strings.Contains(normalized, "stalled run exceeded timeout") || strings.Contains(normalized, "stalled") {
		return "stalled_timeout"
	}
	return "refresh_retry"
}
