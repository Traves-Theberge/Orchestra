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
							"team":       map[string]any{"id": "team-uuid", "key": "ENG"},
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

func TestFetchProjectsReturnsTeamKeyAndIDSeparately(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"teams": map[string]any{"nodes": []map[string]any{{"id": "team-uuid", "key": "ENG", "name": "Engineering"}}}}})
	})
	projects, err := c.FetchProjects(context.Background())
	if err != nil {
		t.Fatalf("FetchProjects: %v", err)
	}
	if len(projects) != 1 || projects[0].ID != "team-uuid" || projects[0].Key != "ENG" || projects[0].Name != "Engineering" {
		t.Fatalf("unexpected team identity: %+v", projects)
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
		if strings.Contains(string(capturedBody), "commentCreate") {
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"commentCreate": map[string]any{"comment": map[string]any{"id": "c1"}}}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"issue": map[string]any{
			"id": "issue-1", "identifier": "ENG-1", "team": map[string]any{"id": "team-uuid", "key": "ENG"},
		}}})
	})
	if err := c.Comment(context.Background(), "issue-1", "Hello"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if !strings.Contains(string(capturedBody), "Hello") {
		t.Errorf("body did not contain comment: %s", capturedBody)
	}
}

func TestCreateResolvesTeamKeyAndConfirmsReturnedScope(t *testing.T) {
	var createdTeamID string
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.Contains(string(body), "teams(filter"):
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"teams": map[string]any{"nodes": []map[string]any{{"id": "team-uuid", "key": "ENG"}}}}})
		case strings.Contains(string(body), "issueCreate"):
			var request struct {
				Variables map[string]any `json:"variables"`
			}
			_ = json.Unmarshal(body, &request)
			createdTeamID, _ = request.Variables["teamId"].(string)
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"issueCreate": map[string]any{"issue": map[string]any{
				"id": "created-id", "identifier": "ENG-43", "title": "Create me", "team": map[string]any{"id": "team-uuid", "key": "ENG"},
			}}}})
		default:
			t.Errorf("unexpected request: %s", body)
		}
	})

	created, err := c.Create(context.Background(), tracker.WorkItem{Title: "Create me"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if createdTeamID != "team-uuid" {
		t.Fatalf("teamId sent: %q, want resolved UUID", createdTeamID)
	}
	if created.SourceProjectID != "ENG" || created.SourceID != "created-id" {
		t.Fatalf("source identities not retained: %+v", created)
	}
}

func TestPrefixedIDsAreNormalizedAndForeignTeamMutationIsRefused(t *testing.T) {
	var gotNativeID string
	var mutationSent bool
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.Contains(string(body), "issue(id: $id)"):
			var request struct {
				Variables map[string]any `json:"variables"`
			}
			_ = json.Unmarshal(body, &request)
			gotNativeID, _ = request.Variables["id"].(string)
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"issue": map[string]any{
				"id": "abc-123", "identifier": "MKT-9", "team": map[string]any{"id": "other-team", "key": "MKT"},
			}}})
		case strings.Contains(string(body), "issueUpdate") || strings.Contains(string(body), "issueDelete") || strings.Contains(string(body), "commentCreate"):
			mutationSent = true
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
		default:
			t.Errorf("unexpected request: %s", body)
		}
	})

	if _, err := c.FetchByID(context.Background(), "linear:abc-123"); err == nil {
		t.Fatal("expected prefixed ID read to reject issue from another team")
	}
	if gotNativeID != "abc-123" {
		t.Fatalf("native issue ID sent: %q", gotNativeID)
	}
	for _, mutate := range []func() error{
		func() error {
			_, err := c.Update(context.Background(), "linear:abc-123", map[string]any{"title": "changed"})
			return err
		},
		func() error { return c.Delete(context.Background(), "linear:abc-123") },
		func() error { return c.Comment(context.Background(), "linear:abc-123", "hi") },
	} {
		if err := mutate(); err == nil {
			t.Fatal("expected foreign-team mutation to be refused")
		}
	}
	if mutationSent {
		t.Fatal("mutation sent before selected team scope was confirmed")
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
