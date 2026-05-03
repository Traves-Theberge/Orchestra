package github_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	trackergithub "github.com/orchestra/orchestra/apps/backend/internal/tracker/github"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// newTestClient points the GitHub client at an httptest server by overriding
// http.Client.Transport with a redirector that rewrites the host.
func newTestClient(t *testing.T, h http.HandlerFunc) (*trackergithub.Client, *httptest.Server) {
	t.Helper()
	if h == nil {
		h = func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	// Redirect api.github.com and the test repo path to our test server.
	transport := &rewriteTransport{base: srv.Client().Transport, host: srv.URL}
	httpClient := &http.Client{Transport: transport}
	c := trackergithub.NewClient("owner", "repo", "test-token", httpClient, nil)
	return c, srv
}

type rewriteTransport struct {
	base http.RoundTripper
	host string
}

func (r *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Rewrite request URL to point at our httptest server, preserving path+query.
	target, err := http.NewRequest(req.Method, r.host+req.URL.RequestURI(), req.Body)
	if err != nil {
		return nil, err
	}
	for k, v := range req.Header {
		target.Header[k] = v
	}
	base := r.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(target.WithContext(req.Context()))
}

func TestPing_Success(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"login": "testuser"})
	})
	if err := c.Ping(context.Background()); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

func TestPing_Unauthorized(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	err := c.Ping(context.Background())
	if err == nil || !strings.Contains(err.Error(), "unauthorized") {
		t.Errorf("expected unauthorized error, got %v", err)
	}
}

func TestFetch_ReturnsWorkItems(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]map[string]any{
			{
				"number":   42,
				"title":    "Fix bug",
				"body":     "details",
				"state":    "open",
				"html_url": "https://github.com/owner/repo/issues/42",
				"labels":   []map[string]any{{"name": "bug"}},
			},
		})
	})

	items, err := c.Fetch(context.Background(), tracker.Filter{})
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Source != "github" {
		t.Errorf("source: got %q, want github", items[0].Source)
	}
	if items[0].ID != "gh:repo-42" {
		t.Errorf("ID: got %q, want gh:repo-42", items[0].ID)
	}
	if items[0].Identifier != "repo-42" {
		t.Errorf("identifier: got %q, want repo-42", items[0].Identifier)
	}
}

func TestFetchProjects_ReturnsRepoEntry(t *testing.T) {
	c, _ := newTestClient(t, nil)
	projects, err := c.FetchProjects(context.Background())
	if err != nil {
		t.Fatalf("FetchProjects: %v", err)
	}
	if len(projects) != 1 || projects[0].ID != "owner/repo" {
		t.Errorf("got %+v, want one entry [owner/repo]", projects)
	}
}

func TestFetchStates_ReturnsOpenAndClosed(t *testing.T) {
	c, _ := newTestClient(t, nil)
	states, err := c.FetchStates(context.Background())
	if err != nil {
		t.Fatalf("FetchStates: %v", err)
	}
	if len(states) != 2 {
		t.Fatalf("expected 2 states, got %d", len(states))
	}
	if states[0].ID != "open" || states[1].ID != "closed" {
		t.Errorf("unexpected states: %+v", states)
	}
}
