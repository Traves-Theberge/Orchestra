package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/rs/zerolog"
)

// gatedRunner answers like the fixture runner, but holds a turn open while gate is set.
type gatedRunner struct {
	gate    chan struct{}
	started chan struct{}
}

func (g *gatedRunner) RunTurn(ctx context.Context, _ agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	if g.gate != nil {
		select {
		case g.started <- struct{}{}:
		default:
		}
		select {
		case <-g.gate:
		case <-ctx.Done():
			return agents.TurnResult{}, ctx.Err()
		}
	}
	return agents.TurnResult{Output: `{"result":"Fixture reply"}`}, nil
}

type rewindHarness struct {
	t      *testing.T
	root   string
	pid    string
	sid    string
	base   string
	router http.Handler
	chat   *workspacechat.Service
	runner *gatedRunner
}

// newRewindHarness serves a real chat service over a temp project folder with
// one conversation. withStore wires a real checkpoint store (needs git).
func newRewindHarness(t *testing.T, withStore bool) *rewindHarness {
	t.Helper()
	root := t.TempDir()
	if withStore {
		if _, err := exec.LookPath("git"); err != nil {
			t.Skip("git not available")
		}
	}
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	runner := &gatedRunner{started: make(chan struct{}, 1)}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, runner)
	chat, err := workspacechat.New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(chat.Close)
	if withStore {
		chat.SetCheckpointStore(checkpoint.NewStore(filepath.Join(t.TempDir(), "checkpoints"), 2*1024*1024))
	}
	cfg := &config.Config{WorkspaceRoot: root, Host: "127.0.0.1", APIToken: "fixture-token", ProjectRoots: []string{root}}
	h := &rewindHarness{t: t, root: root, pid: pid, chat: chat, runner: runner,
		router: NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, database, nil, nil, nil, nil, nil, chat)}
	sess, err := chat.CreateWithRequest(context.Background(), pid, workspacechat.CreateRequest{Provider: "CODEX"})
	if err != nil {
		t.Fatal(err)
	}
	h.sid = sess.ID
	h.base = "/api/v1/projects/" + pid + "/chat/sessions/" + sess.ID
	return h
}

func (h *rewindHarness) call(method, path, body string) (int, []byte) {
	h.t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer fixture-token")
	req.RemoteAddr = "10.9.8.7:1"
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func (h *rewindHarness) detail() workspacechat.Detail {
	h.t.Helper()
	var d workspacechat.Detail
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status, data := h.call("GET", h.base, "")
		if status != 200 {
			h.t.Fatalf("detail %d %s", status, data)
		}
		d = workspacechat.Detail{}
		if err := json.Unmarshal(data, &d); err != nil {
			h.t.Fatal(err)
		}
		if d.Session.Status == "idle" {
			return d
		}
		time.Sleep(5 * time.Millisecond)
	}
	h.t.Fatalf("conversation never went idle: %+v", d.Session)
	return d
}

// send runs one turn and returns the settled detail.
func (h *rewindHarness) send(client, text string) workspacechat.Detail {
	h.t.Helper()
	body, _ := json.Marshal(map[string]string{"client_message_id": client, "text": text})
	if status, data := h.call("POST", h.base+"/messages", string(body)); status != 202 {
		h.t.Fatalf("send %d %s", status, data)
	}
	return h.detail()
}

func errorCode(t *testing.T, data []byte) string {
	t.Helper()
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal(data, &e); err != nil {
		t.Fatalf("not json: %s", data)
	}
	if e.Error.Code != "" {
		return e.Error.Code
	}
	return e.Code
}

var rewindTails = []string{"/rewind/preview", "/edit", "/regenerate", "/branches/b/activate", "/restore/undo"}

func TestRewindRoutesRequireAuth(t *testing.T) {
	h := newRewindHarness(t, false)
	for i, scope := range []string{"/api/v1/projects/" + h.pid, "/api/v1/orchestrator"} {
		for j, tail := range rewindTails {
			req := httptest.NewRequest("POST", scope+"/chat/sessions/"+h.sid+tail, strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.RemoteAddr = "10.1." + strconv.Itoa(i) + "." + strconv.Itoa(j) + ":1"
			rec := httptest.NewRecorder()
			h.router.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s%s without token: %d", scope, tail, rec.Code)
			}
		}
	}
}

func TestEditRoundTrip(t *testing.T) {
	h := newRewindHarness(t, false)
	d := h.send("c1", "first")
	user := d.Messages[0]
	status, data := h.call("POST", h.base+"/edit", `{"message_id":"`+user.ID+`","client_message_id":"c2","text":"second"}`)
	if status != 202 {
		t.Fatalf("edit %d %s", status, data)
	}
	var acc workspacechat.Accepted
	if err := json.Unmarshal(data, &acc); err != nil || acc.Message.Text != "second" || acc.Message.Role != "user" {
		t.Fatalf("accepted %s", data)
	}
	d = h.detail()
	if len(d.Messages) != 2 || d.Messages[0].Text != "second" {
		t.Fatalf("active branch %+v", d.Messages)
	}
	if len(d.Messages[0].Versions) != 2 {
		t.Fatalf("versions %+v", d.Messages[0].Versions)
	}
}

func TestRegenerateRoundTrip(t *testing.T) {
	h := newRewindHarness(t, false)
	d := h.send("c1", "first")
	status, data := h.call("POST", h.base+"/regenerate", `{"message_id":"`+d.Messages[1].ID+`","client_message_id":"c2"}`)
	if status != 202 {
		t.Fatalf("regenerate %d %s", status, data)
	}
	var acc workspacechat.Accepted
	if err := json.Unmarshal(data, &acc); err != nil || acc.Message.Text != "first" {
		t.Fatalf("accepted %s", data)
	}
	d = h.detail()
	if len(d.Messages) != 2 || len(d.Messages[0].Versions) != 2 {
		t.Fatalf("detail %+v", d.Messages)
	}
}

func TestPreviewReturnsChanges(t *testing.T) {
	h := newRewindHarness(t, true)
	d := h.send("c1", "first")
	if err := os.WriteFile(filepath.Join(h.root, "later.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, data := h.call("POST", h.base+"/rewind/preview", `{"message_id":"`+d.Messages[0].ID+`"}`)
	if status != 200 {
		t.Fatalf("preview %d %s", status, data)
	}
	var p workspacechat.RewindPreview
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatal(err)
	}
	if !p.HasCheckpoint || !p.FilesAvailable || len(p.Changes) != 1 || p.Changes[0].Path != "later.txt" || len(p.ChangedSinceTurn) != 1 {
		t.Fatalf("preview %s", data)
	}
	if status, data = h.call("POST", h.base+"/rewind/preview", `{"message_id":"nope"}`); status != 404 {
		t.Fatalf("unknown message %d %s", status, data)
	}
}

func TestActivateBranchRoundTrip(t *testing.T) {
	h := newRewindHarness(t, false)
	d := h.send("c1", "first")
	if status, data := h.call("POST", h.base+"/edit", `{"message_id":"`+d.Messages[0].ID+`","client_message_id":"c2","text":"second"}`); status != 202 {
		t.Fatalf("edit %d %s", status, data)
	}
	d = h.detail()
	var other string
	for _, v := range d.Messages[0].Versions {
		if !v.Active {
			other = v.BranchID
		}
	}
	if other == "" {
		t.Fatalf("no inactive version: %+v", d.Messages[0].Versions)
	}
	status, data := h.call("POST", h.base+"/branches/"+other+"/activate", `{"restore_files":false}`)
	if status != 200 {
		t.Fatalf("activate %d %s", status, data)
	}
	var out workspacechat.Detail
	if err := json.Unmarshal(data, &out); err != nil || len(out.Messages) != 2 || out.Messages[0].Text != "first" {
		t.Fatalf("detail %s", data)
	}
	if status, data = h.call("POST", h.base+"/branches/missing/activate", `{}`); status != 404 {
		t.Fatalf("missing branch %d %s", status, data)
	}
}

func TestUndoRestoreRoundTrip(t *testing.T) {
	h := newRewindHarness(t, true)
	d := h.send("c1", "first")
	later := filepath.Join(h.root, "later.txt")
	if err := os.WriteFile(later, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, data := h.call("POST", h.base+"/edit", `{"message_id":"`+d.Messages[0].ID+`","client_message_id":"c2","text":"second","restore_files":true}`)
	if status != 202 {
		t.Fatalf("edit %d %s", status, data)
	}
	h.detail()
	if _, err := os.Stat(later); !os.IsNotExist(err) {
		t.Fatalf("restore left the file: %v", err)
	}
	status, data = h.call("POST", h.base+"/restore/undo", "")
	if status != 200 {
		t.Fatalf("undo %d %s", status, data)
	}
	var res checkpoint.RestoreResult
	if !strings.Contains(string(data), `"failed":[]`) {
		t.Fatalf("failed must serialize as an empty array: %s", data)
	}
	if err := json.Unmarshal(data, &res); err != nil || res.Written != 1 {
		t.Fatalf("result %s", data)
	}
	if _, err := os.Stat(later); err != nil {
		t.Fatalf("undo did not bring the file back: %v", err)
	}
	if status, data = h.call("POST", h.base+"/restore/undo", ""); status != 409 || errorCode(t, data) != "checkpoint_unavailable" {
		t.Fatalf("second undo %d %s", status, data)
	}
}

func TestRestorePartialMapsTo409(t *testing.T) {
	failed := make([]checkpoint.FileFailure, 8)
	for i := range failed {
		failed[i] = checkpoint.FileFailure{Path: "dir/file" + string(rune('a'+i)) + ".txt", Reason: "locked"}
	}
	rec := httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.RestoreError{Failed: failed})
	if rec.Code != 409 || errorCode(t, rec.Body.Bytes()) != "restore_partial" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	for i, f := range failed {
		if listed := strings.Contains(body, f.Path); listed != (i < 5) {
			t.Errorf("path %s listed=%v", f.Path, listed)
		}
	}
	if !strings.Contains(body, "locked") || !strings.Contains(body, "and 3 more") {
		t.Fatalf("message %s", body)
	}
}

func TestCheckpointUnavailableMapsTo409(t *testing.T) {
	h := newRewindHarness(t, false) // no checkpoint store
	d := h.send("c1", "first")
	status, data := h.call("POST", h.base+"/edit", `{"message_id":"`+d.Messages[0].ID+`","client_message_id":"c2","text":"second","restore_files":true}`)
	if status != 409 || errorCode(t, data) != "checkpoint_unavailable" {
		t.Fatalf("%d %s", status, data)
	}
}

func TestFilesRestoredMapsTo409(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.FilesRestoredError{Err: errors.New("provider exploded")})
	if rec.Code != 409 || errorCode(t, rec.Body.Bytes()) != "files_restored" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if body := rec.Body.String(); !strings.Contains(body, "Undo restore") || !strings.Contains(body, "provider exploded") {
		t.Fatalf("message %s", body)
	}
	// A busy cause inside it is still files_restored, not chat_busy.
	rec = httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.FilesRestoredError{Err: workspacechat.ErrBusy})
	if errorCode(t, rec.Body.Bytes()) != "files_restored" {
		t.Fatalf("%s", rec.Body)
	}
}

func TestBusyMapsTo409(t *testing.T) {
	h := newRewindHarness(t, false)
	d := h.send("c1", "first")
	h.runner.gate = make(chan struct{})
	if status, data := h.call("POST", h.base+"/messages", `{"client_message_id":"c2","text":"slow"}`); status != 202 {
		t.Fatalf("send %d %s", status, data)
	}
	select {
	case <-h.runner.started:
	case <-time.After(5 * time.Second):
		t.Fatal("turn never started")
	}
	defer close(h.runner.gate)
	for path, body := range map[string]string{
		"/edit":         `{"message_id":"` + d.Messages[0].ID + `","client_message_id":"c3","text":"x"}`,
		"/regenerate":   `{"message_id":"` + d.Messages[0].ID + `","client_message_id":"c4"}`,
		"/restore/undo": ``,
	} {
		status, data := h.call("POST", h.base+path, body)
		if status != 409 || errorCode(t, data) != "chat_busy" {
			t.Errorf("%s: %d %s", path, status, data)
		}
	}
}

func TestMaestroRejectsRestoreFiles(t *testing.T) {
	h := newRewindHarness(t, false)
	base := "/api/v1/orchestrator/chat/sessions/" + h.sid
	for path, body := range map[string]string{
		"/edit":       `{"message_id":"m","client_message_id":"c","text":"x","restore_files":true}`,
		"/regenerate": `{"message_id":"m","client_message_id":"c","restore_files":true}`,
	} {
		status, data := h.call("POST", base+path, body)
		if status != 400 || errorCode(t, data) != "invalid_chat_request" {
			t.Errorf("%s: %d %s", path, status, data)
		}
	}
}

func TestInvalidBodiesAreRejected(t *testing.T) {
	h := newRewindHarness(t, false)
	huge := `{"message_id":"m","client_message_id":"c","text":"` + strings.Repeat("a", 200*1024) + `"}`
	cases := []struct{ path, body, code string }{
		{"/edit", `{"message_id":"","client_message_id":"c","text":"x"}`, "invalid_chat_request"},
		{"/regenerate", `{"message_id":" ","client_message_id":"c"}`, "invalid_chat_request"},
		{"/rewind/preview", `{}`, "invalid_chat_request"},
		{"/edit", `{not json`, "invalid_json"},
		{"/edit", `{"message_id":"m","surprise":1}`, "invalid_json"},
		{"/edit", `{"message_id":"m"} {}`, "invalid_json"},
		{"/rewind/preview", `[]`, "invalid_json"},
		{"/branches/b/activate", `{"restore_files":"yes"}`, "invalid_json"},
		{"/edit", huge, "invalid_json"},
	}
	for _, c := range cases {
		status, data := h.call("POST", h.base+c.path, c.body)
		if status != 400 || errorCode(t, data) != c.code {
			t.Errorf("%s %.40q: %d %s", c.path, c.body, status, data)
		}
	}
}

// TestRewindRoutesGetALongerTimeout drives the router's own timeout pieces
// (the global middleware and the rewind route middleware) on probe handlers.
func TestRewindRoutesGetALongerTimeout(t *testing.T) {
	deadlines := map[string]time.Duration{}
	probe := func(w http.ResponseWriter, r *http.Request) {
		if dl, ok := r.Context().Deadline(); ok {
			deadlines[r.URL.Path] = time.Until(dl)
		}
	}
	r := chi.NewRouter()
	r.Use(globalRequestTimeout)
	rewind := r.With(middleware.Timeout(rewindRequestTimeout))
	var rewindURLs []string
	for _, scope := range []string{"/api/v1/projects/p", "/api/v1/orchestrator"} {
		for _, tail := range rewindTails {
			pattern := scope + "/chat/sessions/s" + tail
			rewind.Post(pattern, probe)
			rewindURLs = append(rewindURLs, pattern)
		}
	}
	ordinary := []string{"/api/v1/projects/p/chat/sessions/s/messages", "/api/v1/orchestrator/chat/sessions/s/stop", "/api/v1/projects/p/chat/sessions/s/title"}
	for _, p := range ordinary {
		r.Post(p, probe)
	}
	for _, p := range append(append([]string{}, rewindURLs...), ordinary...) {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", p, nil))
	}
	within := func(got, want time.Duration) bool { return got > want-5*time.Second && got <= want }
	for _, p := range rewindURLs {
		if !within(deadlines[p], 90*time.Second) {
			t.Errorf("%s deadline %v, want ~90s", p, deadlines[p])
		}
	}
	for _, p := range ordinary {
		if !within(deadlines[p], 30*time.Second) {
			t.Errorf("%s deadline %v, want ~30s", p, deadlines[p])
		}
	}
}

// TestRewindPathRuleMatchesTheRoutes pins the global timeout's skip rule to
// exactly the rewind routes.
func TestRewindPathRuleMatchesTheRoutes(t *testing.T) {
	for _, scope := range []string{"/api/v1/projects/abc-1", "/api/v1/orchestrator"} {
		for _, tail := range rewindTails {
			if p := scope + "/chat/sessions/s1" + tail; !rewindPath.MatchString(p) {
				t.Errorf("%s not matched", p)
			}
		}
	}
	for _, p := range []string{
		"/api/v1/projects/abc-1/chat/sessions/s1/messages",
		"/api/v1/projects/abc-1/chat/sessions/s1/edit/x",
		"/api/v1/projects/abc-1/chat/sessions/s1/branches/b1/other",
		"/api/v1/projects/abc-1/issues/s1/edit",
	} {
		if rewindPath.MatchString(p) {
			t.Errorf("%s matched", p)
		}
	}
}

func TestRewindCarveOutUsesTheEscapedPath(t *testing.T) {
	var got time.Duration
	r := chi.NewRouter()
	r.Use(globalRequestTimeout)
	r.With(middleware.Timeout(rewindRequestTimeout)).Post("/api/v1/projects/p/chat/sessions/{session_id}/edit", func(w http.ResponseWriter, r *http.Request) {
		if dl, ok := r.Context().Deadline(); ok {
			got = time.Until(dl)
		}
	})
	req := httptest.NewRequest("POST", "/api/v1/projects/p/chat/sessions/a%2Fb/edit", nil)
	if req.URL.RawPath == "" {
		t.Fatal("expected an escaped path")
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
	if got < 85*time.Second || got > 90*time.Second {
		t.Fatalf("deadline %v, want ~90s", got)
	}
	if !rewindPath.MatchString(req.URL.EscapedPath()) {
		t.Fatal("escaped path not matched")
	}
}

// TestRealRouterRewindRoutesMatchTheCarveOut walks the real router: the paths
// matching the global timeout's skip rule are exactly the ten rewind routes,
// and those routes sit in the extra timeout group. The group's deadline cannot
// be observed through the real handlers, so the group is detected by its
// middleware count as reported by chi.Walk: ordinary chat routes carry the
// global chain plus bearer auth, rewind routes exactly one more (the 90 s
// timeout). TestRewindRoutesGetALongerTimeout checks the timeout values.
func TestRealRouterRewindRoutesMatchTheCarveOut(t *testing.T) {
	h := newRewindHarness(t, false)
	routes, ok := h.router.(chi.Routes)
	if !ok {
		t.Fatalf("router is %T", h.router)
	}
	want := map[string]bool{}
	for _, scope := range []string{"/api/v1/projects/{project_id}", "/api/v1/orchestrator"} {
		for _, tail := range []string{"/rewind/preview", "/edit", "/regenerate", "/branches/{branch_id}/activate", "/restore/undo"} {
			want["POST "+scope+"/chat/sessions/{session_id}"+tail] = true
		}
	}
	chain := map[string]int{}
	skipped := map[string]bool{}
	err := chi.Walk(routes, func(method, route string, handler http.Handler, mws ...func(http.Handler) http.Handler) error {
		key := method + " " + route
		chain[key] = len(mws)
		if rewindPath.MatchString(strings.NewReplacer("{project_id}", "p", "{session_id}", "s", "{branch_id}", "b").Replace(route)) {
			skipped[key] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for key := range want {
		if !skipped[key] {
			t.Errorf("%s is not matched by the carve-out", key)
		}
	}
	for key := range skipped {
		if !want[key] {
			t.Errorf("%s is matched by the carve-out but is not a rewind route", key)
		}
	}
	for key := range want {
		scope := "/api/v1/orchestrator"
		if strings.Contains(key, "{project_id}") {
			scope = "/api/v1/projects/{project_id}"
		}
		sibling := "POST " + scope + "/chat/sessions/{session_id}/messages"
		if chain[sibling] == 0 || chain[key] != chain[sibling]+1 {
			t.Errorf("%s has %d middlewares, want %d (ordinary chat route + the rewind timeout)", key, chain[key], chain[sibling]+1)
		}
	}
}

func TestRestoreMessagesBoundErrorText(t *testing.T) {
	long := strings.Repeat("é", 500)
	rec := httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.RestoreError{Err: errors.New(long), Failed: []checkpoint.FileFailure{{Path: "a.txt", Reason: long}}})
	body := rec.Body.String()
	if strings.Contains(body, strings.Repeat("é", 150)+strings.Repeat("é", 100)) || !strings.Contains(body, "…") || rec.Code != 409 {
		t.Fatalf("restore_partial not bounded: %d %s", rec.Code, body)
	}
	rec = httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.FilesRestoredError{Err: errors.New(long)})
	body = rec.Body.String()
	if len(body) > 700 || !strings.Contains(body, "…") || !utf8.ValidString(body) {
		t.Fatalf("files_restored not bounded: %d bytes %s", len(body), body)
	}
	rec = httptest.NewRecorder()
	(&Server{}).chatError(rec, &workspacechat.FilesRestoredError{})
	if rec.Code != 409 {
		t.Fatalf("nil cause: %d", rec.Code)
	}
}

// nilFailedStore is a checkpoint store whose restores leave Failed nil.
type nilFailedStore struct{}

func (nilFailedStore) Snapshot(context.Context, string) (checkpoint.Tree, error) {
	return checkpoint.Tree{Hash: "tree"}, nil
}
func (nilFailedStore) Diff(context.Context, string, string) ([]checkpoint.Change, error) {
	return nil, nil
}
func (nilFailedStore) Restore(context.Context, string, string) (checkpoint.RestoreResult, error) {
	return checkpoint.RestoreResult{Written: 1}, nil
}

func TestUndoRestoreFailedIsAnEmptyArray(t *testing.T) {
	h := newRewindHarness(t, false)
	h.chat.SetCheckpointStore(nilFailedStore{})
	d := h.send("c1", "first")
	if status, data := h.call("POST", h.base+"/edit", `{"message_id":"`+d.Messages[0].ID+`","client_message_id":"c2","text":"second","restore_files":true}`); status != 202 {
		t.Fatalf("edit %d %s", status, data)
	}
	h.detail()
	status, data := h.call("POST", h.base+"/restore/undo", "")
	if status != 200 || !strings.Contains(string(data), `"failed":[]`) {
		t.Fatalf("undo %d %s", status, data)
	}
}
