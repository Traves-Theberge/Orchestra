package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/staticassets"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
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
}

func NewRouter(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
) http.Handler {
	return NewRouterWithPubSub(logger, orchestratorService, cfg, nil, nil)
}

func NewRouterWithPubSub(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	cfg *config.Config,
	pubsub *observability.PubSub,
	warehouseDB *db.DB,
) http.Handler {
	server := &Server{
		logger:        logger,
		orchestrator:  orchestratorService,
		workspaceRoot: cfg.WorkspaceRoot,
		authToken:     cfg.APIToken,
		pubsub:        pubsub,
		db:            warehouseDB,
		config:        cfg,
	}
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))
	r.Use(contentTypeGuard)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:*", "http://127.0.0.1:*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.MethodNotAllowed(server.methodNotAllowed)
	r.NotFound(server.notFound)

	r.Get("/", server.GetDashboard)
	r.Get("/healthz", Healthz)
	r.Get("/api/v1/healthz", Healthz)
	r.Get("/api/v1/state", server.GetState)
	r.Get("/api/v1/issues", server.GetIssues)
	r.Post("/api/v1/issues", server.PostIssue)
	r.Get("/api/v1/search", server.GetSearch)
	r.Get("/api/v1/events", server.GetEvents)
	r.Get("/api/v1/workspace/migration/plan", server.GetWorkspaceMigrationPlan)
	r.Get("/api/v1/config/agents", server.GetAgentConfig)
	r.Post("/api/v1/config/agents", server.PostAgentConfig)
	r.Get("/api/v1/config/agents/items", server.GetAgentConfigs)
	r.Post("/api/v1/config/agents/new", server.PostAgentConfigNew)
	r.Post("/api/v1/config/agents/items", server.PostAgentConfigUpdate)
	r.Get("/api/v1/agents", server.GetAgents)

	r.Get("/api/v1/projects", server.GetProjects)
	r.Post("/api/v1/projects", server.CreateProject)
	r.Get("/api/v1/projects/{project_id}", server.GetProject)
	r.Delete("/api/v1/projects/{project_id}", server.DeleteProject)
	r.Post("/api/v1/projects/{project_id}/refresh", server.RefreshProject)
	r.Get("/api/v1/projects/{project_id}/tree", server.GetProjectFileTree)
	r.Get("/api/v1/projects/{project_id}/git", server.GetProjectGitStats)
	r.Post("/api/v1/projects/{project_id}/git/commit", server.PostGitCommit)
	r.Post("/api/v1/projects/{project_id}/git/push", server.PostGitPush)
	r.Post("/api/v1/projects/{project_id}/git/pull", server.PostGitPull)
	r.Get("/api/v1/sessions", server.GetSessions)
	r.Get("/api/v1/sessions/{session_id}", server.GetSessionDetail)
	r.Post("/api/v1/issues/{issue_identifier}/pr", server.CreateGitHubPR)
	r.Get("/api/v1/warehouse/stats", server.GetWarehouseStats)
	r.Get("/api/v1/github/login", server.HandleGitHubLogin)
	r.Get("/api/v1/github/callback", server.HandleGitHubCallback)

	requiresAuth := hostRequiresProtectedAuth(cfg.Host)
	if requiresAuth && strings.TrimSpace(cfg.APIToken) != "" {
		r.With(requireBearerToken(cfg.APIToken)).Post("/api/v1/refresh", server.PostRefresh)
		r.With(requireBearerToken(cfg.APIToken)).Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)
	} else {
		r.Post("/api/v1/refresh", server.PostRefresh)
		r.Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)
	}

	r.Get("/api/v1/issues/{issue_identifier}", server.GetIssue)
	r.Get("/api/v1/issues/{issue_identifier}/logs", server.GetIssueLogs)
	r.Get("/api/v1/issues/{issue_identifier}/diff", server.GetIssueDiff)
	r.Get("/api/v1/issues/{issue_identifier}/artifacts", server.GetArtifacts)
	r.Get("/api/v1/issues/{issue_identifier}/artifacts/*", server.GetArtifactContent)
	r.Patch("/api/v1/issues/{issue_identifier}", server.PatchIssue)
	r.Delete("/api/v1/issues/{issue_identifier}/session", server.DeleteIssueSession)

	return r
}

func RequestLogger(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			next.ServeHTTP(w, r)
			logger.Info().
				Str("method", r.Method).
				Str("path", r.URL.Path).
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
