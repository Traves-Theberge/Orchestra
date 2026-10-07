// Package api implements the Orchestra HTTP API, including RESTful endpoints
// for issue management, agent configuration, project operations, SSE event
// streaming, terminal WebSocket proxying, and GitHub integration.
package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"context"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/automations"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/control"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"github.com/orchestra/orchestra/apps/backend/internal/harnesssetup"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/staticassets"
	"github.com/orchestra/orchestra/apps/backend/internal/studio"
	"github.com/orchestra/orchestra/apps/backend/internal/studio/templates"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
	"github.com/orchestra/orchestra/apps/backend/internal/usage"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacelifecycle"
	"github.com/orchestra/orchestra/apps/backend/internal/worktreejobs"
	"github.com/rs/zerolog"
)

// Server holds shared dependencies for all HTTP handlers, including the
// logger, orchestrator service, database, pub/sub bus, and configuration.
type Server struct {
	logger              zerolog.Logger
	orchestrator        *orchestrator.Service
	workspaceRoot       string
	worktreeRoot        string
	authToken           string
	pubsub              *observability.PubSub
	db                  *db.DB
	config              *config.Config
	termManager         *terminal.Manager
	usageService        *usage.Service
	registry            *trackerregistry.Registry
	studioMgr           *studio.Manager
	studioTpls          *templates.Store
	workspaceChat       *workspacechat.Service
	orchestratorControl *control.Service
	worktreeJobs        *worktreejobs.Service
	automations         *automations.Service
	worktreeRemovals    *workspacelifecycle.Service
	agentCatalog        *agentcatalog.Service
	codexDeviceLogin    *harnesssetup.DeviceLoginManager
	accounts            *harnessaccounts.Store
}

// SetStudioTemplateStore wires a template store onto the server for the
// /api/v1/studio/templates routes. Safe to call before or after router build.
func (s *Server) SetStudioTemplateStore(store *templates.Store) {
	s.studioTpls = store
}

// NewRouter creates an http.Handler with the full API route table, using only
// the required dependencies (no pub/sub, warehouse DB, or terminal manager).
func NewRouter(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
) http.Handler {
	return NewRouterWithPubSub(logger, orchestratorService, cfg, nil, nil, nil, nil, nil, nil, nil)
}

// NewRouterWithPubSub creates an http.Handler with the full API route table and
// optional pub/sub, warehouse database, and terminal manager dependencies for
// SSE streaming, data persistence, and PTY support.
func NewRouterWithPubSub(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
	pubsub *observability.PubSub,
	warehouseDB *db.DB,
	termManager *terminal.Manager,
	usageService *usage.Service,
	registry *trackerregistry.Registry,
	studioMgr *studio.Manager,
	studioTpls *templates.Store,
	extras ...any,
) http.Handler {
	if termManager == nil {
		termManager = terminal.NewManager()
	}
	server := &Server{
		logger:           logger,
		orchestrator:     orchestratorService,
		workspaceRoot:    cfg.WorkspaceRoot,
		worktreeRoot:     cfg.WorktreeRoot,
		authToken:        cfg.APIToken,
		pubsub:           pubsub,
		db:               warehouseDB,
		config:           cfg,
		termManager:      termManager,
		codexDeviceLogin: harnesssetup.NewDeviceLoginManager(),
		usageService:     usageService,
		registry:         registry,
		studioMgr:        studioMgr,
		studioTpls:       studioTpls,
	}
	for _, extra := range extras {
		switch value := extra.(type) {
		case *workspacechat.Service:
			server.workspaceChat = value
		case *harnessaccounts.Store:
			server.accounts = value
		case *automations.Service:
			server.automations = value
		}
	}
	if server.workspaceChat != nil && warehouseDB != nil {
		server.workspaceChat.ConfigureMCP(server.orchestraMCPServers)
	}
	if warehouseDB != nil {
		catalog, err := agentcatalog.New(warehouseDB, cfg.ProjectRoots, cfg.WorkspaceRoot, cfg.AgentCommands, cfg.NativeAgentCommands)
		if err == nil {
			server.agentCatalog = catalog
			if server.workspaceChat != nil {
				server.workspaceChat.ConfigureAgentCatalog(catalog)
			}
		} else {
			logger.Warn().Err(err).Msg("agent definition catalog unavailable")
		}
	}
	if server.workspaceChat != nil && warehouseDB != nil {
		controlService, err := control.New(warehouseDB, orchestratorService, registry, cfg.ProjectRoots)
		if err == nil {
			err = server.configureReviewControl(controlService)
		}
		if err == nil {
			if server.agentCatalog != nil {
				controlService.ConfigureResourceExecutor(server.agentCatalog.Execute)
			}
			specs := append(control.ToolSpecs(), control.ResourceToolSpecs()...)
			err = server.workspaceChat.ConfigureOrchestrator(filepath.Join(cfg.WorkspaceRoot, ".orchestra", "orchestrator"), specs, controlService.Execute)
		}
		if err == nil {
			server.orchestratorControl = controlService
		} else {
			logger.Warn().Err(err).Msg("native orchestrator control unavailable")
		}
	}
	if warehouseDB != nil {
		removals, err := workspacelifecycle.New(warehouseDB, cfg.ProjectRoots)
		if err == nil {
			server.worktreeRemovals = removals
		} else {
			logger.Warn().Err(err).Msg("workspace removal controls unavailable")
		}
		jobs, err := worktreejobs.New(warehouseDB, cfg.WorktreeRoot, cfg.ProjectRoots, func(ctx context.Context, projectID, taskID string) error {
			if server.orchestratorControl == nil {
				return errors.New("exact existing-task linking is unavailable")
			}
			result := server.orchestratorControl.Execute(ctx, "orchestra_control", map[string]any{"operation": "tasks", "project_id": projectID})
			if success, _ := result["success"].(bool); !success {
				return errors.New("existing task inventory could not be confirmed")
			}
			data, _ := result["data"].(map[string]any)
			tasks, _ := data["tasks"].([]tracker.Issue)
			matches := 0
			for _, task := range tasks {
				if task.ID == taskID && task.ProjectID == projectID {
					matches++
				}
			}
			if matches == 1 {
				return nil
			}
			return errors.New("existing task was not confirmed in this project")
		})
		if err == nil {
			server.worktreeJobs = jobs
			if server.automations != nil {
				server.automations.ConfigureWorktrees(jobs)
			}
		} else {
			logger.Warn().Err(err).Msg("workspace creation jobs unavailable")
		}
	}
	r := chi.NewRouter()

	allowedOrigins := corsAllowedOrigins(cfg.Host)
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))
	// CORS runs before the rate limiter and other short-circuiting middleware so
	// that preflights are answered without consuming rate-limit tokens and every
	// early error response (429, 415, 504) still carries CORS headers. Without
	// them the browser surfaces a readable 429 as an opaque "Failed to fetch".
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(RateLimit(20, 60)) // 20 req/s sustained, 60 burst
	r.Use(securityHeaders)
	r.Use(contentTypeGuard)
	r.Use(middleware.Timeout(30 * time.Second))
	r.MethodNotAllowed(server.methodNotAllowed)
	r.NotFound(server.notFound)

	requiresAuth := strings.TrimSpace(cfg.APIToken) != ""
	var protected chi.Router = r
	if requiresAuth {
		protected = r.With(requireBearerToken(cfg.APIToken))
	}

	r.Get("/", server.GetDashboard)
	r.Get("/healthz", Healthz)
	r.Get("/api/v1/healthz", Healthz)
	r.Get("/api/v1/openapi.yaml", server.GetOpenAPIYAML)
	r.Get("/api/docs", server.GetSwaggerUI)
	r.Get("/api/docs/", server.GetSwaggerUI)
	protected.Get("/api/v1/stt/health", server.GetSTTHealth)
	protected.Post("/api/v1/stt/transcribe", server.PostSTTTranscribe)
	protected.Get("/api/v1/state", server.GetState)

	// Tracker configs (CRUD + test-connection + browse)
	protected.Get("/api/v1/tracker/configs", server.GetTrackerConfigs)
	protected.Post("/api/v1/tracker/configs", server.PostTrackerConfig)
	protected.Patch("/api/v1/tracker/configs/{config_id}", server.PatchTrackerConfig)
	protected.Delete("/api/v1/tracker/configs/{config_id}", server.DeleteTrackerConfig)
	protected.Post("/api/v1/tracker/configs/{config_id}/test", server.PostTrackerConfigTest)
	protected.Get("/api/v1/tracker/configs/{config_id}/projects", server.GetTrackerProjects)
	protected.Get("/api/v1/tracker/configs/{config_id}/states", server.GetTrackerStates)
	protected.Get("/api/v1/tracker/configs/{config_id}/issues", server.GetTrackerConfigIssues)
	// Per-project tracker assignment (legacy global config link)
	protected.Post("/api/v1/projects/{project_id}/tracker", server.PostProjectTrackerConfig)
	// Per-project embedded issue source (replaces global tracker config)
	protected.Patch("/api/v1/projects/{project_id}/issue-source", server.PatchProjectIssueSource)
	protected.Post("/api/v1/projects/{project_id}/issue-source/test", server.PostProjectIssueSourceTest)
	protected.Post("/api/v1/projects/{project_id}/issue-source/list-projects", server.PostProjectIssueSourceListProjects)
	// Live browse of a project's issue source (used by TrackerViewer)
	protected.Get("/api/v1/projects/{project_id}/tracker/issues", server.GetProjectTrackerIssues)

	protected.Get("/api/v1/issues", server.GetIssues)
	protected.Post("/api/v1/issues", server.PostIssue)
	protected.Get("/api/v1/search", server.GetSearch)
	protected.Get("/api/v1/events", server.GetEvents)
	protected.Get("/api/v1/workspace/migration/plan", server.GetWorkspaceMigrationPlan)
	protected.Get("/api/v1/config/agents", server.GetAgentConfig)
	protected.Patch("/api/v1/config/agents", server.PatchAgentConfig)
	protected.Post("/api/v1/config/agents", server.PostAgentConfig)
	protected.Get("/api/v1/config/agents/items", server.GetAgentConfigs)
	protected.Post("/api/v1/config/agents/new", server.PostAgentConfigNew)
	protected.Post("/api/v1/config/agents/items", server.PostAgentConfigUpdate)
	protected.Get("/api/v1/agents", server.GetAgentsOrProfiles)
	protected.Post("/api/v1/agents", server.PostAgentProfile)
	protected.Patch("/api/v1/agents/{provider}", server.PatchAgentProfile)
	protected.Delete("/api/v1/agents/{provider}", server.DeleteAgentProfile)
	protected.Get("/api/v1/agent-profiles", server.GetAgentProfiles)
	protected.Post("/api/v1/agent-profiles", server.PostAgentProfile)
	protected.Patch("/api/v1/agent-profiles/{id}", server.PatchAgentProfile)
	protected.Delete("/api/v1/agent-profiles/{id}", server.DeleteAgentProfile)
	protected.Get("/api/v1/harnesses/capabilities", server.GetHarnessCapabilities)
	protected.Get("/api/v1/skills", server.GetSkills)
	protected.Get("/api/v1/agents/setup", server.GetHarnessSetup)
	protected.Put("/api/v1/agents/{provider}/registration", server.SetHarnessRegistration)
	protected.Get("/api/v1/agents/accounts", server.ListHarnessAccounts)
	protected.Post("/api/v1/agents/accounts", server.BeginHarnessAccount)
	protected.Put("/api/v1/agents/accounts/active/{provider}", server.SelectHarnessAccount)
	protected.Post("/api/v1/agents/accounts/{id}/verify", server.VerifyHarnessAccount)
	protected.Post("/api/v1/agents/accounts/{id}/reauth", server.ReauthHarnessAccount)
	protected.Delete("/api/v1/agents/accounts/{id}", server.RemoveHarnessAccount)
	protected.Post("/api/v1/agents/setup/codex/device-login", server.StartCodexDeviceLogin)
	protected.Get("/api/v1/agents/setup/codex/device-login/{id}", server.GetCodexDeviceLogin)
	protected.Delete("/api/v1/agents/setup/codex/device-login/{id}", server.CancelCodexDeviceLogin)
	// Claude-specific config endpoints (registered before {provider} wildcards)
	protected.Get("/api/v1/agents/claude/settings", server.GetClaudeSettings)
	protected.Post("/api/v1/agents/claude/settings", server.PostClaudeSettings)
	protected.Get("/api/v1/agents/claude/instructions", server.GetClaudeInstructions)
	protected.Post("/api/v1/agents/claude/instructions", server.PostClaudeInstructions)
	protected.Delete("/api/v1/agents/claude/instructions", server.DeleteClaudeInstructions)
	protected.Get("/api/v1/agents/claude/rules", server.GetClaudeRules)
	protected.Post("/api/v1/agents/claude/rules", server.PostClaudeRule)
	protected.Delete("/api/v1/agents/claude/rules/{name}", server.DeleteClaudeRule)
	protected.Get("/api/v1/agents/claude/skills", server.GetClaudeSkills)
	protected.Post("/api/v1/agents/claude/skills", server.PostClaudeSkill)
	protected.Delete("/api/v1/agents/claude/skills/{name}", server.DeleteClaudeSkill)
	protected.Get("/api/v1/agents/claude/subagents", server.GetClaudeSubAgents)
	protected.Post("/api/v1/agents/claude/subagents", server.PostClaudeSubAgent)
	protected.Delete("/api/v1/agents/claude/subagents/{name}", server.DeleteClaudeSubAgent)
	protected.Get("/api/v1/agents/codex/config", server.GetCodexConfig)
	protected.Post("/api/v1/agents/codex/config", server.PostCodexConfig)
	protected.Get("/api/v1/agents/codex/instructions", server.GetCodexInstructions)
	protected.Post("/api/v1/agents/codex/instructions", server.PostCodexInstructions)
	protected.Get("/api/v1/agents/codex/subagents", server.GetCodexSubagents)
	protected.Post("/api/v1/agents/codex/subagents", server.PostCodexSubagent)
	protected.Delete("/api/v1/agents/codex/subagents/{name}", server.DeleteCodexSubagent)
	protected.Get("/api/v1/agents/codex/skills", server.GetCodexSkills)
	protected.Post("/api/v1/agents/codex/skills", server.PostCodexSkill)
	protected.Delete("/api/v1/agents/codex/skills/{name}", server.DeleteCodexSkill)
	protected.Get("/api/v1/agents/codex/rules", server.GetCodexRules)
	protected.Post("/api/v1/agents/codex/rules", server.PostCodexRule)
	protected.Delete("/api/v1/agents/codex/rules/{name}", server.DeleteCodexRule)
	protected.Get("/api/v1/agents/gemini/settings", server.GetGeminiSettings)
	protected.Post("/api/v1/agents/gemini/settings", server.PostGeminiSettings)
	protected.Get("/api/v1/agents/gemini/context", server.GetGeminiContext)
	protected.Post("/api/v1/agents/gemini/context", server.PostGeminiContext)
	protected.Get("/api/v1/agents/gemini/commands", server.GetGeminiCommands)
	protected.Post("/api/v1/agents/gemini/commands", server.PostGeminiCommand)
	protected.Delete("/api/v1/agents/gemini/commands/{name}", server.DeleteGeminiCommand)
	protected.Get("/api/v1/agents/opencode/config", server.GetOpenCodeConfig)
	protected.Post("/api/v1/agents/opencode/config", server.PostOpenCodeConfig)
	protected.Get("/api/v1/agents/opencode/agents", server.GetOpenCodeAgents)
	protected.Post("/api/v1/agents/opencode/agents", server.PostOpenCodeAgent)
	protected.Delete("/api/v1/agents/opencode/agents/{name}", server.DeleteOpenCodeAgent)
	protected.Get("/api/v1/agents/opencode/commands", server.GetOpenCodeCommands)
	protected.Post("/api/v1/agents/opencode/commands", server.PostOpenCodeCommand)
	protected.Delete("/api/v1/agents/opencode/commands/{name}", server.DeleteOpenCodeCommand)
	protected.Get("/api/v1/agents/opencode/skills", server.GetOpenCodeSkills)
	protected.Post("/api/v1/agents/opencode/skills", server.PostOpenCodeSkill)
	protected.Delete("/api/v1/agents/opencode/skills/{name}", server.DeleteOpenCodeSkill)
	protected.Get("/api/v1/agents/codex/bundle", server.GetCodexBundle)
	protected.Get("/api/v1/agents/gemini/bundle", server.GetGeminiBundle)
	protected.Get("/api/v1/agents/opencode/bundle", server.GetOpenCodeBundle)
	protected.Post("/api/v1/agents/bundle/file", server.PostProviderBundleFile)

	protected.Get("/api/v1/agents/{provider}/mcp", server.GetProviderMCPServers)
	protected.Post("/api/v1/agents/{provider}/mcp", server.AddProviderMCPServer)
	protected.Put("/api/v1/agents/{provider}/mcp/{name}", server.UpdateProviderMCPServer)
	protected.Patch("/api/v1/agents/{provider}/mcp/{name}", server.ToggleProviderMCPServer)
	protected.Delete("/api/v1/agents/{provider}/mcp/{name}", server.DeleteProviderMCPServer)
	protected.Get("/api/v1/agents/{provider}/permissions", server.GetProviderPermissions)
	protected.Post("/api/v1/agents/{provider}/permissions", server.PostProviderPermissions)
	protected.Get("/api/v1/agents/{provider}/model", server.GetProviderModel)
	protected.Post("/api/v1/agents/{provider}/model", server.PostProviderModel)
	protected.Get("/api/v1/agents/{provider}/hooks", server.GetProviderHooks)
	protected.Post("/api/v1/agents/{provider}/hooks", server.PostProviderHooks)

	protected.Get("/api/v1/docs", server.GetDocs)
	protected.Get("/api/v1/docs/*", server.GetDocContent)

	protected.Get("/api/v1/mcp/tools", server.GetMCPTools)
	protected.Get("/api/v1/mcp/servers", server.GetMCPServers)
	protected.Get("/api/v1/mcp/servers/status", server.GetMCPServerStatus)
	protected.Post("/api/v1/mcp/servers/{id}/probe", server.PostMCPServerProbe)
	protected.Post("/api/v1/mcp/servers", server.PostMCPServer)
	protected.Delete("/api/v1/mcp/servers/{id}", server.DeleteMCPServer)

	r.Get("/api/v1/terminal/{session_id}", server.TerminalWebSocket)

	if usageService != nil {
		NewUsageHandlers(usageService).Register(protected)
	}

	protected.Get("/api/v1/workspace/file", server.GetWorkspaceFile)
	protected.Put("/api/v1/workspace/file", server.PutWorkspaceFile)
	protected.Get("/api/v1/workspace/tree", server.GetWorkspaceTree)
	protected.Post("/api/v1/workspace/dir", server.PostWorkspaceMkdir)
	protected.Post("/api/v1/workspace/rename", server.PostWorkspaceRename)
	protected.Delete("/api/v1/workspace/path", server.DeleteWorkspacePath)
	protected.Get("/api/v1/projects", server.GetProjects)
	protected.Post("/api/v1/projects", server.CreateProject)
	protected.Get("/api/v1/projects/{project_id}/file", server.GetProjectFileContent)
	protected.Get("/api/v1/projects/{project_id}/tree", server.GetProjectFileTree)
	protected.Get("/api/v1/projects/{project_id}/git", server.withGitWorkspace(server.GetProjectGitStats))
	protected.Get("/api/v1/projects/{project_id}/git/status", server.withGitWorkspace(server.GetProjectGitStatus))
	protected.Get("/api/v1/projects/{project_id}/git/diff", server.withGitWorkspace(server.GetProjectGitDiff))
	protected.Post("/api/v1/projects/{project_id}/refresh", server.RefreshProject)
	protected.Get("/api/v1/projects/{project_id}", server.GetProject)
	protected.Get("/api/v1/projects/{project_id}/git/worktrees", server.GetProjectWorktrees)
	protected.Delete("/api/v1/projects/{project_id}/git/worktrees/{workspace_id}", server.DeleteProjectWorktree)
	protected.Get("/api/v1/projects/{project_id}/worktree-removals/{request_id}", server.GetProjectWorktreeRemoval)
	protected.Post("/api/v1/projects/{project_id}/worktree-jobs", server.PostWorktreeJob)
	protected.Get("/api/v1/projects/{project_id}/worktree-jobs/{request_id}", server.GetWorktreeJob)
	server.registerAutomationRoutes(protected)
	protected.Delete("/api/v1/projects/{project_id}", server.DeleteProject)
	protected.Post("/api/v1/projects/{project_id}/git/commit", server.withGitWorkspace(server.PostGitCommit))
	protected.Post("/api/v1/projects/{project_id}/git/push", server.withGitWorkspace(server.PostGitPush))
	protected.Post("/api/v1/projects/{project_id}/git/pull", server.withGitWorkspace(server.PostGitPull))
	protected.Post("/api/v1/projects/{project_id}/git/fetch", server.withGitWorkspace(server.PostGitFetch))
	protected.Post("/api/v1/projects/{project_id}/git/branches", server.withGitWorkspace(server.PostGitCreateBranch))
	protected.Post("/api/v1/projects/{project_id}/git/checkout", server.withGitWorkspace(server.PostGitCheckout))
	protected.Delete("/api/v1/projects/{project_id}/git/branches/{branch}", server.withGitWorkspace(server.DeleteGitBranch))
	protected.Post("/api/v1/projects/{project_id}/git/stage", server.withGitWorkspace(server.PostGitStage))
	protected.Post("/api/v1/projects/{project_id}/git/unstage", server.withGitWorkspace(server.PostGitUnstage))
	protected.Post("/api/v1/projects/{project_id}/git/stash", server.withGitWorkspace(server.PostGitStash))
	protected.Post("/api/v1/projects/{project_id}/git/stash/pop", server.withGitWorkspace(server.PostGitStashPop))
	protected.Get("/api/v1/projects/{project_id}/git/stash/list", server.withGitWorkspace(server.GetGitStashList))
	protected.Post("/api/v1/projects/{project_id}/git/stash/apply", server.withGitWorkspace(server.PostGitStashApply))
	protected.Post("/api/v1/projects/{project_id}/git/stash/drop", server.withGitWorkspace(server.PostGitStashDrop))
	protected.Get("/api/v1/projects/{project_id}/git/conflicts", server.withGitWorkspace(server.GetGitConflicts))
	protected.Post("/api/v1/projects/{project_id}/git/merge/abort", server.withGitWorkspace(server.PostGitMergeAbort))
	protected.Post("/api/v1/projects/{project_id}/git/resolve", server.withGitWorkspace(server.PostGitConflictResolve))
	protected.Post("/api/v1/projects/{project_id}/git/merge", server.withGitWorkspace(server.PostGitMerge))
	protected.Post("/api/v1/projects/{project_id}/github/disconnect", server.HandleGitHubDisconnect)
	protected.Post("/api/v1/projects/{project_id}/github/create-repo", server.PostCreateGitHubRepo)
	protected.Get("/api/v1/projects/{project_id}/git/default-branch", server.withGitWorkspace(server.GetDefaultBranch))
	protected.Get("/api/v1/projects/{project_id}/git/branches", server.withGitWorkspace(server.GetProjectGitBranches))
	protected.Get("/api/v1/projects/{project_id}/git/branches/detail", server.withGitWorkspace(server.GetProjectGitBranchesDetail))
	protected.Get("/api/v1/projects/{project_id}/github/issues", server.GetProjectGitHubIssues)
	protected.Post("/api/v1/projects/{project_id}/github/issues", server.CreateProjectGitHubIssue)
	protected.Patch("/api/v1/projects/{project_id}/github/issues/{number}", server.UpdateProjectGitHubIssue)
	protected.Get("/api/v1/projects/{project_id}/github/pulls", server.GetProjectGitHubPulls)
	protected.Get("/api/v1/projects/{project_id}/github/pulls/{number}/diff", server.GetProjectGitHubPullDiff)
	protected.Get("/api/v1/projects/{project_id}/github/pulls/{number}/snapshot", server.GetPRSnapshot)
	protected.Post("/api/v1/projects/{project_id}/github/pulls", server.CreateProjectGitHubPull)
	protected.Get("/api/v1/projects/{project_id}/github/pulls/{number}/reviews", server.GetPRReviews)
	protected.Post("/api/v1/projects/{project_id}/github/pulls/{number}/reviews", server.PostPRReview)
	protected.Put("/api/v1/projects/{project_id}/github/pulls/{number}/merge", server.PostPRMerge)
	protected.Get("/api/v1/projects/{project_id}/github/pulls/{number}/comments", server.GetPRComments)
	protected.Get("/api/v1/sessions", server.GetSessions)
	protected.Get("/api/v1/sessions/{session_id}", server.GetSessionDetail)
	protected.Post("/api/v1/issues/{issue_identifier}/pr", server.CreateGitHubPR)
	protected.Get("/api/v1/warehouse/stats", server.GetWarehouseStats)
	protected.Get("/api/v1/telemetry/health", server.GetTelemetryHealth)

	// Legacy analytics endpoints — replaced by /api/v1/usage/*. The handlers
	// were removed; the routes are intentionally absent so callers fail fast
	// instead of getting cost-heuristic guesses.
	oauthRateLimited := r.With(RateLimit(5, 10))
	oauthRateLimited.Get("/api/v1/github/login", server.HandleGitHubLogin)
	oauthRateLimited.Get("/api/v1/github/callback", server.HandleGitHubCallback)

	protected.Post("/api/v1/refresh", server.PostRefresh)
	protected.Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)

	// Agent provider API keys (embedded agent widget)
	protected.Get("/api/v1/config/agent-providers", server.HandleGetAgentProviders)
	protected.Post("/api/v1/config/agent-providers", server.HandleSaveAgentProvider)

	// Unsandbox remote execution
	protected.Get("/api/v1/unsandbox/status", server.GetUnsandboxStatus)
	protected.Post("/api/v1/unsandbox/execute", server.PostUnsandboxExecute)
	protected.Get("/api/v1/unsandbox/jobs/*", server.GetUnsandboxJob)
	protected.Get("/api/v1/unsandbox/sessions", server.GetUnsandboxSessions)
	protected.Get("/api/v1/unsandbox/services", server.GetUnsandboxServices)
	// Unsandbox configuration (API keys)
	protected.Get("/api/v1/config/unsandbox", server.GetUnsandboxConfig)
	protected.Post("/api/v1/config/unsandbox", server.PostUnsandboxConfig)
	protected.Delete("/api/v1/config/unsandbox", server.DeleteUnsandboxConfig)

	// Runtime targets (Tailscale and Kubernetes)
	protected.Get("/api/v1/config/runtimes", server.GetAvailableRuntimes)
	protected.Get("/api/v1/config/tailscale", server.GetTailscaleConfig)
	protected.Post("/api/v1/config/tailscale", server.SaveTailscaleConfig)
	protected.Delete("/api/v1/config/tailscale", server.DeleteTailscaleConfig)
	protected.Get("/api/v1/config/tailscale/test", server.TestTailscaleConfig)
	protected.Get("/api/v1/config/kubernetes", server.GetKubernetesConfig)
	protected.Post("/api/v1/config/kubernetes", server.SaveKubernetesConfig)
	protected.Delete("/api/v1/config/kubernetes", server.DeleteKubernetesConfig)
	protected.Get("/api/v1/config/kubernetes/test", server.TestKubernetesConfig)

	protected.Get("/api/v1/issues/{issue_identifier}", server.GetIssue)
	protected.Get("/api/v1/issues/{issue_identifier}/logs", server.GetIssueLogs)
	protected.Get("/api/v1/issues/{issue_identifier}/history", server.GetIssueHistory)
	protected.Get("/api/v1/issues/{issue_identifier}/diff", server.GetIssueDiff)
	protected.Get("/api/v1/issues/{issue_identifier}/artifacts", server.GetArtifacts)
	protected.Get("/api/v1/issues/{issue_identifier}/artifacts/*", server.GetArtifactContent)
	protected.Patch("/api/v1/issues/{issue_identifier}", server.PatchIssue)
	protected.Delete("/api/v1/issues/{issue_identifier}", server.DeleteIssue)
	protected.Delete("/api/v1/issues/{issue_identifier}/session", server.DeleteIssueSession)
	protected.Post("/api/v1/issues/{issue_identifier}/stop", server.PostIssueStop)

	protected.Get("/api/v1/projects/{project_id}/chat/providers", server.GetWorkspaceChatProviders)
	protected.Get("/api/v1/orchestrator/chat/providers", orchestratorChatScope(server.GetWorkspaceChatProviders))
	protected.Get("/api/v1/orchestrator/chat/providers/{provider}/models", orchestratorChatScope(server.GetWorkspaceChatModels))
	protected.Get("/api/v1/orchestrator/chat/sessions", orchestratorChatScope(server.GetWorkspaceChatSessions))
	protected.Post("/api/v1/orchestrator/chat/sessions", orchestratorChatScope(server.PostWorkspaceChatSession))
	protected.Get("/api/v1/orchestrator/chat/sessions/{session_id}", orchestratorChatScope(server.GetWorkspaceChatSession))
	protected.Patch("/api/v1/orchestrator/chat/sessions/{session_id}/title", orchestratorChatScope(server.PatchWorkspaceChatTitle))
	protected.Patch("/api/v1/orchestrator/chat/sessions/{session_id}/provider", orchestratorChatScope(server.PatchWorkspaceChatProvider))
	protected.Post("/api/v1/orchestrator/chat/sessions/{session_id}/messages", orchestratorChatScope(server.PostWorkspaceChatMessage))
	protected.Post("/api/v1/orchestrator/chat/sessions/{session_id}/stop", orchestratorChatScope(server.PostWorkspaceChatStop))
	protected.Post("/api/v1/orchestrator/chat/sessions/{session_id}/requests/{request_id}/reply", orchestratorChatScope(server.PostWorkspaceChatReply))
	protected.Post("/api/v1/orchestrator/control", server.PostOrchestratorControl)
	protected.Get("/api/v1/projects/{project_id}/agent-catalog", server.GetAgentCatalog)
	protected.Get("/api/v1/projects/{project_id}/agent-catalog/resource", server.GetAgentCatalogResource)
	protected.Get("/api/v1/projects/{project_id}/agent-catalog/receipts/{request_id}", server.GetAgentCatalogReceipt)
	protected.Post("/api/v1/projects/{project_id}/agent-catalog/resource", server.PostAgentCatalogResource)
	protected.Put("/api/v1/projects/{project_id}/agent-catalog/resource", server.PutAgentCatalogResource)
	protected.Delete("/api/v1/projects/{project_id}/agent-catalog/resource", server.DeleteAgentCatalogResource)
	protected.Get("/api/v1/projects/{project_id}/chat/providers/{provider}/models", server.GetWorkspaceChatModels)
	protected.Get("/api/v1/projects/{project_id}/chat/sessions", server.GetWorkspaceChatSessions)
	protected.Get("/api/v1/projects/{project_id}/chat/archives", server.GetWorkspaceChatArchives)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions", server.PostWorkspaceChatSession)
	protected.Get("/api/v1/projects/{project_id}/chat/sessions/{session_id}", server.GetWorkspaceChatSession)
	protected.Patch("/api/v1/projects/{project_id}/chat/sessions/{session_id}/title", server.PatchWorkspaceChatTitle)
	protected.Patch("/api/v1/projects/{project_id}/chat/sessions/{session_id}/provider", server.PatchWorkspaceChatProvider)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions/{session_id}/archive", server.PostWorkspaceChatArchive)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions/{session_id}/unarchive", server.PostWorkspaceChatUnarchive)
	protected.Get("/api/v1/projects/{project_id}/chat/sessions/{session_id}/history", server.GetWorkspaceChatArchiveHistory)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages", server.PostWorkspaceChatMessage)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions/{session_id}/stop", server.PostWorkspaceChatStop)
	protected.Post("/api/v1/projects/{project_id}/chat/sessions/{session_id}/requests/{request_id}/reply", server.PostWorkspaceChatReply)
	// Task Authoring Studio
	protected.Post("/api/v1/studio/sessions", server.PostStudioSession)
	protected.Get("/api/v1/studio/sessions/{id}/events", server.GetStudioSessionEvents)
	protected.Post("/api/v1/studio/sessions/{id}/message", server.PostStudioSessionMessage)
	protected.Post("/api/v1/studio/sessions/{id}/draft", server.PostStudioSessionDraft)
	protected.Get("/api/v1/studio/sessions/{id}/draft", server.GetStudioSessionDraft)
	protected.Post("/api/v1/studio/sessions/{id}/push", server.PostStudioSessionPush)
	protected.Post("/api/v1/studio/sessions/{id}/apply-template", server.PostStudioSessionApplyTemplate)
	protected.Delete("/api/v1/studio/sessions/{id}", server.DeleteStudioSession)
	protected.Get("/api/v1/studio/templates", server.ListStudioTemplates)
	protected.Post("/api/v1/studio/templates", server.CreateStudioTemplate)
	protected.Get("/api/v1/studio/templates/{name}", server.GetStudioTemplate)
	protected.Put("/api/v1/studio/templates/{name}", server.UpdateStudioTemplate)
	protected.Delete("/api/v1/studio/templates/{name}", server.DeleteStudioTemplate)

	return r
}

// RequestLogger returns chi-compatible middleware that logs each HTTP request
// with its method, path, status code, and duration.
func RequestLogger(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Custom response writer to capture status code
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			logger.Info().
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Dur("duration", time.Since(start)).
				Msg("request")
		})
	}
}

func (s *Server) methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSONError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusMethodNotAllowed)
	_, _ = w.Write([]byte(staticassets.NotFoundHTML))
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSONError(w, http.StatusNotFound, "not_found", "route not found")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(staticassets.NotFoundHTML))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func contentTypeGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		contentType := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
		if contentType == "" {
			next.ServeHTTP(w, r)
			return
		}
		if strings.Contains(contentType, "application/json") {
			next.ServeHTTP(w, r)
			return
		}
		writeJSONError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "content-type must be application/json")
	})
}

// writeJSONError writes a structured JSON error response with the given HTTP
// status code, machine-readable error code, and human-readable message.
func writeJSONError(w http.ResponseWriter, status int, code string, message string) {
	writeJSONErrorWithDetails(w, status, code, message, nil)
}

// writeJSONErrorWithDetails is the same as writeJSONError but attaches an
// arbitrary `details` object alongside the error envelope. Use sparingly —
// only when the client genuinely needs partial state (e.g., refresh that
// completed for some files and failed for others).
func writeJSONErrorWithDetails(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	envelope := map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	}
	if details != nil {
		envelope["details"] = details
	}
	if err := json.NewEncoder(w).Encode(envelope); err != nil {
		// Response already started; nothing else to do but log would be ideal.
		// Caller's logger is unavailable here; this is a best-effort path.
		_, _ = w.Write([]byte(`{"error":{"code":"encode_error","message":"failed to encode error response"}}`))
	}
}

// writeJSON encodes v as JSON into w with the given status code.
// If encoding fails, a plain-text error is written instead.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Header already sent; best-effort fallback
		_, _ = w.Write([]byte(`{"error":{"code":"encode_error","message":"failed to encode response"}}`))
	}
}

func corsAllowedOrigins(host string) []string {
	allowlist := []string{
		"http://127.0.0.1:4010",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:5174",
		"http://localhost:4010",
		"http://localhost:5173",
		"http://localhost:5174",
		"http://[::1]:4010",
		"http://[::1]:5173",
		"http://[::1]:5174",
	}

	trimmed := strings.TrimSpace(strings.Trim(host, "[]"))
	if trimmed == "" {
		return allowlist
	}

	if runtimeHostIsLoopback(trimmed) {
		return allowlist
	}

	if parsed, err := url.Parse("http://" + trimmed); err == nil {
		hostname := parsed.Hostname()
		if hostname != "" {
			allowlist = append(allowlist, "http://"+hostname, "https://"+hostname)
		}
	}

	return allowlist
}
