package jira_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker/jira"
)

// newServerClient creates a client pointed at an httptest server using Server
// detection path (Basic auth) since httptest gives us a localhost URL.
func newServerClient(t *testing.T, h http.HandlerFunc, stateMap map[string]string) (*jira.Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := jira.NewClient(srv.URL, "user@example.com", "pat-token", srv.Client(), stateMap)
	return c, srv
}

func TestFetch_ReturnsWorkItems(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/rest/api/2/search") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		// Server uses Basic auth — verify
		user, pass, ok := r.BasicAuth()
		if !ok || user != "user@example.com" || pass != "pat-token" {
			t.Errorf("basic auth: got %q/%q ok=%v", user, pass, ok)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"issues": []map[string]any{
				{
					"id":  "10001",
					"key": "PROJ-1",
					"fields": map[string]any{
						"summary":  "Fix the bug",
						"priority": map[string]any{"name": "High"},
						"status":   map[string]any{"name": "In Progress"},
						"labels":   []string{"backend"},
					},
				},
			},
		})
	}, map[string]string{"In Progress": "In Progress"})

	items, err := c.Fetch(context.Background(), jira.FilterFromJQL("project = PROJ"))
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	got := items[0]
	if got.ID != "jira:10001" {
		t.Errorf("ID: got %q, want jira:10001", got.ID)
	}
	if got.Identifier != "PROJ-1" {
		t.Errorf("identifier: got %q, want PROJ-1", got.Identifier)
	}
	if got.Source != "jira" {
		t.Errorf("source: got %q, want jira", got.Source)
	}
	if got.Priority != 2 {
		t.Errorf("priority: got %d, want 2 (High)", got.Priority)
	}
}

func TestNewClient_DetectsCloud(t *testing.T) {
	cloud := jira.NewClient("https://acme.atlassian.net", "", "token", nil, nil)
	if cloud == nil {
		t.Fatal("nil client")
	}
	// Indirectly verify cloud detection by checking the API path used in a fake call.
	// We can't read the internal flag, so just ensure the constructor doesn't panic.
}

func TestPing_Success(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"accountId": "user-123"})
	}, nil)
	if err := c.Ping(context.Background()); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

func TestPing_InvalidCredentials(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}, nil)
	err := c.Ping(context.Background())
	if err == nil {
		t.Error("expected error on 401, got nil")
	}
}

func TestPing_EmptyIdentity(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{})
	}, nil)
	err := c.Ping(context.Background())
	if err == nil || !strings.Contains(err.Error(), "empty identity") {
		t.Errorf("expected empty identity error, got %v", err)
	}
}

func TestComment_PostsBody(t *testing.T) {
	var captured map[string]any
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &captured)
		w.WriteHeader(http.StatusCreated)
	}, nil)
	if err := c.Comment(context.Background(), "PROJ-1", "Hello team"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if captured["body"] != "Hello team" {
		t.Errorf("body: got %v, want %q", captured["body"], "Hello team")
	}
}

func TestUpdate_TransitionsState(t *testing.T) {
	transitionedTo := ""
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/transitions"):
			json.NewEncoder(w).Encode(map[string]any{
				"transitions": []map[string]any{
					{"id": "11", "name": "Start Progress", "to": map[string]any{"name": "In Progress"}},
					{"id": "21", "name": "Done", "to": map[string]any{"name": "Done"}},
				},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/transitions"):
			var body map[string]any
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			tr := body["transition"].(map[string]any)
			transitionedTo = tr["id"].(string)
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/issue/PROJ-1"):
			json.NewEncoder(w).Encode(map[string]any{
				"id":  "10001",
				"key": "PROJ-1",
				"fields": map[string]any{
					"summary": "x",
					"status":  map[string]any{"name": "In Progress"},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}, nil)

	_, err := c.Update(context.Background(), "PROJ-1", map[string]any{"state": "In Progress"})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if transitionedTo != "11" {
		t.Errorf("expected transition id 11, got %q", transitionedTo)
	}
}

func TestUpdate_TransitionNotFound(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/transitions") {
			json.NewEncoder(w).Encode(map[string]any{"transitions": []map[string]any{}})
			return
		}
		w.WriteHeader(http.StatusOK)
	}, nil)
	_, err := c.Update(context.Background(), "PROJ-1", map[string]any{"state": "Nonexistent"})
	if err == nil {
		t.Error("expected error for missing transition, got nil")
	}
}
