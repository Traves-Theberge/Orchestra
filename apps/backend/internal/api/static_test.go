package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestGetDashboardServesHTML(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("expected html content type, got %q", ct)
	}
	if !strings.Contains(res.Body.String(), "Orchestra Backend") {
		t.Fatalf("expected dashboard html body, got %q", res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "/api/v1/state") {
		t.Fatalf("expected dashboard to reference state endpoint")
	}
	if !strings.Contains(res.Body.String(), "EventSource('/api/v1/events')") {
		t.Fatalf("expected dashboard to subscribe to live events")
	}
	if !strings.Contains(res.Body.String(), "addEventListener('snapshot'") {
		t.Fatalf("expected dashboard to handle named snapshot events")
	}
	if !strings.Contains(res.Body.String(), "Rate Limits") {
		t.Fatalf("expected dashboard to expose rate limit panel")
	}
}

func TestDashboardIncludesCoreLiveStatusSections(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	body := res.Body.String()

	for _, expected := range []string{
		"<div class=\"label\">Running</div>",
		"<div class=\"label\">Retrying</div>",
		"<div class=\"label\">Rate Limits</div>",
		"<h2>Running Issues</h2>",
		"<h2>Retry Queue</h2>",
		"addEventListener('snapshot'",
		"tryRenderEventData(parsed)",
		"source.onerror",
		"setTimeout(loadSnapshot, 1000)",
		"setInterval(loadSnapshot, 2000)",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected dashboard html to contain %q", expected)
		}
	}
}
