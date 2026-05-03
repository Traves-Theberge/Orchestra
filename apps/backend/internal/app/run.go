// Package app wires together all subsystems and runs the orchestrad server,
// including the execution worker, refresh loop, garbage collector, and HTTP API.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/api"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/logfile"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/prompt"
	"github.com/orchestra/orchestra/apps/backend/internal/runtime"
	"github.com/orchestra/orchestra/apps/backend/internal/telemetry"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/orchestra/orchestra/apps/backend/internal/tools"
	"github.com/orchestra/orchestra/apps/backend/internal/usage"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackergithub "github.com/orchestra/orchestra/apps/backend/internal/tracker/github"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/jira"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/linear"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/sessionlogger"
	gitutil "github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

// Run initializes all subsystems (database, orchestrator, tracker, MCP, telemetry),
// wires up the HTTP API, and starts the orchestrad server with graceful shutdown
// handling. It blocks until the server exits.
// Run is the main entry point for the orchestrad server. It loads configuration,
// initializes the database, tracker, agent registry, workspace service, and MCP
// registry, then starts background workers and serves the HTTP API until shutdown.
func Run(logger zerolog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if cfg.APIToken == "" && runtime.HostRequiresToken(cfg.Host) {
		return fmt.Errorf("non-loopback host %q requires ORCHESTRA_API_TOKEN", cfg.Host)
	}

	addr := cfg.Host + ":" + cfg.PortString()

	dbPath := filepath.Join(cfg.WorkspaceRoot, ".orchestra", "warehouse.db")
	warehouseDB, err := db.Connect(dbPath)
	if err != nil {
		return fmt.Errorf("connect to warehouse db: %w", err)
	}

	orchestratorService := orchestrator.NewService()
	orchestratorService.SetDB(warehouseDB)
	if err := orchestratorService.RestoreStateFromDB(context.Background()); err != nil {
		logger.Warn().Err(err).Msg("failed to restore orchestrator state from DB")
	}

	orchestratorService.SetStateSets(cfg.ActiveStates, cfg.TerminalStates)
	orchestratorService.SetMaxConcurrent(cfg.MaxConcurrent)
	orchestratorService.SetMaxConcurrentByState(cfg.MaxConcurrentByState)
	orchestratorService.SetMaxTurns(cfg.AgentMaxTurns)

	// Build the tracker registry. Existing env-var configs are seeded into
	// tracker_configs on first run so legacy deployments keep working unchanged.
	factory := buildTrackerAdapterFactory(warehouseDB)
	trackerRegistry := trackerregistry.NewWithFactory(warehouseDB, factory)
	if err := seedTrackerConfigFromEnv(context.Background(), warehouseDB, cfg, trackerRegistry); err != nil {
		logger.Warn().Err(err).Msg("seed tracker config from env failed")
	}
	trackerClient := trackerRegistry.DefaultClient()
	if trackerClient == nil {
		trackerClient = newLegacyTrackerClient(cfg, warehouseDB)
	}
	orchestratorService.SetTrackerClient(trackerClient)
	orchestratorService.SetTrackerRegistry(trackerRegistry)
	pubsub := observability.NewPubSub()
	termManager := terminal.NewManager()

	agentRegistry := agents.NewRegistryWithTerminal(cfg.AgentCommands, termManager)

	// Register optional remote execution backends if configured.
	if cfg.TailscaleSSHHost != "" {
		tsTransport := agents.NewTailscaleRunner(
			agents.Provider(""), // no default provider — this is a transport
			"",                  // no default command — set at dispatch time
			cfg.TailscaleSSHHost,
			cfg.TailscaleSSHUser,
			cfg.TailscaleSSHKeyPath,
			cfg.TailscaleSSHPort,
			cfg.TailscaleWorktreeRoot,
		)
		agentRegistry.SetTransport(agents.RuntimeTailscale, tsTransport)
		logger.Info().Str("host", cfg.TailscaleSSHHost).Msg("Tailscale transport registered")
	}
	if cfg.KubeNamespace != "" && cfg.KubeGitRepoURL != "" {
		if clientset, k8sErr := agents.NewKubernetesClientset(cfg.KubeConfigPath); k8sErr != nil {
			logger.Warn().Err(k8sErr).Msg("Kubernetes transport unavailable — kubeconfig error")
		} else {
			k8sTransport := agents.NewKubernetesRunner(
				agents.Provider(""), // transport, not a provider
				"",
				clientset,
				cfg.KubeNamespace,
				cfg.KubeImage,
				cfg.KubeGitRepoURL,
				cfg.KubeServiceAccount,
			)
			agentRegistry.SetTransport(agents.RuntimeKubernetes, k8sTransport)
			logger.Info().Str("namespace", cfg.KubeNamespace).Msg("Kubernetes transport registered")
		}
	}

	provider := agents.Provider(cfg.AgentProvider)
	if !agentRegistry.HasProvider(provider) {
		return fmt.Errorf("agent provider %q is not configured", cfg.AgentProvider)
	}
	orchestratorService.SetAgentRegistry(agentRegistry, cfg.AgentCommands, cfg.AgentProvider)

	workspaceService := workspace.Service{Root: cfg.WorktreeRoot}
	orchestratorService.SetWorkspaceService(workspaceService)
	orchestratorService.SetWorkspaceRoot(cfg.WorkspaceRoot)

	// Prune stale worktree references left over from previous crashes.
	pruneAllWorktrees(warehouseDB, workspaceService, logger)

	// Initialize MCP (Merge Config + DB)
	allMCPServers := make(map[string]string)
	for k, v := range cfg.MCPServers {
		allMCPServers[k] = v
	}
	if dbServers, err := warehouseDB.ListMCPServers(context.Background()); err == nil {
		for _, s := range dbServers {
			allMCPServers[s.Name] = s.Command
		}
	}

	// Skip MCP server startup to prevent hanging - servers are managed externally
	mcpRegistry := mcp.NewRegistry(make(map[string]string), logger)
	orchestratorService.SetMCPRegistry(mcpRegistry, allMCPServers)

	logger.Info().Str("agent_provider", cfg.AgentProvider).Str("service_id", runtime.ServiceOrchestrator).Msg("agent provider configured")

	usageService, err := usage.NewService(filepath.Join(cfg.WorkspaceRoot, ".orchestra", "usage"), nil)
	if err != nil {
		logger.Warn().Err(err).Msg("usage service unavailable")
		usageService = nil
	}

	router := api.NewRouterWithPubSub(logger, orchestratorService, &cfg, pubsub, warehouseDB, termManager, usageService, trackerRegistry)

	cleanupTerminalWorkspaces(orchestratorService, trackerClient, workspaceService, cfg.WorkspaceHooks, warehouseDB, logger)

	go startGarbageCollector(orchestratorService, warehouseDB, workspaceService, cfg.TelemetryRetentionDays, logger)
	go startRefreshWorker(orchestratorService, trackerRegistry, warehouseDB, pubsub, logger)
	go startDailyMetricsRollup(warehouseDB, logger)
	go telemetry.StartWatcher(context.Background(), warehouseDB, cfg.ProjectRoots, telemetry.Options{
		Providers:       cfg.TelemetryProviders,
		StoreRawPayload: cfg.TelemetryStoreRawPayload,
	}, logger)

	// Initialize session logger
	var sessionLog *sessionlogger.Logger
	if slL, err := sessionlogger.NewLogger("0.1.0"); err != nil {
		logger.Warn().Err(err).Msg("session logger disabled")
	} else {
		sessionLog = slL
		logger.Info().Msg("session logging enabled")
	}

	toolExecutor := tools.NewLinearToolExecutor(trackerClient)
	go startExecutionWorker(orchestratorService, agentRegistry, provider, cfg.AgentProvider, cfg.WorkspaceRoot, cfg.WorkflowFile, cfg.AgentMaxTurns, toolExecutor.Execute, tools.TrackerToolSpecs(), cfg.WorkspaceHooks, pubsub, warehouseDB, sessionLog, termManager, &cfg, trackerRegistry, logger)

	logger.Info().Str("addr", addr).Str("service_id", runtime.ServiceOrchestrator).Msg("starting orchestrad")

	killStaleOrchestrad(cfg.PortString(), logger)

	// Use a custom listener with SO_REUSEADDR so the port is available immediately after restart.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	server := &http.Server{Handler: router}

	// Graceful shutdown on SIGTERM/SIGINT so the TUI can restart cleanly.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		logger.Info().Msg("shutting down orchestrad")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve: %w", err)
	}

	return nil
}

// killStaleOrchestrad kills any existing orchestrad process listening on the
// given port. This prevents accumulation of zombie daemons after crashes or
// unclean restarts. Best-effort: errors are logged and ignored.
func killStaleOrchestrad(port string, logger zerolog.Logger) {
	// fuser is available on Linux and most Unix systems.
	if err := exec.Command("fuser", "-k", port+"/tcp").Run(); err != nil {
		// fuser exits non-zero when no process is found — that's the normal case.
		return
	}
	logger.Info().Str("port", port).Msg("killed stale orchestrad process on port")
	// Brief pause so the port is fully released before we try to bind.
	time.Sleep(100 * time.Millisecond)
}

// newLegacyTrackerClient builds a tracker.Client from legacy env-var config.
// Used as a fallback when no tracker_configs rows exist (e.g. fresh local dev,
// or a tracker type the registry can't yet handle like sqlite/memory).
// GitHub is now handled by the tracker registry via seedTrackerConfigFromEnv.
func newLegacyTrackerClient(cfg config.Config, localDB *db.DB) tracker.Client {
	if localDB == nil {
		return memory.NewClient(nil)
	}
	return trackersqlite.NewClient(localDB, cfg.TrackerWorkerAssigneeIDs)
}

// buildTrackerAdapterFactory returns the AdapterFactory injected into the registry.
// Implemented as a closure so it can capture localDB for the GitHub adapter's
// DeleteIssue cleanup path.
// Lives here in app/run.go to break the import cycle: registry/ cannot import
// linear/ or jira/ directly.
func buildTrackerAdapterFactory(localDB *db.DB) trackerregistry.AdapterFactory {
	return func(cfg *db.TrackerConfig, token string) (tracker.Adapter, error) {
		switch strings.ToLower(cfg.Type) {
		case "linear":
			var extra struct {
				StateMap map[string]string `json:"state_map"`
			}
			if cfg.Extra != "" {
				_ = json.Unmarshal([]byte(cfg.Extra), &extra)
			}
			return linear.NewClient(cfg.Endpoint, token, nil, "", extra.StateMap), nil
		case "jira":
			var extra struct {
				JQL         string            `json:"jql"`
				StateMap    map[string]string `json:"state_map"`
				DefaultProj string            `json:"default_project"`
			}
			if cfg.Extra != "" {
				_ = json.Unmarshal([]byte(cfg.Extra), &extra)
			}
			// Jira Server uses Basic auth with user+token; Cloud uses Bearer (user empty).
			// We don't have a separate "user" column today — encode it in extra if Server.
			client := jira.NewClient(cfg.Endpoint, "", token, nil, extra.StateMap)
			if extra.JQL != "" {
				client.SetJQL(extra.JQL)
			}
			if extra.DefaultProj != "" {
				client.SetDefaultProject(extra.DefaultProj)
			}
			return client, nil
		case "github":
			parts := strings.Split(cfg.Endpoint, "/")
			if len(parts) != 2 {
				return nil, fmt.Errorf("github endpoint must be 'owner/repo', got %q", cfg.Endpoint)
			}
			// localDB enables DeleteIssue to clean up warehouse records.
			return trackergithub.NewClient(parts[0], parts[1], token, nil, localDB), nil
		default:
			return nil, fmt.Errorf("unsupported tracker type %q", cfg.Type)
		}
	}
}

// seedTrackerConfigFromEnv inserts a default tracker_configs row from legacy
// env vars if none exist. Zero behaviour change for existing deployments.
func seedTrackerConfigFromEnv(ctx context.Context, warehouse *db.DB, cfg config.Config, reg *trackerregistry.Registry) error {
	if warehouse == nil {
		return nil
	}
	existing, err := warehouse.ListTrackerConfigs(ctx)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}
	t := strings.ToLower(strings.TrimSpace(cfg.TrackerType))
	if t == "" || t == "sqlite" || t == "memory" {
		return nil
	}
	if t != "linear" && t != "jira" && t != "github" {
		return nil
	}
	encToken, err := db.EncryptToken(cfg.TrackerToken)
	if err != nil {
		encToken = cfg.TrackerToken
	}
	seed := db.TrackerConfig{
		ID:          "default",
		Type:        t,
		DisplayName: strings.ToUpper(t[:1]) + t[1:] + " (from env)",
		Endpoint:    cfg.TrackerEndpoint,
		AuthMethod:  "apikey",
		TokenEnc:    encToken,
	}
	if err := warehouse.UpsertTrackerConfig(ctx, seed); err != nil {
		return err
	}
	return reg.Reload(ctx, seed.ID)
}

// startExecutionWorker runs a tight polling loop that claims runnable issues
// and dispatches them to agents via processExecutionTick.
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
	warehouseDB *db.DB,
	sessionLog *sessionlogger.Logger,
	termManager *terminal.Manager,
	cfg *config.Config,
	trackerReg *trackerregistry.Registry,
	logger zerolog.Logger,
) {
	workspaceService := workspace.Service{Root: workspaceRoot}
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		processExecutionTick(service, workspaceService, registry, provider, providerName, workspaceRoot, workflowFile, agentMaxTurns, toolExecutor, toolSpecs, workspaceHooks, pubsub, warehouseDB, sessionLog, termManager, cfg, trackerReg, logger)
	}
}

// processExecutionTick claims the next runnable issue, revalidates it against
// the tracker, prepares the workspace and git branch, renders the prompt,
// executes the agent turn, and handles success, failure, and retry scheduling.
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
	warehouseDB *db.DB,
	sessionLog *sessionlogger.Logger,
	termManager *terminal.Manager,
	cfg *config.Config,
	trackerReg *trackerregistry.Registry,
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

	// Backfill title/description/project from tracker if missing (e.g. retry path creates entries without these fields)
	if entry.Title == "" || entry.Description == "" || entry.ProjectID == "" {
		issue, fetchErr := service.FetchIssueByID(context.Background(), entry.IssueID)
		if fetchErr == nil && issue != nil {
			if entry.Title == "" {
				entry.Title = issue.Title
			}
			if entry.Description == "" {
				entry.Description = issue.Description
			}
			if entry.ProjectID == "" {
				entry.ProjectID = issue.ProjectID
			}
		}
	}

	// Resolve provider from entry or configuration
	activeProvider := provider
	activeProviderName := providerName

	if entry.Provider != "" {
		candidate := agents.NormalizeProvider(entry.Provider)
		if registry.HasProvider(candidate) {
			activeProvider = candidate
			activeProviderName = string(candidate)
		}
	} else if entry.AssigneeID != "" {
		// Fallback: Resolve provider from assignee if possible
		p := strings.TrimPrefix(entry.AssigneeID, "agent-")
		candidate := agents.NormalizeProvider(p)
		if registry.HasProvider(candidate) {
			activeProvider = candidate
			activeProviderName = string(candidate)
		}
	}

	// Require a project with a valid git repo to dispatch into a per-issue worktree.
	var workspacePath string
	var effectiveWorkspaceRoot string
	var created bool
	var createRes workspace.HookResult
	var err error
	var resolvedProject db.Project

	if entry.ProjectID == "" || warehouseDB == nil {
		logger.Error().Str("issue_id", entry.IssueID).Str("project_id", entry.ProjectID).Bool("db_nil", warehouseDB == nil).Msg("issue has no project or db is nil; cannot dispatch")
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, entry.TurnCount+1, service.NextRetryDue(entry.IssueID, entry.TurnCount+1), fmt.Errorf("no project or database"))
		publishSnapshot(pubsub, service)
		return
	}

	project, projErr := warehouseDB.GetProjectByID(context.Background(), entry.ProjectID)
	if projErr != nil {
		logger.Error().Err(projErr).Str("issue_id", entry.IssueID).Str("project_id", entry.ProjectID).Msg("failed to lookup project for workspace")
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, entry.TurnCount+1, service.NextRetryDue(entry.IssueID, entry.TurnCount+1), projErr)
		publishSnapshot(pubsub, service)
		return
	}
	resolvedProject = project

	// Override the global tool executor with one scoped to this project's tracker.
	// Falls back to the global executor if the project has no issue source configured.
	if trackerReg != nil {
		if projectClient, clientErr := trackerReg.GetForProjectDirect(resolvedProject); clientErr == nil && projectClient != nil {
			toolExecutor = tools.NewLinearToolExecutor(projectClient).Execute
		}
	}

	if project.RootPath == "" || !filepath.IsAbs(project.RootPath) {
		errMsg := fmt.Errorf("project root path is empty or not absolute: %q", project.RootPath)
		logger.Error().Str("issue_id", entry.IssueID).Str("root_path", project.RootPath).Msg(errMsg.Error())
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, entry.TurnCount+1, service.NextRetryDue(entry.IssueID, entry.TurnCount+1), errMsg)
		publishSnapshot(pubsub, service)
		return
	}
	if info, statErr := os.Stat(project.RootPath); statErr != nil || !info.IsDir() {
		errMsg := fmt.Errorf("project root path does not exist or is not a directory: %s", project.RootPath)
		logger.Error().Str("issue_id", entry.IssueID).Str("root_path", project.RootPath).Msg(errMsg.Error())
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, entry.TurnCount+1, service.NextRetryDue(entry.IssueID, entry.TurnCount+1), errMsg)
		publishSnapshot(pubsub, service)
		return
	}
	if !gitutil.IsGitRepo(project.RootPath) {
		errMsg := fmt.Errorf("project root is not a git repository: %s", project.RootPath)
		logger.Error().Str("issue_id", entry.IssueID).Str("root_path", project.RootPath).Msg(errMsg.Error())
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, entry.TurnCount+1, service.NextRetryDue(entry.IssueID, entry.TurnCount+1), errMsg)
		publishSnapshot(pubsub, service)
		return
	}

	effectiveWorkspaceRoot = filepath.Dir(project.RootPath)

	// Use the issue identifier as branch name. If the issue already has a
	// branch_name from a previous dispatch, reuse it for continuity.
	branchName := strings.ToLower(strings.ReplaceAll(entry.IssueIdentifier, " ", "-"))
	if existingIssue, lookupErr := service.FetchIssueByID(context.Background(), entry.IssueID); lookupErr == nil && existingIssue.BranchName != "" {
		branchName = existingIssue.BranchName
	}
	publishLifecycleEvent(pubsub, "HOOK_STARTED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_create"})

	// Clean up stale worktree refs and branches before creating
	pruneCmd := exec.CommandContext(context.Background(), "git", "worktree", "prune")
	pruneCmd.Dir = project.RootPath
	_ = pruneCmd.Run()

	var wtPath string
	var baseSHA string
	wtPath, baseSHA, created, err = workspaceService.EnsureWorktree(project.RootPath, project.ID, branchName, workspaceHooks)
	if err == nil {
		workspacePath = wtPath
		service.SetWorktreePath(entry.IssueID, wtPath)
		logger.Info().Str("issue_id", entry.IssueID).Str("worktree", wtPath).Bool("created", created).Msg("worktree ready")

		if baseSHA != "" {
			if _, updateErr := service.UpdateIssue(context.Background(), entry.IssueIdentifier, map[string]any{"base_sha": baseSHA, "branch_name": branchName}); updateErr != nil {
				logger.Warn().Err(updateErr).Msg("failed to store base_sha/branch_name on issue")
			}
		}
	}
	if err != nil {
		publishLifecycleEvent(pubsub, "HOOK_FAILED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_create", "error": err.Error(), "output": createRes.Output})
		attempt := entry.TurnCount + 1
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "RUN_FAILED", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         activeProviderName,
			"attempt":          attempt,
			"error":            err.Error(),
			"cause":            "workspace_prepare_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "RETRY_SCHEDULED", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         activeProviderName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "workspace_prepare_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, attempt, dueAt, err)
		logger.Error().Err(err).Str("issue_id", entry.IssueID).Str("provider", activeProviderName).Msg("workspace preparation failed")
		publishSnapshot(pubsub, service)
		return
	}
	if created {
		publishLifecycleEvent(pubsub, "HOOK_COMPLETED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_create", "output": createRes.Output})
	} else {
		// Even if not created, we mark it as completed since we "ensured" it exists
		publishLifecycleEvent(pubsub, "HOOK_COMPLETED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_create", "reused": true})
	}
	runAfterHook := func() {
		publishLifecycleEvent(pubsub, "HOOK_STARTED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_run"})
		if res, err := workspaceService.RunAfterRunHook(workspacePath, workspaceHooks); err != nil {
			publishLifecycleEvent(pubsub, "HOOK_FAILED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_run", "error": err.Error(), "output": res.Output})
		} else {
			publishLifecycleEvent(pubsub, "HOOK_COMPLETED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "after_run", "output": res.Output})
		}
	}

	if entry.TurnCount == 0 {
		// Branch creation and base SHA recording are handled by EnsureWorktree above.

		publishLifecycleEvent(pubsub, "HOOK_STARTED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "before_run"})
		if res, err := workspaceService.RunBeforeRunHook(workspacePath, workspaceHooks); err != nil {
			publishLifecycleEvent(pubsub, "HOOK_FAILED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "before_run", "error": err.Error(), "output": res.Output})
			runAfterHook()
			attempt := entry.TurnCount + 1
			dueAt := service.NextRetryDue(entry.IssueID, attempt)
			publishLifecycleEvent(pubsub, "RUN_FAILED", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         activeProviderName,
				"attempt":          attempt,
				"error":            err.Error(),
				"cause":            "before_run_hook_failed",
			})
			if service.ShouldRetryAttempt(attempt) {
				publishLifecycleEvent(pubsub, "RETRY_SCHEDULED", map[string]any{
					"issue_id":         entry.IssueID,
					"issue_identifier": entry.IssueIdentifier,
					"provider":         activeProviderName,
					"attempt":          attempt,
					"due_at":           dueAt.UTC().Format(time.RFC3339),
					"cause":            "before_run_hook_failed",
				})
			}
			service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, attempt, dueAt, err)
			logger.Error().Err(err).Str("issue_id", entry.IssueID).Str("provider", activeProviderName).Msg("workspace before_run hook failed")
			publishSnapshot(pubsub, service)
			return
		}
		publishLifecycleEvent(pubsub, "HOOK_COMPLETED", map[string]any{"issue_id": entry.IssueID, "issue_identifier": entry.IssueIdentifier, "hook_type": "before_run"})
	}

	attempt := entry.TurnCount + 1
	publishLifecycleEvent(pubsub, "RUN_STARTED", map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         activeProviderName,
		"attempt":          attempt,
	})
	renderedPrompt, promptErr := prompt.Build(workflowFile, prompt.BuildInput{
		Issue:   tracker.Issue{ID: entry.IssueID, Identifier: entry.IssueIdentifier, Title: entry.Title, Description: entry.Description, State: entry.State},
		Attempt: attempt,
	})
	if promptErr != nil {
		logger.Warn().Err(promptErr).Str("issue_id", entry.IssueID).Msg("prompt build failed; using fallback prompt")
		renderedPrompt = buildExecutionPrompt(entry.IssueIdentifier, entry.Title, entry.Description, attempt)
	}

	// Include the original plan from the planning phase so the agent
	// executes the SAME plan instead of creating a new one each turn.
	if strings.EqualFold(entry.State, "In Progress") && warehouseDB != nil {
		originalPlan := extractOriginalPlan(warehouseDB, entry.IssueID)
		if originalPlan != "" {
			renderedPrompt += "\n\n## YOUR PLAN (from planning phase — execute this, do NOT create a new plan)\n\n" + originalPlan
		}
	}

	// On subsequent turns, append prior turn context so agent knows what it already did
	if attempt > 1 && warehouseDB != nil {
		priorContext := buildPriorTurnContext(warehouseDB, entry.IssueID, entry.IssueIdentifier)
		if priorContext != "" {
			renderedPrompt += "\n\n" + priorContext
		}
	}

	runCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.RegisterCancel(entry.IssueID, activeProviderName, cancel)
	defer service.DeregisterCancel(entry.IssueID, activeProviderName)

	var eventsBuffer []agents.Event

	// Fetch MCP tools and resources
	allToolSpecs := make([]map[string]any, 0, len(toolSpecs))
	disabledSet := make(map[string]struct{})
	// Fetch issue to get disabled tools if using SQLite or memory tracker
	// For now, assume trackerClient has populated DisabledTools if applicable
	for _, dt := range entry.DisabledTools {
		disabledSet[strings.ToLower(dt)] = struct{}{}
	}

	for _, ts := range toolSpecs {
		if name, ok := ts["name"].(string); ok {
			if _, disabled := disabledSet[strings.ToLower(name)]; !disabled {
				allToolSpecs = append(allToolSpecs, ts)
			}
		}
	}

	var allResourceSpecs []map[string]any

	if mcpReg := service.GetMCPRegistry(); mcpReg != nil {
		mcpTools, _ := mcpReg.ListTools(runCtx)
		for _, mt := range mcpTools {
			if name, ok := mt["name"].(string); ok {
				if _, disabled := disabledSet[strings.ToLower(name)]; !disabled {
					allToolSpecs = append(allToolSpecs, mt)
				}
			}
		}

		mcpResources, _ := mcpReg.ListResources(runCtx)
		allResourceSpecs = append(allResourceSpecs, mcpResources...)
	}

	// Tool executor that first tries MCP routing, then falls back to the
	// tracker / linear executor. Context flows from the active turn so a
	// cancelled run cleanly aborts in-flight tracker / MCP calls.
	mcpAwareExecutor := func(ctx context.Context, tool string, args map[string]any) map[string]any {
		if mcpReg := service.GetMCPRegistry(); mcpReg != nil {
			if strings.Contains(tool, "_") {
				parts := strings.SplitN(tool, "_", 2)
				serverName := parts[0]
				toolName := parts[1]
				res, err := mcpReg.ExecuteTool(ctx, serverName, toolName, args)
				if err == nil {
					return res
				}
			}
		}
		return toolExecutor(ctx, tool, args)
	}

	sessionID := fmt.Sprintf("%s-%d", entry.IssueIdentifier, time.Now().UnixNano())
	_ = logfile.ResetLatestLog(workspaceRoot, entry.IssueIdentifier, sessionID)
	sessionLogPath := filepath.Join(workspaceRoot, "_logs", logfile.Sanitize(entry.IssueIdentifier), "latest.log")
	service.RecordRunArtifact(entry.IssueID, activeProviderName, sessionID, sessionLogPath)

	// Start session logging
	if sessionLog != nil {
		if err := sessionLog.StartSession(sessionID, workspaceRoot, renderedPrompt); err != nil {
			logger.Warn().Err(err).Msg("session-logger: failed to start session")
		}
		_ = sessionLog.LogUserMessage(sessionID, renderedPrompt)
	}

	if warehouseDB != nil {
		// Link session to the task's project — never create new projects from the execution worker
		_ = warehouseDB.RecordSession(context.Background(), sessionID, entry.ProjectID, entry.IssueID, sessionID, activeProviderName, "", "main")
	}

	result, runErr := registry.RunTurn(runCtx, activeProvider, agents.TurnRequest{
		SessionID:       sessionID,
		Workspace:       workspacePath,
		WorkspaceRoot:   effectiveWorkspaceRoot,
		Prompt:          renderedPrompt,
		IssueIdentifier: entry.IssueIdentifier,
		Attempt:         int(attempt),
		Timeout:         30 * time.Minute,
		AutoApprove:     true,
		ToolExecutor:    mcpAwareExecutor,
		ToolSpecs:       allToolSpecs,
		ResourceSpecs:   allResourceSpecs,
		RuntimeTarget:   agents.NormalizeRuntimeTarget(entry.RuntimeTarget),
	}, func(event agents.Event) {
		service.RecordRunEvent(entry.IssueID, activeProviderName, event)
		publishRunEvent(pubsub, entry, activeProviderName, event)
		eventsBuffer = append(eventsBuffer, event)

		// Live plan update: if this event contains checkboxes with [x] marks,
		// update the issue's plan field so the UI reflects progress in real-time.
		if msg := strings.TrimSpace(event.Message); msg != "" && strings.Contains(msg, "- [x]") {
			checkboxCount := 0
			for _, line := range strings.Split(msg, "\n") {
				t := strings.TrimSpace(line)
				if strings.HasPrefix(t, "- [") || strings.HasPrefix(t, "* [") {
					checkboxCount++
				}
			}
			if checkboxCount >= 3 {
				_, _ = service.UpdateIssue(context.Background(), entry.IssueIdentifier, map[string]any{"plan": msg})
			}
		}

		// Persist to database in real-time
		if warehouseDB != nil && event.SessionID != "" {
			// Skip recording PTY echo noise (echoed prompts, shell decorations)
			if event.Kind == "pty" && (event.Message == "" || len(event.Message) < 5) {
				// skip
			} else if event.Kind == "pty" && (strings.Contains(event.Message, "## Instructions") || strings.Contains(event.Message, "## Task") || strings.Contains(event.Message, "step one")) {
				// skip PTY events that are just the echoed prompt
			} else {
				eventID := uuid.New().String()
				raw, _ := json.Marshal(event.Raw)
				_ = warehouseDB.RecordEvent(context.Background(), eventID, event.SessionID, event.Kind, event.Message, raw, int(event.Usage.InputTokens), int(event.Usage.OutputTokens), event.Timestamp.Format(time.RFC3339))
			}
		}

		// Append to log file in real-time
		if event.SessionID != "" {
			line := event.RawLine
			if line == "" && event.Raw != nil {
				// Reconstruct raw line from event data for providers that don't set RawLine
				if raw, err := json.Marshal(event.Raw); err == nil {
					line = string(raw)
				}
			}
			if line != "" {
				_, _ = logfile.AppendToSessionLog(workspaceRoot, entry.IssueIdentifier, event.SessionID, line+"\n")
			}
		}

		// Write structured session log JSONL
		if sessionLog != nil {
			logEventToSessionLog(sessionLog, sessionID, activeProviderName, event)
		}

		// Log to stdout for TUI visibility
		if event.Message != "" {
			logger.Info().
				Str("issue", entry.IssueIdentifier).
				Str("provider", activeProviderName).
				Str("kind", event.Kind).
				Msg(event.Message)
		}
	})

	if runErr != nil {
		runAfterHook()
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "RUN_FAILED", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         activeProviderName,
			"attempt":          attempt,
			"error":            runErr.Error(),
			"cause":            "agent_run_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "RETRY_SCHEDULED", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         activeProviderName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "agent_run_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, attempt, dueAt, runErr)
		logger.Error().Err(runErr).Str("issue_id", entry.IssueID).Str("provider", activeProviderName).Msg("agent run failed")
		publishSnapshot(pubsub, service)
		return
	}

	service.RecordRunResult(entry.IssueID, activeProviderName, result.SessionID, result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.TotalTokens)

	// Both planning (Todo) and execution (InProgress) complete in 1 turn.
	// Claude Code handles the full task in a single session — re-invoking
	// causes re-planning and context loss. The agent plans OR executes the
	// entire plan in one invocation.
	effectiveMaxTurns := 1
	continueTurn, checkErr := service.ShouldContinueTurn(context.Background(), entry.IssueID, activeProviderName, attempt, effectiveMaxTurns)
	if checkErr != nil {
		runAfterHook()
		dueAt := service.NextRetryDue(entry.IssueID, attempt)
		publishLifecycleEvent(pubsub, "RUN_FAILED", map[string]any{
			"issue_id":         entry.IssueID,
			"issue_identifier": entry.IssueIdentifier,
			"provider":         providerName,
			"attempt":          attempt,
			"error":            checkErr.Error(),
			"cause":            "continuation_check_failed",
		})
		if service.ShouldRetryAttempt(attempt) {
			publishLifecycleEvent(pubsub, "RETRY_SCHEDULED", map[string]any{
				"issue_id":         entry.IssueID,
				"issue_identifier": entry.IssueIdentifier,
				"provider":         providerName,
				"attempt":          attempt,
				"due_at":           dueAt.UTC().Format(time.RFC3339),
				"cause":            "continuation_check_failed",
			})
		}
		service.RecordRunFailure(entry.IssueID, activeProviderName, entry.IssueIdentifier, attempt, dueAt, checkErr)
		logger.Error().Err(checkErr).Str("issue_id", entry.IssueID).Msg("failed to check turn continuation")
		publishSnapshot(pubsub, service)
		return
	}

	if continueTurn {
		service.PrepareNextTurn(entry.IssueID, activeProviderName, attempt)
		publishLifecycleEvent(pubsub, "RUN_CONTINUES", map[string]any{
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

	// Close session log on success
	if sessionLog != nil {
		_ = sessionLog.CloseSession(sessionID, &sessionlogger.Usage{
			InputTokens:  result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens,
			TotalTokens:  result.Usage.TotalTokens,
		})
	}

	service.RecordRunSuccess(entry.IssueID, activeProviderName)

	// Auto-commit agent work on the task branch
	if workspacePath != "" {
		commitMsg := fmt.Sprintf("feat(%s): %s\n\nImplemented by %s agent via Orchestra",
			entry.IssueIdentifier, entry.Title, activeProviderName)
		if commitErr := gitutil.Commit(context.Background(), workspacePath, commitMsg); commitErr != nil {
			logger.Warn().Err(commitErr).Str("issue_id", entry.IssueID).Msg("auto-commit failed (may have no changes)")
		} else {
			logger.Info().Str("issue_id", entry.IssueID).Msg("auto-committed agent work")
		}
	}

	// Push the task branch to remote
	if pushErr := gitutil.Push(context.Background(), workspacePath, "origin", branchName); pushErr != nil {
		logger.Warn().Err(pushErr).Msg("auto-push failed (remote may not be configured)")
	} else {
		logger.Info().Str("branch", branchName).Msg("auto-pushed task branch")
	}

	// Close the agent's terminal session now that it's done
	if termManager != nil {
		terminalID := fmt.Sprintf("issue-%s", entry.IssueIdentifier)
		termManager.CloseSession(terminalID)
		logger.Info().Str("terminal_id", terminalID).Msg("closed agent terminal session")
	}

	// Auto-advance on successful completion — use live DB state to avoid stale dispatch entry.
	// If the issue was deleted while the agent was running, bail out silently.
	liveIssue, liveErr := service.FetchIssueByID(context.Background(), entry.IssueID)
	if liveErr != nil {
		logger.Warn().Str("issue_id", entry.IssueID).Str("identifier", entry.IssueIdentifier).Msg("issue no longer exists after run — skipping post-run actions")
		return
	}
	currentState := liveIssue.State
	if strings.EqualFold(currentState, "Todo") {
		// Extract the plan from the agent's output and store it on the issue
		// so the execution phase can include it in the prompt.
		// Try extracting plan from in-memory data first
		plan := extractPlanFromResult(result, eventsBuffer)
		// If not found in memory, wait briefly then try from DB (events may have flushed)
		if plan == "" && warehouseDB != nil {
			time.Sleep(500 * time.Millisecond)
			plan = extractOriginalPlan(warehouseDB, entry.IssueID)
		}
		updateFields := map[string]any{"state": "In Progress"}
		if plan != "" {
			updateFields["plan"] = plan
			logger.Info().Str("issue_id", entry.IssueID).Int("plan_length", len(plan)).Msg("extracted plan from planning phase")
		} else {
			logger.Warn().Str("issue_id", entry.IssueID).Msg("no plan found — agent may not have output checkboxes")
		}
		logger.Info().Str("issue_id", entry.IssueID).Msg("planning complete; auto-advancing to In Progress")
		if _, err := service.UpdateIssue(context.Background(), entry.IssueIdentifier, updateFields); err != nil {
			logger.Error().Err(err).Str("issue_id", entry.IssueID).Msg("FAILED to auto-advance to In Progress")
		}
	} else if strings.EqualFold(currentState, "In Progress") {
		// Extract updated plan with checked-off items from the execution output.
		updatedPlan := extractPlanFromResult(result, eventsBuffer)
		if updatedPlan == "" && warehouseDB != nil {
			time.Sleep(500 * time.Millisecond)
			updatedPlan = extractOriginalPlan(warehouseDB, entry.IssueID)
		}
		// If the extracted plan has no checked items, the agent didn't restate
		// the plan with [x] marks. Since the run completed successfully, mark
		// all checkboxes as done as a fallback.
		if updatedPlan != "" && !strings.Contains(updatedPlan, "- [x]") && !strings.Contains(updatedPlan, "- [X]") {
			updatedPlan = strings.ReplaceAll(updatedPlan, "- [ ]", "- [x]")
			updatedPlan = strings.ReplaceAll(updatedPlan, "* [ ]", "* [x]")
			logger.Info().Str("issue_id", entry.IssueID).Msg("auto-checked plan items — agent completed without restating checkboxes")
		}

		// Gate: if the plan still has unchecked items, don't advance to Review.
		// Save progress and stay in In Progress so the orchestrator dispatches
		// another turn to finish the remaining steps.
		hasUnchecked := strings.Contains(updatedPlan, "- [ ]") || strings.Contains(updatedPlan, "* [ ]")
		if hasUnchecked && entry.TurnCount < 20 {
			logger.Info().Str("issue_id", entry.IssueID).Int64("turn", entry.TurnCount).Msg("plan has unchecked items — staying in In Progress for another turn")
			if updatedPlan != "" {
				if _, err := service.UpdateIssue(context.Background(), entry.IssueIdentifier, map[string]any{"plan": updatedPlan}); err != nil {
					logger.Warn().Err(err).Msg("failed to save partial plan progress")
				}
			}
			// Don't advance — the orchestrator will re-dispatch
			return
		}

		updateFields := map[string]any{"state": "Review"}
		if updatedPlan != "" {
			updateFields["plan"] = updatedPlan
			logger.Info().Str("issue_id", entry.IssueID).Int("plan_length", len(updatedPlan)).Msg("updated plan with execution progress")
		}
		logger.Info().Str("issue_id", entry.IssueID).Msg("execution complete; auto-advancing to Review")
		if _, err := service.UpdateIssue(context.Background(), entry.IssueIdentifier, updateFields); err != nil {
			logger.Error().Err(err).Str("issue_id", entry.IssueID).Msg("FAILED to auto-advance to Review")
		}

		// If a PR already exists, push the branch so new commits appear on the PR.
		if liveIssue.PRURL != "" && workspacePath != "" {
			branchName := liveIssue.BranchName
			if branchName == "" {
				branchName = strings.ToLower(strings.ReplaceAll(entry.IssueIdentifier, " ", "-"))
			}
			pushCmd := exec.CommandContext(context.Background(), "git", "push", "--force-with-lease", "-u", "origin", branchName)
			pushCmd.Dir = workspacePath
			if pushOut, pushErr := pushCmd.CombinedOutput(); pushErr != nil {
				logger.Warn().Err(pushErr).Str("output", string(pushOut)).Str("branch", branchName).Msg("failed to push branch after feedback cycle")
			} else {
				logger.Info().Str("issue_id", entry.IssueID).Str("branch", branchName).Msg("pushed branch to update existing PR")
			}
		}
	} else {
		logger.Info().Str("issue_id", entry.IssueID).Str("state", currentState).Msg("run succeeded but state is not auto-advanceable; skipping")
	}

	publishLifecycleEvent(pubsub, "RUN_SUCCEEDED", map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         providerName,
		"attempt":          attempt,
		"session_id":       result.SessionID,
	})

	runAfterHook()

	// Post completion comment to GitHub issue if linked
	if entry.ProjectID != "" && warehouseDB != nil {
		// Extract the last substantive agent message for the summary
		agentSummary := ""
		for i := len(eventsBuffer) - 1; i >= 0; i-- {
			msg := strings.TrimSpace(eventsBuffer[i].Message)
			if msg != "" && len(msg) > 50 {
				agentSummary = msg
				break
			}
		}

		go func() {
			project := resolvedProject
			diffDir := workspacePath // use worktree path for diff stats
			if diffDir == "" {
				diffDir = project.RootPath
			}
			if project.GitHubOwner == "" || project.GitHubRepo == "" || project.GitHubToken == "" {
				return
			}
			issue, fetchErr := service.FetchIssueByID(context.Background(), entry.IssueID)
			if fetchErr != nil || issue == nil || issue.URL == "" {
				return
			}
			issueNumber := extractGitHubIssueNumber(issue.URL)
			if issueNumber <= 0 {
				return
			}

			// Get git diff stats for the comment
			diffStats := ""
			if diffDir != "" {
				cmd := exec.Command("git", "-C", diffDir, "diff", "--stat", "HEAD")
				if out, err := cmd.Output(); err == nil && len(out) > 0 {
					diffStats = string(out)
				}
			}

			// Get list of changed files
			changedFiles := ""
			if diffDir != "" {
				cmd := exec.Command("git", "-C", diffDir, "diff", "--name-only", "HEAD")
				if out, err := cmd.Output(); err == nil && len(out) > 0 {
					changedFiles = strings.TrimSpace(string(out))
				}
				// Also include untracked files
				cmd2 := exec.Command("git", "-C", diffDir, "ls-files", "--others", "--exclude-standard")
				if out2, err := cmd2.Output(); err == nil && len(out2) > 0 {
					if changedFiles != "" {
						changedFiles += "\n"
					}
					changedFiles += strings.TrimSpace(string(out2))
				}
			}

			comment := fmt.Sprintf("## %s Agent Run Completed\n\n", strings.ToUpper(activeProviderName))
			comment += fmt.Sprintf("**Issue**: %s\n**Agent**: %s\n**Turns**: %d\n\n", entry.IssueIdentifier, activeProviderName, entry.TurnCount+1)

			if agentSummary != "" {
				comment += "### Summary\n\n" + agentSummary + "\n\n"
			}

			if changedFiles != "" {
				files := strings.Split(changedFiles, "\n")
				comment += "### Files Changed\n\n"
				for _, f := range files {
					f = strings.TrimSpace(f)
					if f != "" {
						comment += "- `" + f + "`\n"
					}
				}
				comment += "\n"
			}

			if diffStats != "" {
				comment += "### Diff Stats\n\n```\n" + strings.TrimSpace(diffStats) + "\n```\n\n"
			}

			comment += "---\n*Automatically posted by [Orchestra](https://github.com/Traves-Theberge/Orchestra)*"

			// Resolve a valid token, refreshing if expired
			token, updatedJSON, tokenErr := ghutil.RefreshableToken(context.Background(), project.GitHubToken, cfg.GitHubClientID, cfg.GitHubClientSecret)
			if tokenErr != nil {
				logger.Warn().Err(tokenErr).Str("issue_id", entry.IssueID).Msg("failed to resolve github token for comment")
				return
			}
			if updatedJSON != "" {
				if enc, encErr := db.EncryptToken(updatedJSON); encErr == nil {
					if _, dbErr := warehouseDB.ExecContext(context.Background(), "UPDATE projects SET github_token = ? WHERE id = ?", enc, project.ID); dbErr == nil {
						logger.Info().Str("project_id", project.ID).Msg("refreshed and persisted github token in execution worker")
					}
				}
			}

			if err := ghutil.PostIssueComment(context.Background(), project.GitHubOwner, project.GitHubRepo, token, issueNumber, comment); err != nil {
				logger.Warn().Err(err).Str("issue_id", entry.IssueID).Msg("failed to post GitHub comment")
			} else {
				logger.Info().Str("issue_id", entry.IssueID).Int("github_issue", issueNumber).Msg("posted completion comment to GitHub")
			}
		}()
	}

	logger.Info().Str("issue_id", entry.IssueID).Str("session_id", result.SessionID).Msg("agent run completed — issue moved to Review")
	publishSnapshot(pubsub, service)
}

// buildExecutionPrompt constructs a fallback prompt for the agent when the
// workflow template is unavailable, including task details and attempt number.
func buildExecutionPrompt(issueIdentifier string, title string, description string, attempt int64) string {
	prompt := fmt.Sprintf("You are an autonomous coding agent working on issue **%s**.\n\n## Task\n**%s**\n\n%s", issueIdentifier, title, description)
	prompt += "\n\n## Instructions\n\n1. Write an **Operational Plan** using markdown checkboxes (`- [ ]` pending, `- [x]` done).\n\n2. Work through each step. After completing a step, restate the plan with updated checkboxes.\n\n3. Use all available tools to implement changes.\n\n4. Verify your work compiles/passes. Do NOT stop until all items are checked off."
	prompt += fmt.Sprintf("\n\nAttempt: %d", attempt)
	return prompt
}

// buildPriorTurnContext retrieves recent agent messages from the unified history
// and formats them as context for multi-turn continuation prompts.
func buildPriorTurnContext(warehouseDB *db.DB, issueID string, issueIdentifier string) string {
	history, err := warehouseDB.GetUnifiedHistory(context.Background(), issueID)
	if err != nil || len(history) == 0 {
		return ""
	}

	var agentMessages []string
	for _, h := range history {
		kind, _ := h["kind"].(string)
		msg, _ := h["message"].(string)
		if msg == "" || len(msg) < 20 {
			continue
		}
		// Only include agent messages (not PTY noise, not state changes)
		if kind == "message" || kind == "agent_message" || kind == "item.completed" {
			agentMessages = append(agentMessages, msg)
		}
	}

	if len(agentMessages) == 0 {
		return ""
	}

	// Take the last few messages to keep context manageable
	maxMessages := 5
	if len(agentMessages) > maxMessages {
		agentMessages = agentMessages[len(agentMessages)-maxMessages:]
	}

	ctx := "## Prior Turn Context\n\nYou have already worked on this task in previous turns. Here is what you reported:\n\n"
	for _, msg := range agentMessages {
		// Truncate very long messages
		if len(msg) > 500 {
			msg = msg[:500] + "..."
		}
		ctx += "> " + strings.ReplaceAll(msg, "\n", "\n> ") + "\n\n"
	}
	ctx += "**Continue from where you left off. Do NOT restart from scratch. Check what files already exist before creating new ones.**\n"

	return ctx
}

// extractPlanFromResult extracts the plan from the agent's in-memory output.
// Scans event messages, raw output, and raw JSON payloads for checkbox items.
func extractPlanFromResult(result agents.TurnResult, events []agents.Event) string {
	// Strategy: collect ALL text from every source, find the block with most checkboxes.

	// Source 1: event messages
	var allMessages []string
	for _, e := range events {
		if e.Message != "" {
			allMessages = append(allMessages, e.Message)
		}
		// Also try extracting from Raw payload
		if e.Raw != nil {
			if text := agents.ExtractMessage(e.Raw); text != "" && text != e.Message {
				allMessages = append(allMessages, text)
			}
		}
	}

	// Source 2: raw output lines — try as plain text AND as JSON
	if result.Output != "" {
		// Plain text scan: collect all checkbox lines
		var checkboxLines []string
		for _, line := range strings.Split(result.Output, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "- [") || strings.HasPrefix(trimmed, "* [") {
				checkboxLines = append(checkboxLines, trimmed)
			}
		}
		if len(checkboxLines) >= 3 {
			return strings.Join(checkboxLines, "\n")
		}

		// JSON line scan
		for _, line := range strings.Split(result.Output, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasPrefix(line, "{") {
				continue
			}
			var payload map[string]any
			if json.Unmarshal([]byte(line), &payload) == nil {
				if text := agents.ExtractMessage(payload); text != "" {
					allMessages = append(allMessages, text)
				}
			}
		}
	}

	// Find the message with the most checkboxes
	bestMsg := ""
	bestCount := 0
	for _, text := range allMessages {
		count := 0
		for _, line := range strings.Split(text, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "- [") || strings.HasPrefix(trimmed, "* [") {
				count++
			}
		}
		if count > bestCount {
			bestCount = count
			bestMsg = text
		}
	}
	if bestCount >= 3 {
		return bestMsg
	}

	// Last resort: concatenate ALL event messages and scan as one block
	allText := strings.Join(allMessages, "\n")
	var checkboxLines []string
	for _, line := range strings.Split(allText, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- [") || strings.HasPrefix(trimmed, "* [") {
			checkboxLines = append(checkboxLines, trimmed)
		}
	}
	if len(checkboxLines) >= 3 {
		return strings.Join(checkboxLines, "\n")
	}

	return ""
}

// extractOriginalPlan retrieves the first agent message containing 3+ checkboxes
// from the issue's event history. This is the plan created during the Todo phase.
func extractOriginalPlan(warehouseDB *db.DB, issueID string) string {
	history, err := warehouseDB.GetUnifiedHistory(context.Background(), issueID)
	if err != nil {
		return ""
	}
	for _, h := range history {
		msg, _ := h["message"].(string)
		if msg == "" {
			continue
		}
		count := 0
		for _, line := range strings.Split(msg, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "- [") || strings.HasPrefix(trimmed, "* [") {
				count++
			}
		}
		if count >= 3 {
			return msg
		}
	}
	return ""
}

// extractGitHubIssueNumber parses a GitHub issue URL and returns the issue number.
func extractGitHubIssueNumber(url string) int {
	// Extract issue number from URL like https://github.com/owner/repo/issues/18
	parts := strings.Split(strings.TrimRight(url, "/"), "/")
	if len(parts) < 2 {
		return 0
	}
	if parts[len(parts)-2] != "issues" {
		return 0
	}
	n, err := strconv.Atoi(parts[len(parts)-1])
	if err != nil {
		return 0
	}
	return n
}

// cleanupTerminalWorkspaces removes workspaces for issues that have reached a
// terminal state, called once at startup to reclaim disk space.
func cleanupTerminalWorkspaces(service *orchestrator.Service, trackerClient tracker.Client, workspaceService workspace.Service, hooks workspace.Hooks, warehouseDB *db.DB, logger zerolog.Logger) {
	if trackerClient == nil {
		return
	}
	terminalStates := service.TerminalStates()
	issues, err := trackerClient.FetchIssuesByStates(context.Background(), terminalStates)
	if err != nil {
		logger.Warn().Err(err).Msg("startup terminal workspace cleanup skipped")
		return
	}

	ctx := context.Background()
	for _, issue := range issues {
		if issue.BranchName == "" || issue.ProjectID == "" {
			continue
		}
		project, projErr := warehouseDB.GetProjectByID(ctx, issue.ProjectID)
		if projErr != nil {
			logger.Warn().Err(projErr).Str("project_id", issue.ProjectID).Msg("startup cleanup: project lookup failed")
			continue
		}
		wtPath := workspaceService.WorktreePath(project.ID, issue.BranchName)
		if err := workspaceService.RemoveWorktree(project.RootPath, wtPath, hooks); err != nil {
			logger.Warn().Err(err).Str("issue_identifier", issue.Identifier).Msg("startup worktree cleanup failed")
		}
	}
}

// startGarbageCollector runs hourly to prune old database events and clean up
// stale git worktree references for all known projects.
func startGarbageCollector(service *orchestrator.Service, warehouseDB *db.DB, workspaceService workspace.Service, retentionDays int, logger zerolog.Logger) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if retentionDays <= 0 {
				retentionDays = 7
			}
			// Prune old database events (keep 7 days)
			if warehouseDB != nil {
				affected, err := warehouseDB.PruneEvents(context.Background(), retentionDays)
				if err != nil {
					logger.Warn().Err(err).Msg("database pruning failed")
				} else if affected > 0 {
					logger.Info().Int64("count", affected).Msg("pruned old database events")
				}
			}

			// Prune stale worktree references for each known project.
			pruneAllWorktrees(warehouseDB, workspaceService, logger)
		}
	}
}

// pruneAllWorktrees iterates all known projects and prunes stale worktree refs.
func pruneAllWorktrees(warehouseDB *db.DB, workspaceService workspace.Service, logger zerolog.Logger) {
	if warehouseDB == nil {
		return
	}
	projects, err := warehouseDB.GetProjects(context.Background())
	if err != nil {
		logger.Warn().Err(err).Msg("worktree prune: failed to list projects")
		return
	}
	for _, p := range projects {
		if p.RootPath == "" {
			continue
		}
		if err := workspaceService.PruneWorktrees(p.RootPath); err != nil {
			logger.Warn().Err(err).Str("project", p.Name).Msg("worktree prune failed")
		}
	}
}

// startRefreshWorker runs a 5-second polling loop that triggers per-project tracker
// refresh cycles, publishes updated snapshots, and persists orchestrator state to disk.
// Each project gets its own tracker client built from its embedded issue_source_* fields.
// Projects with no issue source configured are skipped (local-only mode).
func startRefreshWorker(
	service *orchestrator.Service,
	registry *trackerregistry.Registry,
	warehouseDB *db.DB,
	pubsub *observability.PubSub,
	logger zerolog.Logger,
) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var lastHash uint32
	service.QueueRefresh()

	for range ticker.C {
		service.QueueRefresh()
		if !service.RefreshPending() {
			continue
		}
		before := service.Snapshot()

		ctx := context.Background()
		var refreshErr error

		projects, dbErr := warehouseDB.GetProjects(ctx)
		if dbErr != nil {
			logger.Warn().Err(dbErr).Msg("refresh worker: failed to load projects")
			// Fall back to stall-reconciliation-only path
			refreshErr = service.PerformRefreshForClient(ctx, nil)
		} else {
			ranAtLeastOne := false
			for _, proj := range projects {
				if proj.IssueSourceType == "" {
					continue // no external source; stall reconciliation runs via nil path below
				}
				client, clientErr := registry.GetForProjectDirect(proj)
				if clientErr != nil || client == nil {
					if clientErr != nil {
						logger.Warn().Err(clientErr).Str("project_id", proj.ID).Msg("refresh worker: failed to build tracker client")
					}
					continue
				}
				ranAtLeastOne = true
				if err := service.PerformRefreshForClient(ctx, client); err != nil {
					logger.Error().Err(err).Str("project_id", proj.ID).Str("service_id", runtime.ServiceOrchestrator).Msg("refresh worker: project refresh failed")
					refreshErr = err
				}
			}
			// Ensure stall reconciliation + retry releases run even when no project has an external source
			if !ranAtLeastOne {
				refreshErr = service.PerformRefreshForClient(ctx, nil)
			}
		}

		if refreshErr != nil {
			publishSnapshot(pubsub, service)
			continue
		}

		after := service.Snapshot()
		publishRefreshRetryLifecycleEvents(pubsub, before, after)

		newHash := snapshotContentHash(after)
		if newHash != lastHash {
			lastHash = newHash
			publishSnapshot(pubsub, service)
			if err := service.PersistStateToDB(ctx); err != nil {
				logger.Warn().Err(err).Msg("failed to persist orchestrator state to DB")
			}
		}
	}
}

// publishSnapshot broadcasts the current orchestrator snapshot to all SSE subscribers.
func publishSnapshot(pubsub *observability.PubSub, service *orchestrator.Service) {
	if pubsub == nil || service == nil {
		return
	}
	pubsub.Publish(observability.Event{Type: "snapshot", Data: service.Snapshot()})
}

// snapshotContentHash hashes the snapshot payload excluding generated_at so
// callers can detect whether state actually changed between ticks.
func snapshotContentHash(snap orchestrator.Snapshot) uint32 {
	type hashable struct {
		Counts      orchestrator.SnapshotCount  `json:"counts"`
		Running     []orchestrator.RunningEntry  `json:"running"`
		Retrying    []orchestrator.RetryEntry    `json:"retrying"`
		CodexTotals orchestrator.CodexTotals     `json:"codex_totals"`
		RateLimits  any                          `json:"rate_limits"`
		MCPServers  map[string]string            `json:"mcp_servers,omitempty"`
	}
	b, _ := json.Marshal(hashable{
		Counts:      snap.Counts,
		Running:     snap.Running,
		Retrying:    snap.Retrying,
		CodexTotals: snap.CodexTotals,
		RateLimits:  snap.RateLimits,
		MCPServers:  snap.MCPServers,
	})
	h := fnv.New32a()
	_, _ = h.Write(b)
	return h.Sum32()
}

// publishLifecycleEvent broadcasts a named lifecycle event (e.g. RUN_STARTED,
// RUN_FAILED, RETRY_SCHEDULED) to all SSE subscribers.
func publishLifecycleEvent(pubsub *observability.PubSub, eventType string, data map[string]any) {
	if pubsub == nil {
		return
	}
	if strings.TrimSpace(eventType) == "" {
		return
	}
	pubsub.Publish(observability.Event{Type: eventType, Data: data})
}

// publishRunEvent broadcasts an individual agent event (tool use, message, etc.)
// to all SSE subscribers along with issue and provider context.
func publishRunEvent(pubsub *observability.PubSub, entry orchestrator.RunningEntry, providerName string, event agents.Event) {
	if pubsub == nil {
		return
	}

	pubsub.Publish(observability.Event{Type: "RUN_EVENT", Data: map[string]any{
		"issue_id":         entry.IssueID,
		"issue_identifier": entry.IssueIdentifier,
		"provider":         providerName,
		"event":            event,
	}})
}

// publishRefreshRetryLifecycleEvents compares snapshots before and after a refresh
// cycle and emits RUN_FAILED and RETRY_SCHEDULED events for newly added retries.
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
		publishLifecycleEvent(pubsub, "RUN_FAILED", map[string]any{
			"issue_id":         retry.IssueID,
			"issue_identifier": retry.IssueIdentifier,
			"attempt":          retry.Attempt,
			"error":            retry.Error,
			"source":           "refresh",
			"cause":            classifyRefreshRetryCause(retry.Error),
		})
		publishLifecycleEvent(pubsub, "RETRY_SCHEDULED", map[string]any{
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

// retryLifecycleKey produces a deduplication key for a retry entry based on
// issue ID, attempt number, and error message.
func retryLifecycleKey(entry orchestrator.RetryEntry) string {
	return strings.TrimSpace(entry.IssueID) + "|" + fmt.Sprintf("%d", entry.Attempt) + "|" + strings.TrimSpace(entry.Error)
}

// logEventToSessionLog extracts structured content from agent events and writes
// session log messages — text, tool calls, tool results, metrics.
func logEventToSessionLog(sessionLog *sessionlogger.Logger, sessionID, provider string, event agents.Event) {
	raw := event.Raw
	if raw == nil && event.Message == "" {
		return
	}

	kind := event.Kind

	// Claude result event — final output with full usage
	if kind == "result" || (raw != nil && firstStr(raw, "type") == "result") {
		resultText := firstStr(raw, "result")
		model := firstStr(raw, "model")
		stopReason := firstStr(raw, "stop_reason", "stopReason")
		costStr := ""
		if cost, ok := raw["total_cost_usd"].(float64); ok && cost > 0 {
			costStr = fmt.Sprintf("%.6f", cost)
		}

		// Extract usage from the result
		u := extractSessionLogUsage(raw)

		if resultText != "" {
			msg := map[string]any{
				"sessionId": sessionID,
				"role":      "assistant",
				"content":   []sessionlogger.ContentBlock{sessionlogger.TextBlock(resultText)},
				"provider":  provider,
				"usage":     u,
			}
			if model != "" {
				msg["model"] = model
			}
			if stopReason != "" {
				msg["stopReason"] = stopReason
			}
			_ = sessionLog.LogMessage(msg)
		}

		// Log cost as a DataPoint metric
		if costStr != "" {
			if cost, ok := raw["total_cost_usd"].(float64); ok {
				_ = sessionLog.LogDataPoint(sessionID, "agent.cost.usd", "count", cost,
					map[string]string{"provider": provider, "session": sessionID},
					0, "dollar")
			}
		}

		// Log token usage as DataPoint
		if u != nil && (u.InputTokens > 0 || u.OutputTokens > 0) {
			_ = sessionLog.LogDataPoint(sessionID, "agent.tokens.input", "count", u.InputTokens,
				map[string]string{"provider": provider}, 0, "token")
			_ = sessionLog.LogDataPoint(sessionID, "agent.tokens.output", "count", u.OutputTokens,
				map[string]string{"provider": provider}, 0, "token")
		}
		return
	}

	// Content block events — text deltas from streaming
	if kind == "content_block_delta" || kind == "content_block_start" {
		if delta := nestedAny(raw, "delta"); delta != nil {
			if text := firstStr(delta, "text"); text != "" {
				_ = sessionLog.LogMessage(map[string]any{
					"sessionId": sessionID,
					"role":      "assistant",
					"content":   []sessionlogger.ContentBlock{sessionlogger.TextBlock(text)},
					"provider":  provider,
				})
				return
			}
		}
		// Tool use start
		if cb := nestedAny(raw, "content_block"); cb != nil {
			if firstStr(cb, "type") == "tool_use" {
				toolName := firstStr(cb, "name")
				toolID := firstStr(cb, "id")
				if toolName != "" {
					_ = sessionLog.LogToolCall(sessionID, toolID, toolName, cb["input"])
					return
				}
			}
		}
	}

	// Tool result events
	if kind == "tool_result" || (raw != nil && firstStr(raw, "type") == "tool_result") {
		toolID := firstStr(raw, "tool_use_id", "toolCallId")
		toolName := firstStr(raw, "name", "toolName")
		output := firstStr(raw, "output", "content")
		isErr := false
		if v, ok := raw["is_error"].(bool); ok {
			isErr = v
		}
		if toolID != "" {
			_ = sessionLog.LogToolResult(sessionID, toolID, toolName, output, isErr)
			return
		}
	}

	// System/progress events
	if kind == "system" || strings.HasPrefix(kind, "RUN_") || kind == "HOOK_STARTED" || kind == "HOOK_COMPLETED" {
		if event.Message != "" {
			_ = sessionLog.LogSystem(sessionID, kind, map[string]any{"durationMs": event.Usage.TotalTokens})
		}
		return
	}

	// Fallback: if there's a message, log it as assistant text
	if event.Message != "" {
		_ = sessionLog.LogAssistantMessage(sessionID, event.Message, "", provider, &sessionlogger.Usage{
			InputTokens:  event.Usage.InputTokens,
			OutputTokens: event.Usage.OutputTokens,
			TotalTokens:  event.Usage.TotalTokens,
		})
	}
}

// extractSessionLogUsage pulls token usage from a result payload.
func extractSessionLogUsage(raw map[string]any) *sessionlogger.Usage {
	u := &sessionlogger.Usage{}

	// Try nested usage object first, then top-level
	for _, node := range []map[string]any{nestedAny(raw, "usage"), raw} {
		if node == nil {
			continue
		}
		if v := intVal(node, "input_tokens", "inputTokens"); v > 0 {
			u.InputTokens = v
		}
		if v := intVal(node, "output_tokens", "outputTokens"); v > 0 {
			u.OutputTokens = v
		}
		if v := intVal(node, "cache_read_input_tokens", "cacheReadInputTokens"); v > 0 {
			if u.InputTokenDetails == nil {
				u.InputTokenDetails = &sessionlogger.InputTokenDetail{}
			}
			u.InputTokenDetails.CacheReadTokens = v
		}
		if v := intVal(node, "cache_creation_input_tokens", "cacheCreationInputTokens"); v > 0 {
			if u.InputTokenDetails == nil {
				u.InputTokenDetails = &sessionlogger.InputTokenDetail{}
			}
			u.InputTokenDetails.CacheWriteTokens = v
		}
		if u.InputTokens > 0 || u.OutputTokens > 0 {
			u.TotalTokens = u.InputTokens + u.OutputTokens
			return u
		}
	}

	// Try modelUsage
	if mu, ok := raw["modelUsage"].(map[string]any); ok {
		for _, modelData := range mu {
			if md, ok := modelData.(map[string]any); ok {
				u.InputTokens = intVal(md, "inputTokens")
				u.OutputTokens = intVal(md, "outputTokens")
				if cr := intVal(md, "cacheReadInputTokens"); cr > 0 {
					if u.InputTokenDetails == nil {
						u.InputTokenDetails = &sessionlogger.InputTokenDetail{}
					}
					u.InputTokenDetails.CacheReadTokens = cr
				}
				if cw := intVal(md, "cacheCreationInputTokens"); cw > 0 {
					if u.InputTokenDetails == nil {
						u.InputTokenDetails = &sessionlogger.InputTokenDetail{}
					}
					u.InputTokenDetails.CacheWriteTokens = cw
				}
				u.TotalTokens = u.InputTokens + u.OutputTokens
				return u
			}
		}
	}

	return nil
}

func nestedAny(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if sub, ok := v.(map[string]any); ok {
			return sub
		}
	}
	return nil
}

func firstStr(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func intVal(m map[string]any, keys ...string) int64 {
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			return int64(v)
		case int64:
			return v
		case int:
			return int64(v)
		}
	}
	return 0
}

func classifyRefreshRetryCause(message string) string {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if strings.Contains(normalized, "stalled run exceeded timeout") || strings.Contains(normalized, "stalled") {
		return "stalled_timeout"
	}
	return "refresh_retry"
}

// startDailyMetricsRollup runs every 5 minutes to aggregate event-level token
// data into the daily_metrics table for fast dashboard queries.
func startDailyMetricsRollup(warehouseDB *db.DB, logger zerolog.Logger) {
	// Run once immediately on startup, then every 5 minutes.
	rollupDailyMetrics(context.Background(), warehouseDB, logger)

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rollupDailyMetrics(context.Background(), warehouseDB, logger)
	}
}

// rollupDailyMetrics aggregates event-level token usage into daily_metrics,
// grouped by date, project, provider, and model.
func rollupDailyMetrics(ctx context.Context, warehouseDB *db.DB, logger zerolog.Logger) {
	if warehouseDB == nil {
		return
	}

	query := `
		INSERT OR REPLACE INTO daily_metrics (date, project_id, provider, model,
			input_tokens, output_tokens, cache_read, cache_write, thinking,
			cost_cents, request_count, session_count, completed, failed, avg_duration)
		SELECT
			date(e.timestamp) as dt,
			COALESCE(s.project_id, '') as pid,
			COALESCE(s.provider, '') as prov,
			COALESCE(s.model, '') as mdl,
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0),
			COALESCE(SUM(e.cache_read_tokens), 0),
			COALESCE(SUM(e.cache_write_tokens), 0),
			COALESCE(SUM(e.thinking_tokens), 0),
			0,
			COUNT(e.id),
			COUNT(DISTINCT s.id),
			SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END),
			SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END),
			AVG(s.duration_seconds)
		FROM events e
		JOIN sessions s ON e.session_id = s.id
		WHERE e.timestamp IS NOT NULL AND date(e.timestamp) IS NOT NULL
		GROUP BY dt, pid, prov, mdl
	`

	if _, err := warehouseDB.ExecContext(ctx, query); err != nil {
		logger.Warn().Err(err).Msg("daily_metrics rollup failed")
	}
}
