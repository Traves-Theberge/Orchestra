package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/staticassets"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/rs/zerolog"
)

type Server struct {
	logger        zerolog.Logger
	orchestrator  *orchestrator.Service
	workspaceRoot string
	authToken     string
	pubsub        *observability.PubSub
	db            *db.DB
	config        *config.Config
	termManager   *terminal.Manager
}

func NewRouter(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
) http.Handler {
	return NewRouterWithPubSub(logger, orchestratorService, cfg, nil, nil, nil)
}

func NewRouterWithPubSub(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
	pubsub *observability.PubSub,
	warehouseDB *db.DB,
	termManager *terminal.Manager,
) http.Handler {
	if termManager == nil {
		termManager = terminal.NewManager()
	}
	server := &Server{
		logger:        logger,
		orchestrator:  orchestratorService,
		workspaceRoot: cfg.WorkspaceRoot,
		authToken:     cfg.APIToken,
		pubsub:        pubsub,
		db:            warehouseDB,
		config:        cfg,
		termManager:   termManager,
	}
	r := chi.NewRouter()

	allowedOrigins := corsAllowedOrigins(cfg.Host)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))
	r.Use(contentTypeGuard)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
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
	protected.Get("/api/v1/state", server.GetState)
	protected.Get("/api/v1/issues", server.GetIssues)
	protected.Post("/api/v1/issues", server.PostIssue)
	protected.Get("/api/v1/search", server.GetSearch)
	protected.Get("/api/v1/events", server.GetEvents)
	protected.Get("/api/v1/workspace/migration/plan", server.GetWorkspaceMigrationPlan)
	protected.Get("/api/v1/config/agents", server.GetAgentConfig)
	protected.Post("/api/v1/config/agents", server.PostAgentConfig)
	protected.Get("/api/v1/config/agents/items", server.GetAgentConfigs)
	protected.Post("/api/v1/config/agents/new", server.PostAgentConfigNew)
	protected.Post("/api/v1/config/agents/items", server.PostAgentConfigUpdate)
	protected.Get("/api/v1/agents", server.GetAgents)

	protected.Get("/api/v1/docs", server.GetDocs)
	protected.Get("/api/v1/docs/*", server.GetDocContent)

	protected.Get("/api/v1/mcp/tools", server.GetMCPTools)
	protected.Get("/api/v1/mcp/servers", server.GetMCPServers)
	protected.Post("/api/v1/mcp/servers", server.PostMCPServer)
	protected.Delete("/api/v1/mcp/servers/{id}", server.DeleteMCPServer)

	r.Get("/api/v1/terminal/{session_id}", server.TerminalWebSocket)

	protected.Get("/api/v1/projects", server.GetProjects)
	protected.Post("/api/v1/projects", server.CreateProject)
	protected.Get("/api/v1/projects/{project_id}/file", server.GetProjectFileContent)
	protected.Get("/api/v1/projects/{project_id}/tree", server.GetProjectFileTree)
	protected.Get("/api/v1/projects/{project_id}/git", server.GetProjectGitStats)
	protected.Get("/api/v1/projects/{project_id}/git/status", server.GetProjectGitStatus)
	protected.Get("/api/v1/projects/{project_id}/git/diff", server.GetProjectGitDiff)
	protected.Post("/api/v1/projects/{project_id}/refresh", server.RefreshProject)
	protected.Get("/api/v1/projects/{project_id}", server.GetProject)
	protected.Delete("/api/v1/projects/{project_id}", server.DeleteProject)
	protected.Post("/api/v1/projects/{project_id}/git/commit", server.PostGitCommit)
	protected.Post("/api/v1/projects/{project_id}/git/push", server.PostGitPush)
	protected.Post("/api/v1/projects/{project_id}/git/pull", server.PostGitPull)
	protected.Get("/api/v1/sessions", server.GetSessions)
	protected.Get("/api/v1/sessions/{session_id}", server.GetSessionDetail)
	protected.Post("/api/v1/issues/{issue_identifier}/pr", server.CreateGitHubPR)
	protected.Get("/api/v1/warehouse/stats", server.GetWarehouseStats)
	r.Get("/api/v1/github/login", server.HandleGitHubLogin)
	r.Get("/api/v1/github/callback", server.HandleGitHubCallback)

	protected.Post("/api/v1/refresh", server.PostRefresh)
	protected.Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)

	protected.Get("/api/v1/issues/{issue_identifier}", server.GetIssue)
	protected.Get("/api/v1/issues/{issue_identifier}/logs", server.GetIssueLogs)
	protected.Get("/api/v1/issues/{issue_identifier}/history", server.GetIssueHistory)
	protected.Get("/api/v1/issues/{issue_identifier}/diff", server.GetIssueDiff)
	protected.Get("/api/v1/issues/{issue_identifier}/artifacts", server.GetArtifacts)
	protected.Get("/api/v1/issues/{issue_identifier}/artifacts/*", server.GetArtifactContent)
	protected.Patch("/api/v1/issues/{issue_identifier}", server.PatchIssue)
	protected.Delete("/api/v1/issues/{issue_identifier}", server.DeleteIssue)
	protected.Delete("/api/v1/issues/{issue_identifier}/session", server.DeleteIssueSession)

	return r
}

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

func writeJSONError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func corsAllowedOrigins(host string) []string {
	allowlist := []string{
		"http://127.0.0.1:*",
		"http://localhost:*",
		"http://[::1]:*",
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
