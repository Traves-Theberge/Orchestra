package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	_ "modernc.org/sqlite"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/studio"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type fakeTracker struct {
	created []*tracker.Issue
	updates []map[string]any
	nextID  int
}

func (f *fakeTracker) CreateIssue(_ context.Context, title, description, state string, priority int, assigneeID, projectID, provider string, disabledTools []string) (*tracker.Issue, error) {
	f.nextID++
	iss := &tracker.Issue{
		ID:          fmt.Sprintf("uuid-%d", f.nextID),
		Identifier:  fmt.Sprintf("ISS-%d", f.nextID),
		Title:       title,
		Description: description,
	}
	f.created = append(f.created, iss)
	return iss, nil
}

func (f *fakeTracker) UpdateIssue(_ context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	f.updates = append(f.updates, updates)
	return &tracker.Issue{Identifier: identifier}, nil
}

type studioFixture struct {
	server  *httptest.Server
	mgr     *studio.Manager
	bus     *observability.PubSub
	tracker *fakeTracker
	runner  *studio.FakeRunner
}

func spinUpStudioAPI(t *testing.T) *studioFixture {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if _, err := d.Exec(db.Schema); err != nil {
		t.Fatalf("schema: %v", err)
	}

	bus := observability.NewPubSub()
	runner := studio.NewFakeRunner()
	mgr := studio.NewManager(d, bus, runner)
	tr := &fakeTracker{}
	mgr.SetTracker(tr)

	srv := &Server{
		studioMgr: mgr,
		pubsub:    bus,
	}
	r := chi.NewRouter()
	r.Post("/api/v1/studio/sessions", srv.PostStudioSession)
	r.Get("/api/v1/studio/sessions/{id}/events", srv.GetStudioSessionEvents)
	r.Post("/api/v1/studio/sessions/{id}/message", srv.PostStudioSessionMessage)
	r.Post("/api/v1/studio/sessions/{id}/draft", srv.PostStudioSessionDraft)
	r.Get("/api/v1/studio/sessions/{id}/draft", srv.GetStudioSessionDraft)
	r.Post("/api/v1/studio/sessions/{id}/push", srv.PostStudioSessionPush)
	r.Delete("/api/v1/studio/sessions/{id}", srv.DeleteStudioSession)

	ts := httptest.NewServer(r)
	t.Cleanup(ts.Close)
	return &studioFixture{server: ts, mgr: mgr, bus: bus, tracker: tr, runner: runner}
}

func TestStudioCreateSession(t *testing.T) {
	f := spinUpStudioAPI(t)
	resp, err := http.Post(f.server.URL+"/api/v1/studio/sessions", "application/json",
		bytes.NewBufferString(`{"project_id":"p","runner":"claude-code"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	var out struct {
		SessionID string `json:"session_id"`
		SSEURL    string `json:"sse_url"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.SessionID == "" {
		t.Fatalf("empty session id")
	}
}

func TestStudioDraftHTTPPatchValidationAndClear(t *testing.T) {
	f := spinUpStudioAPI(t)
	sess, err := f.mgr.StartSession(context.Background(), studio.StartSessionRequest{Runner: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := f.server.URL + "/api/v1/studio/sessions/" + sess.ID + "/draft"
	post := func(body string, status int) {
		t.Helper()
		response, err := http.Post(endpoint, "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != status {
			t.Fatalf("%s: status %d, want %d", body, response.StatusCode, status)
		}
	}
	post(`{"title":"saved","max_turns":5,"acceptance_criteria":["check"],"attachments":[{"kind":"file","path":"main.go"}]}`, http.StatusNoContent)
	for _, body := range []string{`{"title":"wrong","max_turns":1.5}`, `{"title":"wrong","max_turns":1.000000000000000001}`, `{"title":"wrong","attachments":[{"kind":"invalid"}]}`, `{"title":"wrong"} {}`, `null`} {
		post(body, http.StatusBadRequest)
		snap, err := f.mgr.GetDraft(sess.ID)
		if err != nil || snap.Title != "saved" || snap.MaxTurns == nil || *snap.MaxTurns != 5 || len(snap.Attachments) != 1 {
			t.Fatalf("invalid HTTP patch changed storage: %+v %v", snap, err)
		}
	}
	for _, body := range []string{`{"max_turns":5.0}`, `{"max_turns":5e0}`, `{"max_turns":0.5e1}`} {
		post(body, http.StatusNoContent)
		snap, err := f.mgr.GetDraft(sess.ID)
		if err != nil || snap.MaxTurns == nil || *snap.MaxTurns != 5 {
			t.Fatalf("integral decimal/exponent reload: %+v %v", snap, err)
		}
	}
	post(`{"max_turns":null,"acceptance_criteria":[],"attachments":[]}`, http.StatusNoContent)
	response, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var snap map[string]any
	if err := json.NewDecoder(response.Body).Decode(&snap); err != nil {
		t.Fatal(err)
	}
	value, exists := snap["max_turns"]
	if !exists || value != nil || snap["title"] != "saved" || len(snap["attachments"].([]any)) != 0 || len(snap["acceptance_criteria"].([]any)) != 0 {
		t.Fatalf("canonical HTTP reload: %+v", snap)
	}
}

// Task 12 — full e2e: create session, drive draft fields via manager (as a
// real runner would via tool calls), then GET draft via HTTP, PATCH via HTTP,
// and push.
func TestStudioE2E_FakeRunnerEmitsToolCalls(t *testing.T) {
	f := spinUpStudioAPI(t)

	resp, _ := http.Post(f.server.URL+"/api/v1/studio/sessions", "application/json",
		bytes.NewBufferString(`{"project_id":"p","runner":"fake"}`))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: status=%d", resp.StatusCode)
	}
	var out struct {
		SessionID string `json:"session_id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)

	// Simulate the agent calling tools by driving the manager directly.
	if err := f.mgr.SetTitle(out.SessionID, "Refactor auth"); err != nil {
		t.Fatalf("set title: %v", err)
	}
	if err := f.mgr.SetDescription(out.SessionID, "auth/middleware.go cleanup"); err != nil {
		t.Fatalf("set desc: %v", err)
	}
	if err := f.mgr.AddAcceptanceCriterion(out.SessionID, "tests pass"); err != nil {
		t.Fatalf("add ac: %v", err)
	}

	// Verify draft via HTTP GET
	resp2, _ := http.Get(f.server.URL + "/api/v1/studio/sessions/" + out.SessionID + "/draft")
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("get draft: status=%d", resp2.StatusCode)
	}
	var snap studio.DraftSnapshot
	_ = json.NewDecoder(resp2.Body).Decode(&snap)
	if snap.Title != "Refactor auth" || len(snap.AcceptanceCriteria) != 1 {
		t.Fatalf("draft snapshot wrong: %+v", snap)
	}

	// Patch via HTTP
	patch, _ := json.Marshal(map[string]string{"description": "updated body"})
	respP, _ := http.Post(f.server.URL+"/api/v1/studio/sessions/"+out.SessionID+"/draft", "application/json", bytes.NewReader(patch))
	if respP.StatusCode != http.StatusNoContent {
		t.Fatalf("patch: status=%d", respP.StatusCode)
	}

	// Push
	respPush, _ := http.Post(f.server.URL+"/api/v1/studio/sessions/"+out.SessionID+"/push", "application/json", nil)
	if respPush.StatusCode != http.StatusOK {
		t.Fatalf("push: status=%d", respPush.StatusCode)
	}

	if len(f.tracker.created) != 1 || f.tracker.created[0].Title != "Refactor auth" {
		t.Fatalf("tracker created wrong: %+v", f.tracker.created)
	}
	if len(f.tracker.updates) != 1 {
		t.Fatalf("tracker updates wrong: %+v", f.tracker.updates)
	}
}

func TestStudioPushFlow(t *testing.T) {
	f := spinUpStudioAPI(t)
	sess, err := f.mgr.StartSession(context.Background(), studio.StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := f.mgr.SetTitle(sess.ID, "T"); err != nil {
		t.Fatalf("title: %v", err)
	}
	if err := f.mgr.SetDescription(sess.ID, "D"); err != nil {
		t.Fatalf("desc: %v", err)
	}

	resp, err := http.Post(f.server.URL+"/api/v1/studio/sessions/"+sess.ID+"/push", "application/json", nil)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
