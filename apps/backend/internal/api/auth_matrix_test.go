package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	sqlitetracker "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/rs/zerolog"
)

// route is one row of the auth + smoke matrix. publicRoute=true means the
// router registers the path on the root mux (no requireBearerToken) so it
// must serve unauthenticated requests; everything else lives under
// `protected` and must reject missing/wrong tokens with 401.
type route struct {
	method      string
	path        string
	publicRoute bool
}

// allRoutes mirrors the route table in router.go. Keep this list in sync
// when routes are added or removed — the test asserts the count too so
// silent drift fails CI loudly. Path params are substituted with the
// `pathParam(...)` placeholder so the chi mux actually matches.
var allRoutes = []route{
	{"PATCH", "/api/v1/projects/x/chat/sessions/x/title", false},
	{"PATCH", "/api/v1/orchestrator/chat/sessions/x/title", false},
	// Public — no bearer token required
	{"GET", "/", true},
	{"GET", "/healthz", true},
	{"GET", "/api/v1/healthz", true},
	{"GET", "/api/v1/openapi.yaml", true},
	{"GET", "/api/docs", true},
	{"GET", "/api/docs/", true},
	{"GET", "/api/v1/terminal/" + pathParam("session_id"), true},
	{"GET", "/api/v1/github/login", true},
	{"GET", "/api/v1/github/callback", true},

	// Protected — bearer token required
	{"GET", "/api/v1/stt/health", false},
	{"POST", "/api/v1/stt/transcribe", false},
	{"GET", "/api/v1/state", false},
	{"POST", "/api/v1/orchestrator/control", false},

	// Tracker configs
	{"GET", "/api/v1/tracker/configs", false},
	{"POST", "/api/v1/tracker/configs", false},
	{"PATCH", "/api/v1/tracker/configs/" + pathParam("config_id"), false},
	{"DELETE", "/api/v1/tracker/configs/" + pathParam("config_id"), false},
	{"POST", "/api/v1/tracker/configs/" + pathParam("config_id") + "/test", false},
	{"GET", "/api/v1/tracker/configs/" + pathParam("config_id") + "/projects", false},
	{"GET", "/api/v1/tracker/configs/" + pathParam("config_id") + "/states", false},
	{"GET", "/api/v1/tracker/configs/" + pathParam("config_id") + "/issues", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/tracker", false},
	{"PATCH", "/api/v1/projects/" + pathParam("project_id") + "/issue-source", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/issue-source/test", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/tracker/issues", false},

	// Issues + search
	{"GET", "/api/v1/issues", false},
	{"POST", "/api/v1/issues", false},
	{"GET", "/api/v1/search", false},
	{"GET", "/api/v1/events", false},
	{"GET", "/api/v1/workspace/migration/plan", false},

	// Agent config (legacy + native per-provider)
	{"GET", "/api/v1/config/agents", false},
	{"PATCH", "/api/v1/config/agents", false},
	{"POST", "/api/v1/config/agents", false},
	{"GET", "/api/v1/config/agents/items", false},
	{"POST", "/api/v1/config/agents/new", false},
	{"POST", "/api/v1/config/agents/items", false},
	{"GET", "/api/v1/agents", false},
	{"GET", "/api/v1/agents/setup", false},
	{"GET", "/api/v1/agents/claude/settings", false},
	{"POST", "/api/v1/agents/claude/settings", false},
	{"GET", "/api/v1/agents/claude/instructions", false},
	{"POST", "/api/v1/agents/claude/instructions", false},
	{"DELETE", "/api/v1/agents/claude/instructions", false},
	{"GET", "/api/v1/agents/claude/rules", false},
	{"POST", "/api/v1/agents/claude/rules", false},
	{"DELETE", "/api/v1/agents/claude/rules/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/claude/skills", false},
	{"POST", "/api/v1/agents/claude/skills", false},
	{"DELETE", "/api/v1/agents/claude/skills/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/claude/subagents", false},
	{"POST", "/api/v1/agents/claude/subagents", false},
	{"DELETE", "/api/v1/agents/claude/subagents/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/codex/config", false},
	{"POST", "/api/v1/agents/codex/config", false},
	{"GET", "/api/v1/agents/codex/instructions", false},
	{"POST", "/api/v1/agents/codex/instructions", false},
	{"GET", "/api/v1/agents/codex/subagents", false},
	{"POST", "/api/v1/agents/codex/subagents", false},
	{"DELETE", "/api/v1/agents/codex/subagents/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/codex/skills", false},
	{"POST", "/api/v1/agents/codex/skills", false},
	{"DELETE", "/api/v1/agents/codex/skills/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/codex/rules", false},
	{"POST", "/api/v1/agents/codex/rules", false},
	{"DELETE", "/api/v1/agents/codex/rules/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/gemini/settings", false},
	{"POST", "/api/v1/agents/gemini/settings", false},
	{"GET", "/api/v1/agents/gemini/context", false},
	{"POST", "/api/v1/agents/gemini/context", false},
	{"GET", "/api/v1/agents/gemini/commands", false},
	{"POST", "/api/v1/agents/gemini/commands", false},
	{"DELETE", "/api/v1/agents/gemini/commands/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/opencode/config", false},
	{"POST", "/api/v1/agents/opencode/config", false},
	{"GET", "/api/v1/agents/opencode/agents", false},
	{"POST", "/api/v1/agents/opencode/agents", false},
	{"DELETE", "/api/v1/agents/opencode/agents/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/opencode/commands", false},
	{"POST", "/api/v1/agents/opencode/commands", false},
	{"DELETE", "/api/v1/agents/opencode/commands/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/opencode/skills", false},
	{"POST", "/api/v1/agents/opencode/skills", false},
	{"DELETE", "/api/v1/agents/opencode/skills/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/codex/bundle", false},
	{"GET", "/api/v1/agents/gemini/bundle", false},
	{"GET", "/api/v1/agents/opencode/bundle", false},
	{"POST", "/api/v1/agents/bundle/file", false},

	// Provider domains (mcp/permissions/model/hooks)
	{"GET", "/api/v1/agents/" + pathParam("provider") + "/mcp", false},
	{"POST", "/api/v1/agents/" + pathParam("provider") + "/mcp", false},
	{"PUT", "/api/v1/agents/" + pathParam("provider") + "/mcp/" + pathParam("name"), false},
	{"PATCH", "/api/v1/agents/" + pathParam("provider") + "/mcp/" + pathParam("name"), false},
	{"DELETE", "/api/v1/agents/" + pathParam("provider") + "/mcp/" + pathParam("name"), false},
	{"GET", "/api/v1/agents/" + pathParam("provider") + "/permissions", false},
	{"POST", "/api/v1/agents/" + pathParam("provider") + "/permissions", false},
	{"GET", "/api/v1/agents/" + pathParam("provider") + "/model", false},
	{"POST", "/api/v1/agents/" + pathParam("provider") + "/model", false},
	{"GET", "/api/v1/agents/" + pathParam("provider") + "/hooks", false},
	{"POST", "/api/v1/agents/" + pathParam("provider") + "/hooks", false},

	// Docs
	{"GET", "/api/v1/docs", false},
	{"GET", "/api/v1/docs/index.md", false},

	// MCP global
	{"GET", "/api/v1/mcp/tools", false},
	{"GET", "/api/v1/mcp/servers", false},
	{"POST", "/api/v1/mcp/servers", false},
	{"DELETE", "/api/v1/mcp/servers/" + pathParam("id"), false},

	// Workspace + projects
	{"GET", "/api/v1/workspace/file", false},
	{"PUT", "/api/v1/workspace/file", false},
	{"GET", "/api/v1/workspace/tree", false},
	{"POST", "/api/v1/workspace/dir", false},
	{"POST", "/api/v1/workspace/rename", false},
	{"DELETE", "/api/v1/workspace/path", false},
	{"GET", "/api/v1/projects", false},
	{"POST", "/api/v1/projects", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/file", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/tree", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/status", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/worktree-jobs", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/worktree-jobs/" + pathParam("request_id"), false},
	{"DELETE", "/api/v1/projects/" + pathParam("project_id") + "/git/worktrees/" + pathParam("workspace_id"), false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/worktree-removals/" + pathParam("request_id"), false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/diff", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/refresh", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id"), false},
	{"DELETE", "/api/v1/projects/" + pathParam("project_id"), false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/commit", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/push", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/pull", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/fetch", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/branches", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/checkout", false},
	{"DELETE", "/api/v1/projects/" + pathParam("project_id") + "/git/branches/" + pathParam("branch"), false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/stage", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/unstage", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/stash", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/stash/pop", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/stash/list", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/stash/apply", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/stash/drop", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/conflicts", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/merge/abort", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/resolve", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/git/merge", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/github/disconnect", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/github/create-repo", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/default-branch", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/branches", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/git/branches/detail", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/github/issues", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/github/issues", false},
	{"PATCH", "/api/v1/projects/" + pathParam("project_id") + "/github/issues/" + pathParam("number"), false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls/" + pathParam("number") + "/diff", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls/" + pathParam("number") + "/reviews", false},
	{"POST", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls/" + pathParam("number") + "/reviews", false},
	{"PUT", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls/" + pathParam("number") + "/merge", false},
	{"GET", "/api/v1/projects/" + pathParam("project_id") + "/github/pulls/" + pathParam("number") + "/comments", false},

	// Sessions, telemetry, refresh
	{"GET", "/api/v1/sessions", false},
	{"GET", "/api/v1/sessions/" + pathParam("session_id"), false},
	{"POST", "/api/v1/issues/" + pathParam("issue_identifier") + "/pr", false},
	{"GET", "/api/v1/warehouse/stats", false},
	{"GET", "/api/v1/telemetry/health", false},
	{"POST", "/api/v1/refresh", false},
	{"POST", "/api/v1/workspace/migrate", false},

	// Agent provider keys
	{"GET", "/api/v1/config/agent-providers", false},
	{"POST", "/api/v1/config/agent-providers", false},

	// Unsandbox
	{"GET", "/api/v1/unsandbox/status", false},
	{"POST", "/api/v1/unsandbox/execute", false},
	{"GET", "/api/v1/unsandbox/jobs/job-1", false},
	{"GET", "/api/v1/unsandbox/sessions", false},
	{"GET", "/api/v1/unsandbox/services", false},
	{"GET", "/api/v1/config/unsandbox", false},
	{"POST", "/api/v1/config/unsandbox", false},
	{"DELETE", "/api/v1/config/unsandbox", false},

	// Runtime targets
	{"GET", "/api/v1/config/runtimes", false},
	{"GET", "/api/v1/config/tailscale", false},
	{"POST", "/api/v1/config/tailscale", false},
	{"DELETE", "/api/v1/config/tailscale", false},
	{"GET", "/api/v1/config/tailscale/test", false},
	{"GET", "/api/v1/config/kubernetes", false},
	{"POST", "/api/v1/config/kubernetes", false},
	{"DELETE", "/api/v1/config/kubernetes", false},
	{"GET", "/api/v1/config/kubernetes/test", false},

	// Per-issue lifecycle
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier"), false},
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier") + "/logs", false},
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier") + "/history", false},
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier") + "/diff", false},
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier") + "/artifacts", false},
	{"GET", "/api/v1/issues/" + pathParam("issue_identifier") + "/artifacts/foo.txt", false},
	{"PATCH", "/api/v1/issues/" + pathParam("issue_identifier"), false},
	{"DELETE", "/api/v1/issues/" + pathParam("issue_identifier"), false},
	{"DELETE", "/api/v1/issues/" + pathParam("issue_identifier") + "/session", false},
	{"POST", "/api/v1/issues/" + pathParam("issue_identifier") + "/stop", false},
}

// pathParam returns a stable, valid URL segment for a chi path parameter
// placeholder so the matrix table reads close to how router.go declares
// each route.
func pathParam(_ string) string { return "x" }

// newAuthMatrixRouter builds a router with an auth token configured so
// the `protected` chain actually requires bearer tokens. WorkspaceRoot
// is a temp dir to keep file-touching handlers from blowing up on
// missing-paths and tripping other assertions.
func newAuthMatrixRouter(t *testing.T) http.Handler {
	t.Helper()
	root := t.TempDir()
	return NewRouter(zerolog.Nop(), orchestrator.NewService(), authMatrixConfig(root))
}

// newAuthMatrixRouterWithDB supplies the minimal dependencies needed to take
// authenticated project-file/tree handlers past request authentication
// without producing fixture panics. Keep the no-DB builder above for tests
// that explicitly verify missing-database behavior.
func newAuthMatrixRouterWithDB(t *testing.T) http.Handler {
	t.Helper()
	root := t.TempDir()
	warehouse, err := db.Connect(filepath.Join(root, "auth-matrix.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = warehouse.Close() })
	service := orchestrator.NewService()
	service.SetDB(warehouse)
	service.SetTrackerClient(sqlitetracker.NewClient(warehouse, nil))
	return NewRouterWithPubSub(zerolog.Nop(), service, authMatrixConfig(root), nil, warehouse, nil, nil, nil, nil, nil)
}

func authMatrixConfig(root string) *config.Config {
	return &config.Config{
		WorkspaceRoot: root,
		WorktreeRoot:  filepath.Join(root, "worktrees"),
		Host:          "127.0.0.1",
		APIToken:      "test-token",
		ProjectRoots:  []string{root},
	}
}

// TestAuthMatrixCoversAllRoutes verifies the matrix list above stays in
// sync with router.go. If routes are added or removed and the table
// isn't updated, this test fails so the gap is loud.
func TestAuthMatrixCoversAllRoutes(t *testing.T) {
	const expectedRoutes = 195
	if got := len(allRoutes); got != expectedRoutes {
		t.Fatalf("auth matrix has %d routes, want %d — keep allRoutes in sync with router.go", got, expectedRoutes)
	}
}

// TestAuthMatrixProtectedRoutesRequireBearer hits every protected route
// without a bearer token and asserts a 401 response. Catches accidental
// auth-bypasses introduced by route refactors. Public routes (root,
// healthz, openapi, docs, terminal WS, github oauth) are skipped.
//
// Each subtest uses a unique transport peer so the per-IP rate limiter
// (20 req/s, 60 burst) doesn't return 429 partway through the matrix.
func TestAuthMatrixProtectedRoutesRequireBearer(t *testing.T) {
	router := newAuthMatrixRouter(t)
	for i, r := range allRoutes {
		if r.publicRoute {
			continue
		}
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			req := httptest.NewRequest(r.method, r.path, nil)
			req.RemoteAddr = uniqueIPForIndex(i) + ":12345"
			if needsJSONBody(r.method) {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 unauthorized without bearer token, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAuthMatrixWithBearerAvoids401 hits every route (public + protected)
// with a valid bearer token and asserts the response is anything other
// than 401. Real handlers may legitimately 4xx (bad params) or 5xx
// (missing DB/tracker dependencies) — those are Tier 2 coverage. This
// tier just guards against an auth regression.
func TestAuthMatrixWithBearerAvoids401(t *testing.T) {
	router := newAuthMatrixRouterWithDB(t)
	for i, r := range allRoutes {
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			req := httptest.NewRequest(r.method, r.path, nil)
			req.Header.Set("Authorization", "Bearer test-token")
			req.RemoteAddr = uniqueIPForIndex(i+1000) + ":12345"
			if needsJSONBody(r.method) {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code == http.StatusUnauthorized {
				t.Fatalf("got 401 with valid bearer token; expected handler to take any other path: %s", rec.Body.String())
			}
		})
	}
}

// uniqueIPForIndex returns a distinct dotted-quad per subtest so each
// request lands in a fresh per-IP token bucket and the rate limiter
// doesn't 429 partway through the matrix. The rate limit middleware
// keys on the transport peer and ignores untrusted forwarding headers.
func uniqueIPForIndex(i int) string {
	return fmt.Sprintf("10.%d.%d.%d", (i/65536)&0xff, (i/256)&0xff, i&0xff)
}

func needsJSONBody(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	}
	return false
}
