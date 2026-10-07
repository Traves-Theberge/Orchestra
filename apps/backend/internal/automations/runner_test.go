package automations

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/orchestra/orchestra/apps/backend/internal/worktreejobs"
)

// recordingRunner is a transcript-replay CLI runner.
type recordingRunner struct {
	mu     sync.Mutex
	calls  []agents.TurnRequest
	block  chan struct{}
	output string
	err    error
}

func (r *recordingRunner) RunTurn(ctx context.Context, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	r.mu.Lock()
	r.calls = append(r.calls, req)
	block := r.block
	r.mu.Unlock()
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return agents.TurnResult{}, ctx.Err()
		}
	}
	if r.err != nil {
		return agents.TurnResult{ExitCode: 1}, r.err
	}
	return agents.TurnResult{Output: r.output}, nil
}

type chatFixture struct {
	svc    *Service
	chat   *workspacechat.Service
	db     *db.DB
	pid    string
	repo   string
	runner *recordingRunner
}

func newChatFixture(t *testing.T, registry workspacechat.Registry, runner *recordingRunner) *chatFixture {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "project")
	if err := os.Mkdir(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	if registry == nil {
		reg := agents.NewRegistry(nil)
		reg.SetRunner(agents.ProviderCodex, runner)
		registry = reg
	}
	chat, err := workspacechat.New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(chat.Close)
	svc, err := New(database, Options{Chat: chat, PollInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	return &chatFixture{svc: svc, chat: chat, db: database, pid: pid, repo: repo, runner: runner}
}

func waitRun(t *testing.T, s *Service, id string, active bool) Run {
	t.Helper()
	var r Run
	waitFor(t, "run state", func() bool {
		var err error
		r, err = s.GetRun(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		return IsActive(r.Status) == active && (!active || r.Status == StatusRunning)
	})
	return r
}

func TestRunnerProjectTurnWithTaskPrefix(t *testing.T) {
	runner := &recordingRunner{output: "All checks passed."}
	f := newChatFixture(t, nil, runner)
	ctx := context.Background()
	if _, err := f.db.ExecContext(ctx, `INSERT INTO issues(id,identifier,title,description,state,project_id) VALUES('i1','ORC-9','Flaky tests','CI fails on Windows','Todo',?)`, f.pid); err != nil {
		t.Fatal(err)
	}
	a, err := f.svc.Create(ctx, AutomationInput{Name: "Repo audit", Prompt: "Audit the repository.", Provider: "codex", ProjectID: f.pid, TaskID: "i1", Schedule: Schedule{Kind: "daily", Time: "09:00", Timezone: "UTC"}})
	if err != nil {
		t.Fatal(err)
	}
	run, err := f.svc.RunNow(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	r := waitRun(t, f.svc, run.ID, false)
	if r.Status != StatusSucceeded || r.Output != "All checks passed." || r.ChatProjectID != f.pid || r.ChatSessionID == "" || r.TaskID != "i1" || r.StartedAt == "" || r.WorkspacePath == "" || r.Error != "" {
		t.Fatalf("run: %+v", r)
	}
	d, err := f.chat.Detail(ctx, f.pid, r.ChatSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Session.Title != "Repo audit run 1" || len(d.Messages) != 2 || d.Messages[0].ClientMessageID != run.ID {
		t.Fatalf("conversation: %+v", d)
	}
	text := d.Messages[0].Text
	if !strings.HasPrefix(text, "Linked task ORC-9: Flaky tests\n\nCI fails on Windows\n\n---\n\nAudit the repository.") {
		t.Fatalf("prompt: %q", text)
	}
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.calls) != 1 || runner.calls[0].Timeout != 30*time.Minute {
		t.Fatalf("turn: %+v", runner.calls)
	}
}

func TestRunnerFailureCancelAndUnavailable(t *testing.T) {
	runner := &recordingRunner{err: errors.New("boom")}
	f := newChatFixture(t, nil, runner)
	ctx := context.Background()
	a, err := f.svc.Create(ctx, AutomationInput{Name: "Audit", Prompt: "go", Provider: "codex", ProjectID: f.pid, Schedule: Schedule{Kind: "hourly", Timezone: "UTC"}})
	if err != nil {
		t.Fatal(err)
	}
	run, _ := f.svc.RunNow(ctx, a.ID)
	r := waitRun(t, f.svc, run.ID, false)
	if r.Status != StatusFailed || !strings.Contains(r.Error, "boom") {
		t.Fatalf("failure: %+v", r)
	}
	runner.mu.Lock()
	runner.err = nil
	runner.block = make(chan struct{})
	runner.mu.Unlock()
	run, err = f.svc.RunNow(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitRun(t, f.svc, run.ID, true)
	if _, err = f.svc.CancelRun(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	r = waitRun(t, f.svc, run.ID, false)
	if r.Status != StatusCancelled {
		t.Fatalf("cancel: %+v", r)
	}
	d, _ := f.chat.Detail(ctx, f.pid, r.ChatSessionID)
	if d.Session.Status != "interrupted" {
		t.Fatalf("chat turn not stopped: %+v", d.Session)
	}
	// Unregistered harness.
	other, err := f.svc.Create(ctx, AutomationInput{Name: "Other", Prompt: "go", Provider: "claude", ProjectID: f.pid, Schedule: Schedule{Kind: "hourly", Timezone: "UTC"}})
	if err != nil {
		t.Fatal(err)
	}
	run, _ = f.svc.RunNow(ctx, other.ID)
	if r = waitRun(t, f.svc, run.ID, false); r.Status != StatusSkippedUnavailable {
		t.Fatalf("unavailable harness: %+v", r)
	}
	// Linked project removed.
	if _, err = f.db.ExecContext(ctx, `DELETE FROM projects WHERE id=?`, f.pid); err != nil {
		t.Fatal(err)
	}
	run, _ = f.svc.RunNow(ctx, a.ID)
	if r = waitRun(t, f.svc, run.ID, false); r.Status != StatusSkippedUnavailable || !strings.Contains(r.Error, "project") {
		t.Fatalf("unavailable project: %+v", r)
	}
}

// Native session fake that raises an approval request and a question.
type nativeRegistry struct {
	mu     sync.Mutex
	native *fakeNative
}

func (r *nativeRegistry) HasProvider(agents.Provider) bool { return true }
func (r *nativeRegistry) ValidateTurnOptions(agents.Provider, agents.TurnRequest) error {
	return nil
}
func (r *nativeRegistry) RunTurn(context.Context, agents.Provider, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error) {
	panic("native sessions never replay")
}
func (r *nativeRegistry) SupportsNativeSession(p agents.Provider) bool {
	return p == agents.ProviderCodex
}
func (r *nativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, _ agents.TurnRequest, _ string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.native = &fakeNative{handler: h, answers: map[string]json.RawMessage{}, got: make(chan struct{}, 4)}
	return r.native, nil
}

type fakeNative struct {
	mu      sync.Mutex
	handler agents.NativeEventHandler
	answers map[string]json.RawMessage
	got     chan struct{}
}

func (n *fakeNative) ThreadID() string { return "thread" }
func (n *fakeNative) ModelInfo() agents.NativeModelInfo {
	return agents.NativeModelInfo{Model: "gpt-test"}
}
func (n *fakeNative) SendTurn(ctx context.Context, _, _ string) (agents.NativeTurnResult, error) {
	n.handler(agents.NativeEvent{Type: "server_request", ThreadID: "thread", TurnID: "t", RequestID: "1", Payload: json.RawMessage(`{"method":"item/commandExecution/requestApproval","params":{"command":"rm -rf /"}}`)})
	n.handler(agents.NativeEvent{Type: "server_request", ThreadID: "thread", TurnID: "t", RequestID: "2", Payload: json.RawMessage(`{"method":"item/tool/requestUserInput","params":{"questions":[{"id":"q1"},{"id":"q2"}]}}`)})
	for i := 0; i < 2; i++ {
		select {
		case <-n.got:
		case <-ctx.Done():
			return agents.NativeTurnResult{Status: "interrupted"}, nil
		}
	}
	n.handler(agents.NativeEvent{Type: "thread/tokenUsage/updated", ThreadID: "thread", TurnID: "t", Usage: &agents.NativeUsage{Total: agents.TokenUsage{InputTokens: 100, OutputTokens: 20, TotalTokens: 120}}})
	return agents.NativeTurnResult{TurnID: "t", Status: "completed", Text: "Report: nothing to do.", Model: "gpt-test"}, nil
}
func (n *fakeNative) RespondRequest(_ context.Context, id string, answer json.RawMessage) error {
	n.mu.Lock()
	n.answers[id] = answer
	n.mu.Unlock()
	n.got <- struct{}{}
	return nil
}
func (n *fakeNative) Interrupt(context.Context) error { return nil }
func (n *fakeNative) Close() error                    { return nil }

func TestRunnerAutoDeniesNativeRequestsAndRecordsUsage(t *testing.T) {
	reg := &nativeRegistry{}
	f := newChatFixture(t, reg, nil)
	ctx := context.Background()
	a, err := f.svc.Create(ctx, AutomationInput{Name: "Native", Prompt: "go", Provider: "codex", ProjectID: f.pid, Schedule: Schedule{Kind: "hourly", Timezone: "UTC"}})
	if err != nil {
		t.Fatal(err)
	}
	run, _ := f.svc.RunNow(ctx, a.ID)
	r := waitRun(t, f.svc, run.ID, false)
	if r.Status != StatusSucceeded || r.Output != "Report: nothing to do." || r.Model != "gpt-test" {
		t.Fatalf("run: %+v", r)
	}
	if !strings.Contains(r.Error, "Approval request auto-denied: item/commandExecution/requestApproval") || !strings.Contains(r.Error, "Approval request auto-denied: item/tool/requestUserInput") {
		t.Fatalf("notes: %q", r.Error)
	}
	if r.Usage.InputTokens != 100 || r.Usage.OutputTokens != 20 || r.Usage.TotalTokens != 120 {
		t.Fatalf("usage: %+v", r.Usage)
	}
	reg.mu.Lock()
	n := reg.native
	reg.mu.Unlock()
	n.mu.Lock()
	defer n.mu.Unlock()
	if string(n.answers["1"]) != `{"decision":"decline"}` {
		t.Fatalf("approval answer: %s", n.answers["1"])
	}
	var q struct {
		Answers map[string]struct {
			Answers []string `json:"answers"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(n.answers["2"], &q); err != nil || len(q.Answers) != 2 || len(q.Answers["q2"].Answers) != 1 {
		t.Fatalf("question answer: %s", n.answers["2"])
	}
}

// fakeChat records the scope used when an automation has no project.
type fakeChat struct {
	mu    sync.Mutex
	pids  []string
	sends []workspacechat.SendRequest
}

func (c *fakeChat) CreateWithRequest(_ context.Context, pid string, req workspacechat.CreateRequest) (workspacechat.Session, error) {
	c.mu.Lock()
	c.pids = append(c.pids, pid)
	c.mu.Unlock()
	return workspacechat.Session{ID: "s1", ProjectID: pid, Title: req.Title, Status: "idle"}, nil
}
func (c *fakeChat) Send(_ context.Context, _, _ string, req workspacechat.SendRequest) (workspacechat.Accepted, error) {
	c.mu.Lock()
	c.sends = append(c.sends, req)
	c.mu.Unlock()
	return workspacechat.Accepted{}, nil
}
func (c *fakeChat) Detail(_ context.Context, pid, id string) (workspacechat.Detail, error) {
	return workspacechat.Detail{Session: workspacechat.Session{ID: id, ProjectID: pid, Status: "idle"}, Messages: []workspacechat.Message{{Role: "user", Text: "go"}, {Role: "assistant", Text: strings.Repeat("x", MaxOutputBytes+10)}}}, nil
}
func (c *fakeChat) Stop(context.Context, string, string) (workspacechat.Session, error) {
	return workspacechat.Session{}, nil
}
func (c *fakeChat) Reply(context.Context, string, string, string, workspacechat.ReplyRequest) (workspacechat.RuntimeRequest, error) {
	return workspacechat.RuntimeRequest{}, nil
}

func TestRunnerMaestroScopeAndOutputTruncation(t *testing.T) {
	database, _ := testDB(t)
	chat := &fakeChat{}
	s := testService(t, database, Options{Chat: chat, PollInterval: time.Millisecond})
	ctx := context.Background()
	a, err := s.Create(ctx, AutomationInput{Name: "Maestro digest", Prompt: "summarize", Provider: "claude", Schedule: Schedule{Kind: "daily", Time: "08:00"}})
	if err != nil {
		t.Fatal(err)
	}
	run, _ := s.RunNow(ctx, a.ID)
	r := waitRun(t, s, run.ID, false)
	if r.Status != StatusSucceeded || r.ChatProjectID != workspacechat.OrchestratorScope || !r.OutputTruncated || len(r.Output) != MaxOutputBytes {
		t.Fatalf("maestro: %+v", r.Status)
	}
	chat.mu.Lock()
	defer chat.mu.Unlock()
	if len(chat.pids) != 1 || chat.pids[0] != workspacechat.OrchestratorScope {
		t.Fatal(chat.pids)
	}
}

func TestRunnerNewWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	runner := &recordingRunner{output: "done"}
	f := newChatFixture(t, nil, runner)
	for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.email", "t@t"}, {"config", "user.name", "T"}, {"commit", "--allow-empty", "-m", "init"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = f.repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	jobs, err := worktreejobs.New(f.db, "", []string{filepath.Dir(f.repo)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	f.svc.ConfigureWorktrees(jobs)
	ctx := context.Background()
	a, err := f.svc.Create(ctx, AutomationInput{Name: "Release readiness!", Prompt: "check", Provider: "codex", ProjectID: f.pid, WorkspaceMode: WorkspaceNewWorktree, Schedule: Schedule{Kind: "weekly", Day: 4, Time: "14:00", Timezone: "UTC"}})
	if err != nil {
		t.Fatal(err)
	}
	run, _ := f.svc.RunNow(ctx, a.ID)
	var r Run
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		r, _ = f.svc.GetRun(ctx, run.ID)
		if !IsActive(r.Status) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if r.Status != StatusSucceeded || r.WorkspaceID == "" || !strings.HasPrefix(r.Branch, "auto-release-readiness-") || !strings.Contains(r.WorkspacePath, "auto-release-readiness-") {
		t.Fatalf("worktree run: %+v", r)
	}
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.calls) != 1 || filepath.Clean(runner.calls[0].Workspace) != filepath.Clean(r.WorkspacePath) {
		t.Fatalf("turn cwd: %+v vs %s", runner.calls, r.WorkspacePath)
	}
	if _, err := f.chat.Detail(workspacechat.WithWorkspaceID(ctx, r.WorkspaceID), f.pid, r.ChatSessionID); err != nil {
		t.Fatalf("conversation not reachable in worktree scope: %v", err)
	}
}

func TestDenialAnswerAndSlug(t *testing.T) {
	if _, ok := denialAnswer(workspacechat.RuntimeRequest{Method: "item/unknown"}); ok {
		t.Fatal("unknown method answered")
	}
	if _, ok := denialAnswer(workspacechat.RuntimeRequest{Method: "item/tool/requestUserInput", Params: json.RawMessage(`{}`)}); ok {
		t.Fatal("question without ids answered")
	}
	if got := slug("  Weekday Repo -- Audit!! ", 40); got != "weekday-repo-audit" {
		t.Fatal(got)
	}
	if got := slug("???", 40); got != "automation" {
		t.Fatal(got)
	}
	if got := slug(strings.Repeat("abc ", 30), 40); len(got) > 40 || strings.HasSuffix(got, "-") {
		t.Fatal(got)
	}
}

func TestAutomationAgentIDPassesThroughToChat(t *testing.T) {
	database, _ := testDB(t)
	chat := &fakeChat{}
	s := testService(t, database, Options{Chat: chat, PollInterval: time.Millisecond})
	ctx := context.Background()
	if _, err := s.Create(ctx, AutomationInput{Name: "bad", Prompt: "x", Provider: "claude", AgentID: "reviewer", Schedule: Schedule{Kind: "daily", Time: "08:00"}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("legacy bare agent ids must be rejected: %v", err)
	}
	a, err := s.Create(ctx, AutomationInput{Name: "Review", Prompt: "review", Provider: "claude", AgentID: "orchestra:global:orchestra:rev", Schedule: Schedule{Kind: "daily", Time: "08:00"}})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(ctx, a.ID); got.AgentID != "orchestra:global:orchestra:rev" {
		t.Fatalf("agent_id not persisted: %+v", got)
	}
	run, _ := s.RunNow(ctx, a.ID)
	r := waitRun(t, s, run.ID, false)
	if r.AgentID != "orchestra:global:orchestra:rev" {
		t.Fatalf("run agent: %+v", r)
	}
	chat.mu.Lock()
	if len(chat.sends) != 1 || chat.sends[0].RequestedAgentID != "orchestra:global:orchestra:rev" {
		t.Fatalf("send: %+v", chat.sends)
	}
	chat.mu.Unlock()
	updated, err := s.Update(ctx, a.ID, []byte(`{"agent_id":""}`))
	if err != nil || updated.AgentID != "" {
		t.Fatalf("clearing agent: %+v %v", updated, err)
	}
}
