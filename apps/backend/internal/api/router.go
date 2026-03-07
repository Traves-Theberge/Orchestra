package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/staticassets"
	"github.com/rs/zerolog"
)

type Server struct {
	logger        zerolog.Logger
	orchestrator  *orchestrator.Service
	workspaceRoot string
	authToken     string
	pubsub        *observability.PubSub
}

func NewRouter(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	workspaceRoot string,
	host string,
	apiToken string,
) http.Handler {
	return NewRouterWithPubSub(logger, orchestratorService, workspaceRoot, host, apiToken, nil)
}

func NewRouterWithPubSub(
	logger zerolog.Logger,
	orchestratorService *orchestrator.Service,
	workspaceRoot string,
	host string,
	apiToken string,
	pubsub *observability.PubSub,
) http.Handler {
	server := &Server{
		logger:        logger,
		orchestrator:  orchestratorService,
		workspaceRoot: workspaceRoot,
		authToken:     apiToken,
		pubsub:        pubsub,
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
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
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
	r.Get("/api/v1/events", server.GetEvents)
	r.Get("/api/v1/workspace/migration/plan", server.GetWorkspaceMigrationPlan)

	requiresAuth := hostRequiresProtectedAuth(host)
	if requiresAuth && strings.TrimSpace(apiToken) != "" {
		r.With(requireBearerToken(apiToken)).Post("/api/v1/refresh", server.PostRefresh)
		r.With(requireBearerToken(apiToken)).Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)
	} else {
		r.Post("/api/v1/refresh", server.PostRefresh)
		r.Post("/api/v1/workspace/migrate", server.PostWorkspaceMigrate)
	}

	r.Get("/api/v1/{issue_identifier}", server.GetIssue)

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
