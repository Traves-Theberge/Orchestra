package jira_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/jira"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newCloudTestClient(t *testing.T, user string, handler http.HandlerFunc) (*jira.Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	target, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse fixture URL: %v", err)
	}
	transport := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		forward := req.Clone(req.Context())
		forwardURL := *req.URL
		forwardURL.Scheme = target.Scheme
		forwardURL.Host = target.Host
		forward.URL = &forwardURL
		forward.Host = target.Host
		return srv.Client().Transport.RoundTrip(forward)
	})
	c := jira.NewClient("https://acme.atlassian.net", user, "fixture-api-token", &http.Client{Transport: transport}, nil)
	c.SetDefaultProject("PROJ")
	return c, srv
}

// newServerClient creates a client pointed at an httptest server using Server
// detection path (Basic auth) since httptest gives us a localhost URL.
func newServerClient(t *testing.T, h http.HandlerFunc, stateMap map[string]string) (*jira.Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := jira.NewClient(srv.URL, "user@example.com", "pat-token", srv.Client(), stateMap)
	c.SetDefaultProject("PROJ")
	return c, srv
}

func TestFetch_ReturnsWorkItems(t *testing.T) {
	var capturedJQL string
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/rest/api/2/search") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		// Server uses Basic auth — verify
		user, pass, ok := r.BasicAuth()
		if !ok || user != "user@example.com" || pass != "pat-token" {
			t.Errorf("basic auth: got %q/%q ok=%v", user, pass, ok)
		}
		capturedJQL = r.URL.Query().Get("jql")
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
						"project":  map[string]any{"key": "PROJ"},
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
	if got.SourceID != "10001" || got.SourceProjectID != "PROJ" {
		t.Errorf("native identities: source_id=%q source_project_id=%q", got.SourceID, got.SourceProjectID)
	}
	if !strings.Contains(capturedJQL, "project = PROJ") {
		t.Fatalf("JQL did not include configured project scope: %q", capturedJQL)
	}
}

func TestFetchProjectsReturnsJiraProjectIDAndKeySeparately(t *testing.T) {
	c, _ := newServerClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "20002", "key": "PROJ", "name": "Project"}})
	}, nil)
	projects, err := c.FetchProjects(context.Background())
	if err != nil {
		t.Fatalf("FetchProjects: %v", err)
	}
	if len(projects) != 1 || projects[0].ID != "20002" || projects[0].Key != "PROJ" || projects[0].Name != "Project" {
		t.Fatalf("unexpected Jira project identity: %+v", projects)
	}
}

func TestFetch_ExplicitJQLCannotEscapeConfiguredProject(t *testing.T) {
	var capturedJQL string
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		capturedJQL = r.URL.Query().Get("jql")
		json.NewEncoder(w).Encode(map[string]any{"issues": []any{}})
	}, nil)
	if _, err := c.Fetch(context.Background(), jira.FilterFromJQL(`project = OTHER OR text ~ "x" ORDER BY updated DESC`)); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if !strings.Contains(capturedJQL, "project = PROJ AND (project = OTHER OR text ~") || !strings.HasSuffix(capturedJQL, "ORDER BY updated DESC") {
		t.Fatalf("unexpected scoped JQL: %q", capturedJQL)
	}
}

func TestFetch_OrderOnlyJQLKeepsValidProjectScope(t *testing.T) {
	var capturedJQL string
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		capturedJQL = r.URL.Query().Get("jql")
		json.NewEncoder(w).Encode(map[string]any{"issues": []any{}})
	}, nil)
	if _, err := c.Fetch(context.Background(), jira.FilterFromJQL("ORDER BY created DESC")); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if capturedJQL != "project = PROJ ORDER BY created DESC" {
		t.Fatalf("unexpected order-only scoped JQL: %q", capturedJQL)
	}
}

func TestNewClient_CloudDetectionAndAuth(t *testing.T) {
	// Cloud detection: .atlassian.net → IsCloud() returns true.
	cloud := jira.NewClient("https://acme.atlassian.net", "", "cloud-token", nil, nil)
	if !cloud.IsCloud() {
		t.Error("expected cloud=true for .atlassian.net URL")
	}

	// Server: any URL without .atlassian.net → IsCloud() returns false,
	// uses /rest/api/2 + Basic auth — verified through an httptest server.
	var serverPath, serverAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverPath = r.URL.Path
		serverAuth = r.Header.Get("Authorization")
		json.NewEncoder(w).Encode(map[string]any{"name": "user1"})
	}))
	defer srv.Close()

	server := jira.NewClient(srv.URL, "user1", "pat", srv.Client(), nil)
	if server.IsCloud() {
		t.Error("expected cloud=false for non-atlassian.net URL")
	}
	if err := server.Ping(context.Background()); err != nil {
		t.Fatalf("server Ping: %v", err)
	}
	if !strings.HasPrefix(serverPath, "/rest/api/2/") {
		t.Errorf("server path: got %q, want /rest/api/2/...", serverPath)
	}
	if !strings.HasPrefix(serverAuth, "Basic ") {
		t.Errorf("server auth: got %q, want Basic ...", serverAuth)
	}
}

func TestCloudSearchUsesEmailBasicAuthAndEnhancedRoute(t *testing.T) {
	var gotPath, gotUser, gotPassword string
	c, _ := newCloudTestClient(t, "user@example.com", func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotUser, gotPassword, _ = r.BasicAuth()
		json.NewEncoder(w).Encode(map[string]any{"issues": []map[string]any{{
			"id": "10001", "key": "PROJ-1",
			"fields": map[string]any{"summary": "Cloud issue", "project": map[string]any{"key": "PROJ"}},
		}}})
	})
	issues, err := c.Fetch(context.Background(), jira.FilterFromJQL("project = PROJ"))
	if err != nil {
		t.Fatalf("Cloud Fetch: %v", err)
	}
	if len(issues) != 1 || issues[0].Identifier != "PROJ-1" {
		t.Fatalf("unexpected issues: %+v", issues)
	}
	if gotPath != "/rest/api/3/search/jql" {
		t.Fatalf("Cloud issue search path = %q, want /rest/api/3/search/jql", gotPath)
	}
	if gotUser != "user@example.com" || gotPassword != "fixture-api-token" {
		t.Fatalf("Cloud email/token Basic auth = %q/%q, want email/API token", gotUser, gotPassword)
	}
}

func TestCloudWithoutEmailUsesIntentionalBearerCredential(t *testing.T) {
	var gotPath, gotAuth string
	c, _ := newCloudTestClient(t, "", func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		json.NewEncoder(w).Encode([]map[string]any{{"id": "20002", "key": "PROJ", "name": "Project"}})
	})
	projects, err := c.FetchProjects(context.Background())
	if err != nil {
		t.Fatalf("FetchProjects: %v", err)
	}
	if len(projects) != 1 || projects[0].Key != "PROJ" {
		t.Fatalf("unexpected projects: %+v", projects)
	}
	if gotPath != "/rest/api/3/project" {
		t.Fatalf("Cloud project path = %q, want /rest/api/3/project", gotPath)
	}
	if gotAuth != "Bearer fixture-api-token" {
		t.Fatalf("Cloud auth = %q, want intentionally configured Bearer credential", gotAuth)
	}
}

func TestCreate_RequiresProjectKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("server should not be called when project key is missing")
	}))
	defer srv.Close()
	c := jira.NewClient(srv.URL, "user", "pat", srv.Client(), nil)
	_, err := c.Create(context.Background(), tracker.WorkItem{Title: "no project"})
	if err == nil {
		t.Fatal("expected error when no project key, got nil")
	}
	if !strings.Contains(err.Error(), "project key") {
		t.Errorf("error should mention project key: %v", err)
	}
}

func TestCreate_UsesProjectKeyFromWorkItem(t *testing.T) {
	var capturedProject string
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/issue"):
			var body struct {
				Fields struct {
					Project struct {
						Key string `json:"key"`
					} `json:"project"`
				} `json:"fields"`
			}
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			capturedProject = body.Fields.Project.Key
			json.NewEncoder(w).Encode(map[string]any{"id": "20002", "key": "PROJ-2"})
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/issue/PROJ-2"):
			json.NewEncoder(w).Encode(map[string]any{
				"id":  "20002",
				"key": "PROJ-2",
				"fields": map[string]any{
					"summary": "new",
					"status":  map[string]any{"name": "To Do"},
					"project": map[string]any{"key": "PROJ"},
				},
			})
		}
	}, nil)

	created, err := c.Create(context.Background(), tracker.WorkItem{Title: "new", ProjectID: "local-project-uuid"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if capturedProject != "PROJ" {
		t.Errorf("project key sent: got %q, want PROJ", capturedProject)
	}
	if created.Identifier != "PROJ-2" {
		t.Errorf("identifier: got %q", created.Identifier)
	}
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
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(map[string]any{"id": "10001", "key": "PROJ-1", "fields": map[string]any{"project": map[string]any{"key": "PROJ"}}})
			return
		}
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

func TestCloudCommentUsesADFAndNormalizesPrefixedID(t *testing.T) {
	var path string
	var request map[string]any
	testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(map[string]any{"id": "10001", "key": "PROJ-1", "fields": map[string]any{"project": map[string]any{"key": "PROJ"}}})
			return
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &request)
		w.WriteHeader(http.StatusCreated)
	}))
	defer testServer.Close()
	client := jira.NewClient("https://acme.atlassian.net", "", "token", &http.Client{Transport: rewriteHostRoundTripper{base: testServer.URL, next: testServer.Client().Transport}}, nil)
	client.SetDefaultProject("PROJ")
	if err := client.Comment(context.Background(), "jira:10001", "Hello team"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if !strings.HasSuffix(path, "/issue/10001/comment") {
		t.Fatalf("prefixed ID was not normalized in path: %q", path)
	}
	body, ok := request["body"].(map[string]any)
	if !ok || body["type"] != "doc" || body["version"] != float64(1) {
		t.Fatalf("Cloud comment body is not ADF: %#v", request["body"])
	}
}

func TestUpdateRejectsForeignProjectBeforeSendingMutation(t *testing.T) {
	var mutationSent bool
	c, _ := newServerClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			mutationSent = true
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "10001", "key": "OTHER-1", "fields": map[string]any{"project": map[string]any{"key": "OTHER"}}})
	}, nil)
	if _, err := c.Update(context.Background(), "jira:10001", map[string]any{"title": "wrong project"}); err == nil {
		t.Fatal("expected foreign-project update to fail")
	}
	if mutationSent {
		t.Fatal("update effect was sent before project scope was confirmed")
	}
}

type rewriteHostRoundTripper struct {
	base string
	next http.RoundTripper
}

func (r rewriteHostRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	replacement, err := url.Parse(r.base)
	if err != nil {
		return nil, err
	}
	clone.URL.Scheme = replacement.Scheme
	clone.URL.Host = replacement.Host
	return r.next.RoundTrip(clone)
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
					"project": map[string]any{"key": "PROJ"},
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
