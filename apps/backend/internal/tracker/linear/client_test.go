package linear_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/linear"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*linear.Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := linear.NewClient("ENG", "test-token", srv.Client(), srv.URL, nil)
	return c, srv
}

func TestFetch_ReturnsWorkItems(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("auth header: got %q", got)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{
						{
							"id":         "abc-123",
							"identifier": "ENG-42",
							"title":      "Fix login bug",
							"state":      map[string]any{"type": "started", "name": "In Progress"},
							"priority":   2,
							"url":        "https://linear.app/eng/issue/ENG-42",
							"labels":     map[string]any{"nodes": []map[string]any{{"name": "bug"}}},
						},
					},
				},
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
	if items[0].ID != "linear:abc-123" {
		t.Errorf("ID: got %q, want linear:abc-123", items[0].ID)
	}
	if items[0].Identifier != "ENG-42" {
		t.Errorf("identifier: got %q, want ENG-42", items[0].Identifier)
	}
	if items[0].Source != "linear" {
		t.Errorf("source: got %q, want linear", items[0].Source)
	}
	if items[0].State != "In Progress" {
		t.Errorf("state: got %q, want In Progress", items[0].State)
	}
	if len(items[0].Labels) != 1 || items[0].Labels[0] != "bug" {
		t.Errorf("labels: got %+v, want [bug]", items[0].Labels)
	}
}

func TestPing_Success(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"viewer": map[string]any{"id": "user-1", "email": "test@example.com"}},
		})
	})
	if err := c.Ping(context.Background()); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

func TestPing_InvalidToken(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		// Empty viewer ID = invalid token per our convention
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"viewer": map[string]any{"id": "", "email": ""}},
		})
	})
	err := c.Ping(context.Background())
	if err == nil {
		t.Error("expected error on empty viewer ID, got nil")
	}
	if !strings.Contains(err.Error(), "viewer ID empty") {
		t.Errorf("error: got %q", err.Error())
	}
}

func TestPing_HTTPError(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	err := c.Ping(context.Background())
	if err == nil {
		t.Error("expected error on 401, got nil")
	}
}

func TestFetchByID_NotFound(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		// Linear returns null for the issue field when not found
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"issue": nil},
		})
	})
	_, err := c.FetchByID(context.Background(), "missing")
	if err == nil {
		t.Error("expected error for missing issue, got nil")
	}
}

func TestComment_PostsBody(t *testing.T) {
	var capturedBody []byte
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"commentCreate": map[string]any{"comment": map[string]any{"id": "c1"}}},
		})
	})
	if err := c.Comment(context.Background(), "issue-1", "Hello"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if !strings.Contains(string(capturedBody), "Hello") {
		t.Errorf("body did not contain comment: %s", capturedBody)
	}
}

func TestGraphQL_ErrorsArrayReturnsError(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"data": nil,
			"errors": []map[string]any{
				{"message": "Entity not found"},
			},
		})
	})
	_, err := c.FetchByID(context.Background(), "missing-id")
	if err == nil {
		t.Fatal("expected error from GraphQL errors array, got nil")
	}
	if !strings.Contains(err.Error(), "Entity not found") {
		t.Errorf("error message: got %q, want it to contain 'Entity not found'", err.Error())
	}
}
