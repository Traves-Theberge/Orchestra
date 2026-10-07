package automations

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/shellcommand"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}
func (c *fakeClock) Set(t time.Time) {
	c.mu.Lock()
	c.t = t
	c.mu.Unlock()
}

type fakeExec struct {
	mu    sync.Mutex
	runs  []Run
	block chan struct{}
}

func (f *fakeExec) Execute(ctx context.Context, a Automation, run Run, progress func(Run)) Run {
	f.mu.Lock()
	f.runs = append(f.runs, run)
	block := f.block
	f.mu.Unlock()
	run.Status = StatusRunning
	progress(run)
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return run
		}
	}
	run.Status = StatusSucceeded
	run.Output = "done: " + a.Prompt
	return run
}

func (f *fakeExec) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.runs)
}

func testDB(t *testing.T) (*db.DB, string) {
	t.Helper()
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	return database, root
}

func testService(t *testing.T, database *db.DB, opts Options) *Service {
	t.Helper()
	s, err := New(database, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func dailyInput(name string) AutomationInput {
	return AutomationInput{Name: name, Prompt: "audit the repo", Provider: "claude", Schedule: Schedule{Kind: "daily", Time: "09:00", Timezone: "UTC"}}
}

func runsOf(t *testing.T, s *Service, id string) []Run {
	t.Helper()
	runs, err := s.Runs(context.Background(), id, 0)
	if err != nil {
		t.Fatal(err)
	}
	return runs
}

func settled(t *testing.T, s *Service, id string, n int) []Run {
	t.Helper()
	var runs []Run
	waitFor(t, "runs to settle", func() bool {
		runs = runsOf(t, s, id)
		if len(runs) != n {
			return false
		}
		for _, r := range runs {
			if IsActive(r.Status) {
				return false
			}
		}
		return true
	})
	return runs
}

func TestCreateValidatesAndDecorates(t *testing.T) {
	database, root := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	s := testService(t, database, Options{Now: clock.Now, Execute: (&fakeExec{}).Execute})
	ctx := context.Background()
	pid, err := database.UpsertProject(ctx, root, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.ExecContext(ctx, `INSERT INTO issues(id,identifier,title,description,state,project_id) VALUES('issue-1','ORC-7','Fix login','Users cannot log in','Todo',?)`, pid); err != nil {
		t.Fatal(err)
	}
	in := dailyInput("Weekday repo audit")
	in.ProjectID, in.TaskID = pid, "ORC-7"
	a, err := s.Create(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if a.TaskID != "issue-1" || a.TaskIdentifier != "ORC-7" || a.TaskTitle != "Fix login" || a.ProjectName == "" || a.WorkspaceMode != WorkspaceProject || a.GraceMinutes != DefaultGraceMinutes || !a.Enabled || a.Precheck.TimeoutSeconds != 60 {
		t.Fatalf("decorated: %+v", a)
	}
	if a.NextRunAt != "2026-10-07T09:00:00Z" || a.ScheduleDescription != "Daily at 09:00 (UTC)" || a.LastRunAt != "" {
		t.Fatalf("schedule: %+v", a)
	}
	bad := []AutomationInput{
		{Prompt: "x", Provider: "claude", Schedule: in.Schedule},
		{Name: "x", Provider: "claude", Schedule: in.Schedule},
		{Name: "x", Prompt: "x", Schedule: in.Schedule},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: Schedule{Kind: "cron", Cron: "bad"}},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, ProjectID: "missing"},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, TaskID: "missing"},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, WorkspaceMode: "elsewhere"},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, BaseBranch: "-x"},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, GraceMinutes: intp(-1)},
		{Name: "x", Prompt: "x", Provider: "claude", Schedule: in.Schedule, Precheck: &Precheck{Command: "true", TimeoutSeconds: 99999}},
	}
	for i, b := range bad {
		if _, err := s.Create(ctx, b); !errors.Is(err, ErrInvalid) {
			t.Fatalf("bad[%d] accepted: %v", i, err)
		}
	}
	checked := testService(t, database, Options{Now: clock.Now, ProviderCheck: func(p string) error {
		if p != "claude" {
			return errors.New("not registered")
		}
		return nil
	}})
	other := dailyInput("x")
	other.Provider = "Gemini"
	if _, err := checked.Create(ctx, other); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}

func intp(v int) *int { return &v }

func TestUpdatePauseResumeDelete(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	s := testService(t, database, Options{Now: clock.Now, Execute: (&fakeExec{}).Execute})
	ctx := context.Background()
	a, err := s.Create(ctx, dailyInput("Audit"))
	if err != nil {
		t.Fatal(err)
	}
	u, err := s.Update(ctx, a.ID, []byte(`{"name":"Renamed","grace_minutes":0}`))
	if err != nil {
		t.Fatal(err)
	}
	if u.Name != "Renamed" || u.Prompt != a.Prompt || u.GraceMinutes != 0 || u.NextRunAt != a.NextRunAt || u.CreatedAt != a.CreatedAt {
		t.Fatalf("partial patch: %+v", u)
	}
	u, err = s.Update(ctx, a.ID, []byte(`{"schedule":{"kind":"hourly","minute":15,"timezone":"UTC"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if u.NextRunAt != "2026-10-07T08:15:00Z" || u.Schedule.Time != "" {
		t.Fatalf("schedule patch: %+v", u)
	}
	if _, err = s.Update(ctx, a.ID, []byte(`{"schedule":{"kind":"daily","time":"99:00"}}`)); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err = s.Update(ctx, "missing", []byte(`{}`)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	p, err := s.Pause(ctx, a.ID)
	if err != nil || p.Enabled || p.NextRunAt != "" {
		t.Fatalf("pause: %+v %v", p, err)
	}
	clock.Set(time.Date(2026, 10, 7, 9, 20, 0, 0, time.UTC))
	r, err := s.Resume(ctx, a.ID)
	if err != nil || !r.Enabled || r.NextRunAt != "2026-10-07T10:15:00Z" {
		t.Fatalf("resume: %+v %v", r, err)
	}
	if _, err = s.RunNow(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	settled(t, s, a.ID, 1)
	if err = s.Delete(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Get(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if runs, _ := s.AllRuns(ctx, "", 0); len(runs) != 0 {
		t.Fatalf("runs survived delete: %v", runs)
	}
}

func TestSchedulerRunsDueOccurrenceOnce(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	fx := &fakeExec{}
	var mu sync.Mutex
	published := []Run{}
	s := testService(t, database, Options{Now: clock.Now, Execute: fx.Execute, Publish: func(r Run) {
		mu.Lock()
		published = append(published, r)
		mu.Unlock()
	}})
	ctx := context.Background()
	a, err := s.Create(ctx, dailyInput("Audit"))
	if err != nil {
		t.Fatal(err)
	}
	s.Tick(clock.Now())
	if fx.count() != 0 {
		t.Fatal("ran before due")
	}
	clock.Set(time.Date(2026, 10, 7, 9, 0, 40, 0, time.UTC))
	s.Tick(clock.Now())
	s.Tick(clock.Now())
	runs := settled(t, s, a.ID, 1)
	r := runs[0]
	if r.Status != StatusSucceeded || r.Trigger != TriggerScheduled || r.ScheduledFor != "2026-10-07T09:00:00Z" || r.RunNumber != 1 || r.Title != "Audit run 1" || r.AutomationName != "Audit" || r.FinishedAt == "" || r.Output != "done: audit the repo" {
		t.Fatalf("run: %+v", r)
	}
	got, _ := s.Get(ctx, a.ID)
	if got.NextRunAt != "2026-10-08T09:00:00Z" || got.LastRunStatus != StatusSucceeded || got.LastRunAt == "" {
		t.Fatalf("advanced: %+v", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(published) < 3 || published[0].Status != StatusQueued || published[len(published)-1].Status != StatusSucceeded {
		t.Fatalf("published: %+v", published)
	}
}

func TestSchedulerMissedGraceAndFolding(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	fx := &fakeExec{}
	s := testService(t, database, Options{Now: clock.Now, Execute: fx.Execute})
	ctx := context.Background()
	in := dailyInput("Audit")
	in.GraceMinutes = intp(60)
	a, err := s.Create(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	// Backend was down for three days: only the latest occurrence counts.
	clock.Set(time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC))
	s.Tick(clock.Now())
	runs := runsOf(t, s, a.ID)
	if len(runs) != 1 || runs[0].Status != StatusSkippedMissed || runs[0].ScheduledFor != "2026-10-10T09:00:00Z" || runs[0].OccurrenceCount != 1 || fx.count() != 0 {
		t.Fatalf("missed: %+v", runs)
	}
	clock.Set(time.Date(2026, 10, 11, 10, 30, 0, 0, time.UTC))
	s.Tick(clock.Now())
	runs = runsOf(t, s, a.ID)
	if len(runs) != 1 || runs[0].OccurrenceCount != 2 || runs[0].ScheduledFor != "2026-10-11T09:00:00Z" {
		t.Fatalf("fold: %+v", runs)
	}
	// Within grace: runs once, late.
	clock.Set(time.Date(2026, 10, 12, 9, 45, 0, 0, time.UTC))
	s.Tick(clock.Now())
	runs = settled(t, s, a.ID, 2)
	if runs[0].Status != StatusSucceeded || runs[0].RunNumber != 2 {
		t.Fatalf("grace run: %+v", runs)
	}
	// No grace: a tick-late run still runs, a later one is missed.
	if _, err = s.Update(ctx, a.ID, []byte(`{"grace_minutes":0}`)); err != nil {
		t.Fatal(err)
	}
	clock.Set(time.Date(2026, 10, 13, 9, 1, 0, 0, time.UTC))
	s.Tick(clock.Now())
	runs = settled(t, s, a.ID, 3)
	if runs[0].Status != StatusSucceeded {
		t.Fatalf("on-time run with no grace: %+v", runs[0])
	}
	clock.Set(time.Date(2026, 10, 14, 9, 10, 0, 0, time.UTC))
	s.Tick(clock.Now())
	runs = runsOf(t, s, a.ID)
	if runs[0].Status != StatusSkippedMissed || !strings.Contains(runs[0].Error, "no grace") {
		t.Fatalf("no grace missed: %+v", runs[0])
	}
}

func TestSchedulerBusyPrecheckAndManual(t *testing.T) {
	database, root := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	fx := &fakeExec{block: make(chan struct{})}
	var preMu sync.Mutex
	preCalls := []string{}
	exit := 3
	s := testService(t, database, Options{Now: clock.Now, Execute: fx.Execute, MaestroRoot: root, Precheck: func(ctx context.Context, dir, command string, timeout time.Duration) PrecheckResult {
		preMu.Lock()
		defer preMu.Unlock()
		preCalls = append(preCalls, dir+"|"+command+"|"+timeout.String())
		return PrecheckResult{ExitCode: exit, Stdout: "out", Stderr: "err", DurationMS: 5}
	}})
	ctx := context.Background()
	in := AutomationInput{Name: "Hourly", Prompt: "check", Provider: "codex", Schedule: Schedule{Kind: "hourly", Minute: 0, Timezone: "UTC"}, Precheck: &Precheck{Command: "test -f flag", TimeoutSeconds: 5}}
	a, err := s.Create(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	clock.Set(time.Date(2026, 10, 7, 9, 0, 10, 0, time.UTC))
	s.Tick(clock.Now())
	s.dispatches.Wait()
	runs := runsOf(t, s, a.ID)
	if len(runs) != 1 || runs[0].Status != StatusSkippedPrecheck || runs[0].Precheck.ExitCode != 3 || runs[0].Precheck.Stdout != "out" || !strings.Contains(runs[0].Error, "code 3") {
		t.Fatalf("precheck skip: %+v", runs)
	}
	preMu.Lock()
	if len(preCalls) != 1 || preCalls[0] != root+"|test -f flag|5s" {
		t.Fatalf("precheck call: %v", preCalls)
	}
	exit = 0
	preMu.Unlock()
	clock.Set(time.Date(2026, 10, 7, 10, 0, 10, 0, time.UTC))
	s.Tick(clock.Now())
	waitFor(t, "run start", func() bool { return fx.count() == 1 })
	runs = runsOf(t, s, a.ID)
	if runs[0].Precheck.ExitCode != 0 || runs[0].Precheck.Stdout != "out" || !IsActive(runs[0].Status) {
		t.Fatalf("precheck pass recorded: %+v", runs[0])
	}
	// Busy: next occurrence while the run is active.
	clock.Set(time.Date(2026, 10, 7, 11, 0, 10, 0, time.UTC))
	s.Tick(clock.Now())
	clock.Set(time.Date(2026, 10, 7, 12, 0, 10, 0, time.UTC))
	s.Tick(clock.Now())
	runs = runsOf(t, s, a.ID)
	if runs[0].Status != StatusSkippedBusy || runs[0].OccurrenceCount != 2 {
		t.Fatalf("busy fold: %+v", runs)
	}
	if _, err = s.RunNow(ctx, a.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("manual while busy: %v", err)
	}
	close(fx.block)
	settled(t, s, a.ID, 3)
	fx.mu.Lock()
	fx.block = nil
	fx.mu.Unlock()
	manual, err := s.RunNow(ctx, a.ID)
	if err != nil || manual.Trigger != TriggerManual || manual.Status != StatusQueued {
		t.Fatalf("manual: %+v %v", manual, err)
	}
	settled(t, s, a.ID, 4)
	preMu.Lock()
	defer preMu.Unlock()
	if len(preCalls) != 2 {
		t.Fatalf("manual run must skip precheck: %v", preCalls)
	}
}

func TestCancelRunAndRestartRecovery(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	fx := &fakeExec{block: make(chan struct{})}
	s, err := New(database, Options{Now: clock.Now, Execute: fx.Execute})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	a, err := s.Create(ctx, dailyInput("Audit"))
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.RunNow(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running", func() bool { r, _ := s.GetRun(ctx, run.ID); return r.Status == StatusRunning })
	if _, err = s.CancelRun(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "cancelled", func() bool { r, _ := s.GetRun(ctx, run.ID); return r.Status == StatusCancelled })
	if _, err = s.CancelRun(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	// An in-flight run at shutdown stays active, then restart marks it failed.
	second, err := s.RunNow(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running", func() bool { r, _ := s.GetRun(ctx, second.ID); return r.Status == StatusRunning })
	s.Close()
	if r, _ := s.store.GetRun(ctx, second.ID); r.Status != StatusRunning {
		t.Fatalf("shutdown recorded an outcome: %+v", r)
	}
	now := stampTime(clock.Now())
	queued := Run{ID: uuid.NewString(), AutomationID: a.ID, RunNumber: 99, Title: "q", Trigger: TriggerScheduled, Status: StatusQueued, CreatedAt: now, UpdatedAt: now}
	if err = s.store.InsertRun(ctx, queued); err != nil {
		t.Fatal(err)
	}
	s2 := testService(t, database, Options{Now: clock.Now, Execute: (&fakeExec{}).Execute})
	r, _ := s2.GetRun(ctx, second.ID)
	if r.Status != StatusFailed || r.Error != "Backend restarted during run; outcome unknown." || r.FinishedAt == "" {
		t.Fatalf("restart running: %+v", r)
	}
	if r, _ = s2.GetRun(ctx, queued.ID); r.Status != StatusFailed || !strings.Contains(r.Error, "not executed") {
		t.Fatalf("restart queued: %+v", r)
	}
}

func TestRetentionKeepsActiveRuns(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	s := testService(t, database, Options{Now: clock.Now, Execute: (&fakeExec{}).Execute})
	ctx := context.Background()
	a, err := s.Create(ctx, dailyInput("Audit"))
	if err != nil {
		t.Fatal(err)
	}
	now := stampTime(clock.Now())
	active := Run{ID: "active", AutomationID: a.ID, RunNumber: 1, Title: "a", Trigger: TriggerManual, Status: StatusRunning, CreatedAt: now, UpdatedAt: now}
	if err = s.store.InsertRun(ctx, active); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 105; i++ {
		r := Run{ID: uuid.NewString(), AutomationID: a.ID, RunNumber: int64(i + 2), Title: "r", Trigger: TriggerScheduled, Status: StatusSucceeded, CreatedAt: now, UpdatedAt: now}
		if err = s.store.InsertRun(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.store.Prune(ctx, a.ID, RunRetention); err != nil {
		t.Fatal(err)
	}
	runs, _ := s.store.ListRuns(ctx, a.ID, nil, 1000)
	if len(runs) != 101 || runs[0].RunNumber != 106 || runs[99].RunNumber != 7 {
		t.Fatalf("kept %d, newest %d", len(runs), runs[0].RunNumber)
	}
	if r, err := s.GetRun(ctx, "active"); err != nil || r.Status != StatusRunning {
		t.Fatal("active run pruned")
	}
	if list, err := s.AllRuns(ctx, "active", 0); err != nil || len(list) != 1 {
		t.Fatalf("active filter: %v %v", list, err)
	}
	if _, err := s.AllRuns(ctx, "bogus", 0); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}

func TestPreviewSchedule(t *testing.T) {
	database, _ := testDB(t)
	clock := &fakeClock{t: time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)}
	s := testService(t, database, Options{Now: clock.Now})
	p := s.PreviewSchedule(Schedule{Kind: "weekdays", Time: "09:00", Timezone: "America/Edmonton"})
	if !p.Valid || p.Description != "Weekdays at 09:00 (America/Edmonton)" || len(p.NextRuns) != 3 || p.NextRuns[0] != "2026-10-07T09:00:00-06:00" || p.NextRuns[2] != "2026-10-09T09:00:00-06:00" {
		t.Fatalf("%+v", p)
	}
	p = s.PreviewSchedule(Schedule{Kind: "cron", Cron: "61 * * * *"})
	if p.Valid || p.Error == "" || p.NextRuns == nil {
		t.Fatalf("%+v", p)
	}
	p = s.PreviewSchedule(Schedule{Kind: "cron", Cron: "0 0 30 2 *"})
	if p.Valid {
		t.Fatalf("%+v", p)
	}
}

func TestRunPrecheckShell(t *testing.T) {
	if _, err := shellcommand.Resolve(); err != nil {
		t.Skip(err)
	}
	dir := t.TempDir()
	ok := RunPrecheck(context.Background(), dir, "echo hello; echo oops 1>&2", 10*time.Second)
	if ok.ExitCode != 0 || strings.TrimSpace(ok.Stdout) != "hello" || strings.TrimSpace(ok.Stderr) != "oops" {
		t.Fatalf("%+v", ok)
	}
	fail := RunPrecheck(context.Background(), dir, "exit 3", 10*time.Second)
	if fail.ExitCode != 3 {
		t.Fatalf("%+v", fail)
	}
	start := time.Now()
	slow := RunPrecheck(context.Background(), dir, "sleep 20", 500*time.Millisecond)
	if slow.ExitCode != -1 || !strings.Contains(slow.Stderr, "timed out") || time.Since(start) > 10*time.Second {
		t.Fatalf("%+v after %v", slow, time.Since(start))
	}
	big := RunPrecheck(context.Background(), dir, "i=0; while [ $i -lt 3000 ]; do echo 0123456789; i=$((i+1)); done", 20*time.Second)
	if big.ExitCode != 0 || !strings.HasSuffix(big.Stdout, "[output truncated]") || len(big.Stdout) > maxPrecheckOutput+64 {
		t.Fatalf("cap: exit %d len %d", big.ExitCode, len(big.Stdout))
	}
}
