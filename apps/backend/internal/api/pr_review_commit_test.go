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
	"github.com/rs/zerolog"
)

func anchoredReviewRequest(server *Server, projectID, payload string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/pulls/7/reviews", strings.NewReader(payload))
	params := chi.NewRouteContext()
	params.URLParams.Add("project_id", projectID)
	params.URLParams.Add("number", "7")
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, params))
	recorder := httptest.NewRecorder()
	server.PostPRReview(recorder, request)
	return recorder
}

func TestPostPRReviewRejectsUnanchoredOrPendingInputBeforeTokenOrNetwork(t *testing.T) {
	transport := prohibitPRHostedHTTP(t)
	server := &Server{logger: zerolog.Nop()} // No DB: validation must precede lookup/token refresh.
	for _, payload := range []string{
		`{"event":"APPROVE"}`, `{"event":"APPROVE","commit_id":"abc"}`,
		`{"event":"APPROVE","commit_id":"` + strings.Repeat("g", 40) + `"}`,
		`{"commit_id":"` + strings.Repeat("a", 40) + `"}`,
		`{"event":"REQUEST_CHANGES","commit_id":"` + strings.Repeat("a", 40) + `","body":" "}`,
	} {
		recorder := anchoredReviewRequest(server, "unused", payload)
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_review") {
			t.Fatalf("invalid review accepted: %d %s", recorder.Code, recorder.Body.String())
		}
	}
	if transport.calls != 0 {
		t.Fatalf("invalid input attempted %d hosted calls", transport.calls)
	}
}

func TestPostPRReviewConfirmsExactCommitAndSubmittedState(t *testing.T) {
	commit := strings.Repeat("a", 40)
	for _, scenario := range []struct {
		name, hostBody, apiCode string
		hostStatus, apiStatus   int
		event                   string
	}{
		{"confirmed approval", `{"id":18,"state":"APPROVED","commit_id":"` + commit + `"}`, `"status":"ok"`, 200, 200, "APPROVE"},
		{"confirmed comment", `{"id":18,"state":"COMMENTED","commit_id":"` + commit + `"}`, `"status":"ok"`, 200, 200, "COMMENT"},
		{"confirmed changes requested", `{"id":18,"state":"CHANGES_REQUESTED","commit_id":"` + commit + `"}`, `"status":"ok"`, 200, 200, "REQUEST_CHANGES"},
		{"other commit", `{"id":18,"state":"APPROVED","commit_id":"` + strings.Repeat("b", 40) + `"}`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"pending is not submitted", `{"id":18,"state":"PENDING","commit_id":"` + commit + `"}`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"missing review identity", `{"state":"APPROVED","commit_id":"` + commit + `"}`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"malformed response", `{`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"trailing malformed data", `{"id":18,"state":"APPROVED","commit_id":"` + commit + `"} broken`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"truncated after confirmation", `{"id":18,"state":"APPROVED","commit_id":"` + commit + `"}`, "pr_review_unconfirmed", 200, 409, "APPROVE"},
		{"server failure is uncertain", `{}`, "pr_review_unconfirmed", 500, 409, "APPROVE"},
		{"lost response after acceptance", "", "pr_review_unconfirmed", 0, 409, "APPROVE"},
		{"rejected request", `{"message":"Forbidden"}`, "github_review_failed", 403, 502, "APPROVE"},
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
			if _, err := warehouse.ExecContext(t.Context(), "UPDATE projects SET github_owner = ?, github_repo = ?, github_token = ? WHERE id = ?", "organization", "repository", "fixture-token", projectID); err != nil {
				t.Fatal(err)
			}
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPost || request.URL.Path != "/repos/organization/repository/pulls/7/reviews" {
					t.Errorf("unexpected hosted request: %s %s", request.Method, request.URL.Path)
				}
				var posted map[string]string
				if err := json.NewDecoder(request.Body).Decode(&posted); err != nil {
					t.Error(err)
				}
				if posted["commit_id"] != commit || posted["event"] != scenario.event || posted["body"] != "Fixture review" {
					t.Errorf("unanchored review payload: %+v", posted)
				}
				if scenario.hostStatus == 0 {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					_ = connection.Close() // Received the POST, but its confirmation was lost.
					return
				}
				if scenario.name == "truncated after confirmation" {
					w.Header().Set("Content-Length", "10000")
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
			recorder := anchoredReviewRequest(server, projectID, `{"event":"`+scenario.event+`","body":"Fixture review","commit_id":"`+strings.Repeat("A", 40)+`"}`)
			if recorder.Code != scenario.apiStatus || !strings.Contains(recorder.Body.String(), scenario.apiCode) {
				t.Fatalf("expected %d/%s, got %d %s", scenario.apiStatus, scenario.apiCode, recorder.Code, recorder.Body.String())
			}
			if transport.calls != 1 {
				t.Fatalf("expected one anchored POST without automatic retry, got %d calls", transport.calls)
			}
		})
	}
}
