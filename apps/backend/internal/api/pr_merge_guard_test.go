package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"github.com/rs/zerolog"
)

type mergeAPIFixtureTransport struct {
	target *url.URL
	calls  int
}

func (transport *mergeAPIFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls++
	clone := request.Clone(request.Context())
	requestURL := *request.URL
	requestURL.Scheme, requestURL.Host = transport.target.Scheme, transport.target.Host
	clone.URL = &requestURL
	return http.DefaultTransport.RoundTrip(clone)
}

func reviewedHeadMergeRequest(server *Server, projectID, payload string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+projectID+"/github/pulls/7/merge", strings.NewReader(payload))
	params := chi.NewRouteContext()
	params.URLParams.Add("project_id", projectID)
	params.URLParams.Add("number", "7")
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, params))
	recorder := httptest.NewRecorder()
	server.PostPRMerge(recorder, request)
	return recorder
}

func TestPostPRMergeRequiresReviewedHeadBeforeTokenOrNetwork(t *testing.T) {
	transport := prohibitPRHostedHTTP(t)
	// Deliberately no DB/config: invalid input must fail before project lookup
	// or any token refresh that could perform an HTTP request.
	server := &Server{logger: zerolog.Nop()}
	for _, sha := range []string{"", "abc", strings.Repeat("g", 40), strings.Repeat("a", 39), strings.Repeat("a", 41)} {
		body, _ := json.Marshal(map[string]string{"method": "merge", "expected_head_sha": sha})
		recorder := reviewedHeadMergeRequest(server, "unused", string(body))
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_expected_head_sha") {
			t.Fatalf("expected invalid reviewed head, got %d: %s", recorder.Code, recorder.Body.String())
		}
	}
	recorder := reviewedHeadMergeRequest(server, "unused", `{"method":"merge"}`)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_expected_head_sha") {
		t.Fatalf("missing SHA accepted: %d %s", recorder.Code, recorder.Body.String())
	}
	if transport.calls != 0 {
		t.Fatalf("invalid input attempted %d hosted calls", transport.calls)
	}
}

func TestPostPRMergeAtomicReviewedHeadAndResultContract(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		hostStatus int
		hostBody   string
		apiStatus  int
		apiCode    string
	}{
		{name: "unchanged head merges", hostStatus: 200, hostBody: `{"merged":true}`, apiStatus: 200, apiCode: `"status":"ok"`},
		{name: "changed head conflicts", hostStatus: 409, hostBody: `{"message":"Head changed"}`, apiStatus: 409, apiCode: "pr_head_changed"},
		{name: "not merged is not success", hostStatus: 200, hostBody: `{"merged":false}`, apiStatus: 409, apiCode: "pr_not_merged"},
		{name: "missing result is not success", hostStatus: 200, hostBody: `{}`, apiStatus: 502, apiCode: "github_merge_failed"},
		{name: "malformed result is not success", hostStatus: 200, hostBody: `{`, apiStatus: 502, apiCode: "github_merge_failed"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			root := t.TempDir()
			warehouse, err := db.Connect(filepath.Join(root, "warehouse.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer warehouse.Close()
			projectID, err := warehouse.UpsertProject(t.Context(), root, "")
			if err != nil {
				t.Fatal(err)
			}
			_, err = warehouse.ExecContext(t.Context(), "UPDATE projects SET github_owner = ?, github_repo = ?, github_token = ? WHERE id = ?", "organization", "repository", "fixture-token", projectID)
			if err != nil {
				t.Fatal(err)
			}
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPut || request.URL.Path != "/repos/organization/repository/pulls/7/merge" {
					t.Errorf("wrong hosted mutation: %s %s", request.Method, request.URL)
				}
				var payload ghutil.MergeRequest
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if payload.SHA != strings.Repeat("a", 40) || payload.MergeMethod != "merge" {
					t.Errorf("lost reviewed head/default merge method: %+v", payload)
				}
				w.WriteHeader(scenario.hostStatus)
				_, _ = w.Write([]byte(scenario.hostBody))
			}))
			defer fixture.Close()
			target, _ := url.Parse(fixture.URL)
			transport := &mergeAPIFixtureTransport{target: target}
			previous := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: transport}
			defer func() { http.DefaultClient = previous }()
			server := &Server{logger: zerolog.Nop(), db: warehouse, config: &config.Config{}}
			recorder := reviewedHeadMergeRequest(server, projectID, `{"expected_head_sha":"`+strings.Repeat("A", 40)+`"}`)
			if recorder.Code != scenario.apiStatus || !strings.Contains(recorder.Body.String(), scenario.apiCode) {
				t.Fatalf("expected %d/%s, got %d: %s", scenario.apiStatus, scenario.apiCode, recorder.Code, recorder.Body.String())
			}
			if transport.calls != 1 {
				t.Fatalf("expected single atomic merge and no prefetch, got %d calls", transport.calls)
			}
		})
	}
}
