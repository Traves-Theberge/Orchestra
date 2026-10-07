package automations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// ExecuteFunc performs one run. It reports intermediate states through
// progress and returns the run in a terminal state. Tests inject fakes.
type ExecuteFunc func(ctx context.Context, a Automation, run Run, progress func(Run)) Run

// Options wires dependencies. Zero values select production defaults.
type Options struct {
	Chat           ChatEngine
	Worktrees      WorktreeCreator
	Publish        func(Run)
	ProviderCheck  func(provider string) error
	MaestroRoot    string
	Now            func() time.Time
	TickInterval   time.Duration
	PollInterval   time.Duration
	TurnTimeout    time.Duration
	Precheck       PrecheckFunc
	Execute        ExecuteFunc
	LookupTask     func(ctx context.Context, id string) (TaskInfo, error)
	ResolveBaseRef func(ctx context.Context, root, branch string) string
}

type activeRun struct {
	automationID    string
	cancel          context.CancelFunc
	cancelRequested bool
}

type Service struct {
	store *Store
	db    *db.DB
	opts  Options

	mu        sync.Mutex
	active    map[string]*activeRun
	pending   map[string]bool
	worktrees WorktreeCreator
	closing   bool

	ctx         context.Context
	stop        context.CancelFunc
	runs        sync.WaitGroup
	dispatches  sync.WaitGroup
	loop        sync.WaitGroup
	tickMu      sync.Mutex
	startedLoop bool
}

// New creates tables, marks runs orphaned by a restart as failed and returns
// a service whose scheduler is not yet started (see Start).
func New(database *db.DB, opts Options) (*Service, error) {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.TickInterval <= 0 {
		opts.TickInterval = time.Minute
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = time.Second
	}
	if opts.TurnTimeout <= 0 {
		opts.TurnTimeout = 30 * time.Minute
	}
	if opts.Precheck == nil {
		opts.Precheck = RunPrecheck
	}
	if opts.ResolveBaseRef == nil {
		opts.ResolveBaseRef = defaultBaseRef
	}
	store, err := NewStore(database, opts.Now())
	if err != nil {
		return nil, err
	}
	if opts.LookupTask == nil {
		opts.LookupTask = store.LookupTask
	}
	ctx, stop := context.WithCancel(context.Background())
	s := &Service{store: store, db: database, opts: opts, active: map[string]*activeRun{}, pending: map[string]bool{}, worktrees: opts.Worktrees, ctx: ctx, stop: stop}
	return s, nil
}

// ConfigureWorktrees installs the worktree creator used by new_worktree runs.
func (s *Service) ConfigureWorktrees(w WorktreeCreator) {
	s.mu.Lock()
	s.worktrees = w
	s.mu.Unlock()
}

// Store exposes persistence for tests and diagnostics.
func (s *Service) Store() *Store { return s.store }

func (s *Service) now() time.Time { return s.opts.Now() }

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

var providerName = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,63}$`)
var effortPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)

const maxPromptBytes = 48 * 1024

// normalize validates input and produces the stored fields (without id/timestamps).
func (s *Service) normalize(ctx context.Context, in AutomationInput) (Automation, error) {
	a := Automation{
		Name:            strings.TrimSpace(in.Name),
		Prompt:          in.Prompt,
		Provider:        strings.ToLower(strings.TrimSpace(in.Provider)),
		Model:           strings.TrimSpace(in.Model),
		ReasoningEffort: strings.TrimSpace(in.ReasoningEffort),
		AgentID:         strings.TrimSpace(in.AgentID),
		ProjectID:       strings.TrimSpace(in.ProjectID),
		TaskID:          strings.TrimSpace(in.TaskID),
		WorkspaceMode:   strings.TrimSpace(in.WorkspaceMode),
		BaseBranch:      strings.TrimSpace(in.BaseBranch),
		Schedule:        in.Schedule,
		GraceMinutes:    DefaultGraceMinutes,
		Precheck:        Precheck{TimeoutSeconds: DefaultPrecheckTimeout},
		Enabled:         true,
	}
	if a.Name == "" || utf8.RuneCountInString(a.Name) > 120 || !utf8.ValidString(a.Name) {
		return a, invalid("name is required (max 120 characters)")
	}
	if strings.TrimSpace(a.Prompt) == "" || len(a.Prompt) > maxPromptBytes || !utf8.ValidString(a.Prompt) {
		return a, invalid("prompt is required (max 48 KB)")
	}
	if !providerName.MatchString(a.Provider) {
		return a, invalid("provider is required")
	}
	if s.opts.ProviderCheck != nil {
		if err := s.opts.ProviderCheck(a.Provider); err != nil {
			return a, invalid("provider %q is not available: %v", a.Provider, err)
		}
	}
	if len(a.Model) > 256 || strings.ContainsAny(a.Model, "\x00\r\n") {
		return a, invalid("model is invalid")
	}
	if _, _, _, _, ok := agentcatalog.ParseAgentID(a.AgentID); a.AgentID != "" && !ok {
		return a, invalid("agent_id must be a stable agent id (<source>:<scope>:<harness|orchestra>:<name>)")
	}
	if a.ReasoningEffort != "" && !effortPattern.MatchString(a.ReasoningEffort) {
		return a, invalid("reasoning_effort is invalid")
	}
	if a.WorkspaceMode == "" {
		a.WorkspaceMode = WorkspaceProject
	}
	if a.WorkspaceMode != WorkspaceProject && a.WorkspaceMode != WorkspaceNewWorktree {
		return a, invalid("workspace_mode must be project or new_worktree")
	}
	if len(a.BaseBranch) > 256 || strings.HasPrefix(a.BaseBranch, "-") || strings.ContainsAny(a.BaseBranch, " \t\x00\r\n~^:?*[\\") {
		return a, invalid("base_branch is invalid")
	}
	if a.ProjectID != "" {
		if _, err := s.db.GetProjectByID(ctx, a.ProjectID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return a, invalid("project %q not found", a.ProjectID)
			}
			return a, err
		}
	}
	if a.TaskID != "" {
		task, err := s.opts.LookupTask(ctx, a.TaskID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return a, invalid("task %q not found", a.TaskID)
			}
			return a, err
		}
		a.TaskID = task.ID
	}
	a.Schedule.Kind = strings.TrimSpace(a.Schedule.Kind)
	a.Schedule.Timezone = strings.TrimSpace(a.Schedule.Timezone)
	compiled, err := Compile(a.Schedule)
	if err != nil {
		return a, invalid("schedule: %v", err)
	}
	// Keep only the fields meaningful for the kind.
	switch a.Schedule.Kind {
	case "hourly":
		a.Schedule = Schedule{Kind: "hourly", Minute: a.Schedule.Minute, Timezone: a.Schedule.Timezone}
	case "daily", "weekdays":
		a.Schedule = Schedule{Kind: a.Schedule.Kind, Time: normalizeHHMM(a.Schedule.Time), Timezone: a.Schedule.Timezone}
	case "weekly":
		a.Schedule = Schedule{Kind: "weekly", Time: normalizeHHMM(a.Schedule.Time), Day: a.Schedule.Day, Timezone: a.Schedule.Timezone}
	case "cron":
		a.Schedule = Schedule{Kind: "cron", Cron: compiled.Expr, Timezone: a.Schedule.Timezone}
	}
	if in.GraceMinutes != nil {
		if *in.GraceMinutes < 0 || *in.GraceMinutes > 7*24*60 {
			return a, invalid("grace_minutes must be 0-10080")
		}
		a.GraceMinutes = *in.GraceMinutes
	}
	if in.Precheck != nil {
		a.Precheck.Command = strings.TrimSpace(in.Precheck.Command)
		if len(a.Precheck.Command) > 4096 || strings.ContainsRune(a.Precheck.Command, 0) {
			return a, invalid("precheck command is too long")
		}
		if in.Precheck.TimeoutSeconds != 0 {
			if in.Precheck.TimeoutSeconds < 1 || in.Precheck.TimeoutSeconds > 3600 {
				return a, invalid("precheck timeout_seconds must be 1-3600")
			}
			a.Precheck.TimeoutSeconds = in.Precheck.TimeoutSeconds
		}
	}
	if in.Enabled != nil {
		a.Enabled = *in.Enabled
	}
	return a, nil
}

func (s *Service) nextRunAt(a Automation, now time.Time) string {
	if !a.Enabled {
		return ""
	}
	c, err := Compile(a.Schedule)
	if err != nil {
		return ""
	}
	return stampTime(c.Next(now))
}

func (s *Service) decorate(ctx context.Context, a *Automation) {
	if c, err := Compile(a.Schedule); err == nil {
		a.ScheduleDescription = c.Description()
	}
	if a.ProjectID != "" {
		if p, err := s.db.GetProjectByID(ctx, a.ProjectID); err == nil {
			a.ProjectName = p.Name
		}
	}
	if a.TaskID != "" {
		if t, err := s.opts.LookupTask(ctx, a.TaskID); err == nil {
			a.TaskIdentifier, a.TaskTitle = t.Identifier, t.Title
		}
	}
}

func (s *Service) List(ctx context.Context) ([]Automation, error) {
	list, err := s.store.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range list {
		s.decorate(ctx, &list[i])
	}
	return list, nil
}

func (s *Service) Get(ctx context.Context, id string) (Automation, error) {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return a, err
	}
	s.decorate(ctx, &a)
	return a, nil
}

func (s *Service) Create(ctx context.Context, in AutomationInput) (Automation, error) {
	a, err := s.normalize(ctx, in)
	if err != nil {
		return Automation{}, err
	}
	now := s.now()
	a.ID = uuid.NewString()
	a.CreatedAt, a.UpdatedAt = stampTime(now), stampTime(now)
	a.NextRunAt = s.nextRunAt(a, now)
	if err := s.store.Insert(ctx, a); err != nil {
		return Automation{}, err
	}
	return s.Get(ctx, a.ID)
}

// Update applies a partial JSON body on top of the stored automation.
func (s *Service) Update(ctx context.Context, id string, patch []byte) (Automation, error) {
	existing, err := s.store.Get(ctx, id)
	if err != nil {
		return Automation{}, err
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(patch, &keys); err != nil {
		return Automation{}, invalid("body must be a JSON object")
	}
	in := existing.input()
	if _, ok := keys["schedule"]; ok {
		in.Schedule = Schedule{}
	}
	if _, ok := keys["precheck"]; ok {
		in.Precheck = nil
	}
	if err := json.Unmarshal(patch, &in); err != nil {
		return Automation{}, invalid("invalid field types: %v", err)
	}
	a, err := s.normalize(ctx, in)
	if err != nil {
		return Automation{}, err
	}
	a.ID, a.CreatedAt = existing.ID, existing.CreatedAt
	now := s.now()
	a.UpdatedAt = stampTime(now)
	sameSchedule := a.Schedule == existing.Schedule
	if a.Enabled && existing.Enabled && sameSchedule && existing.NextRunAt != "" {
		a.NextRunAt = existing.NextRunAt
	} else {
		a.NextRunAt = s.nextRunAt(a, now)
	}
	if err := s.store.Update(ctx, a); err != nil {
		return Automation{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) setEnabled(ctx context.Context, id string, enabled bool) (Automation, error) {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return Automation{}, err
	}
	if a.Enabled != enabled || (enabled && a.NextRunAt == "") {
		now := s.now()
		a.Enabled = enabled
		a.UpdatedAt = stampTime(now)
		a.NextRunAt = s.nextRunAt(a, now)
		if err := s.store.Update(ctx, a); err != nil {
			return Automation{}, err
		}
	}
	return s.Get(ctx, id)
}

func (s *Service) Pause(ctx context.Context, id string) (Automation, error) {
	return s.setEnabled(ctx, id, false)
}

func (s *Service) Resume(ctx context.Context, id string) (Automation, error) {
	return s.setEnabled(ctx, id, true)
}

// Delete cancels active runs, then removes the automation and its run
// history. Worktrees created by runs are never removed.
func (s *Service) Delete(ctx context.Context, id string) error {
	if _, err := s.store.Get(ctx, id); err != nil {
		return err
	}
	s.mu.Lock()
	for _, r := range s.active {
		if r.automationID == id {
			r.cancelRequested = true
			r.cancel()
		}
	}
	s.mu.Unlock()
	return s.store.Delete(ctx, id)
}

func (s *Service) Runs(ctx context.Context, automationID string, limit int) ([]Run, error) {
	if _, err := s.store.Get(ctx, automationID); err != nil {
		return nil, err
	}
	return s.store.ListRuns(ctx, automationID, nil, limit)
}

var knownStatuses = map[string]bool{StatusQueued: true, StatusStarting: true, StatusRunning: true, StatusSucceeded: true, StatusFailed: true, StatusCancelled: true, StatusSkippedPrecheck: true, StatusSkippedMissed: true, StatusSkippedBusy: true, StatusSkippedUnavailable: true}

// AllRuns lists runs across automations. status accepts a comma-separated
// list of statuses plus the groups "active" and "skipped".
func (s *Service) AllRuns(ctx context.Context, status string, limit int) ([]Run, error) {
	statuses := []string{}
	for _, part := range strings.Split(status, ",") {
		part = strings.TrimSpace(part)
		switch {
		case part == "":
		case part == "active":
			statuses = append(statuses, StatusQueued, StatusStarting, StatusRunning)
		case part == "skipped":
			statuses = append(statuses, StatusSkippedPrecheck, StatusSkippedMissed, StatusSkippedBusy, StatusSkippedUnavailable)
		case knownStatuses[part]:
			statuses = append(statuses, part)
		default:
			return nil, invalid("unknown status %q", part)
		}
	}
	return s.store.ListRuns(ctx, "", statuses, limit)
}

func (s *Service) GetRun(ctx context.Context, id string) (Run, error) {
	return s.store.GetRun(ctx, id)
}

// CancelRun requests cancellation; the run settles asynchronously.
func (s *Service) CancelRun(ctx context.Context, id string) (Run, error) {
	run, err := s.store.GetRun(ctx, id)
	if err != nil {
		return run, err
	}
	if !IsActive(run.Status) {
		return run, nil
	}
	s.mu.Lock()
	r := s.active[id]
	if r != nil {
		r.cancelRequested = true
		r.cancel()
	}
	s.mu.Unlock()
	if r == nil {
		// Not owned by this process: settle it truthfully.
		now := s.now()
		run.Status, run.FinishedAt, run.UpdatedAt = StatusCancelled, stampTime(now), stampTime(now)
		run.Error = appendNote(run.Error, "Cancelled; the run was not owned by this backend process.")
		if err := s.store.UpdateRun(ctx, run); err != nil {
			return run, err
		}
		s.publish(run)
		return run, nil
	}
	return s.store.GetRun(ctx, id)
}

// RunNow starts a manual run immediately (precheck is skipped).
func (s *Service) RunNow(ctx context.Context, id string) (Run, error) {
	a, err := s.store.Get(ctx, id)
	if err != nil {
		return Run{}, err
	}
	run, started, err := s.start(a, TriggerManual, "")
	if err != nil {
		return Run{}, err
	}
	if !started {
		return Run{}, fmt.Errorf("%w: automation already has an active run", ErrConflict)
	}
	return run, nil
}

// PreviewSchedule validates a schedule and lists its next three runs.
func (s *Service) PreviewSchedule(sch Schedule) SchedulePreview {
	c, err := Compile(sch)
	if err != nil {
		return SchedulePreview{Valid: false, NextRuns: []string{}, Error: err.Error()}
	}
	out := SchedulePreview{Valid: true, Description: c.Description(), NextRuns: []string{}}
	for _, t := range c.NextN(s.now(), 3) {
		out.NextRuns = append(out.NextRuns, t.In(c.Location).Format(time.RFC3339))
	}
	if len(out.NextRuns) == 0 {
		out.Valid = false
		out.Error = "schedule never fires"
	}
	return out
}

func (s *Service) publish(r Run) {
	if s.opts.Publish != nil {
		s.opts.Publish(r)
	}
}

func appendNote(existing, note string) string {
	if existing == "" {
		return note
	}
	return existing + "\n" + note
}

func (s *Service) isClosing() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closing
}

// busyLocked reports whether the automation has an active or dispatching run.
func (s *Service) busyLocked(automationID string) bool {
	if s.pending[automationID] {
		return true
	}
	for _, r := range s.active {
		if r.automationID == automationID {
			return true
		}
	}
	runs, err := s.store.ActiveRuns(context.Background(), automationID)
	return err != nil || len(runs) > 0
}

// start inserts a queued run and launches it unless the automation is busy.
// When reserved is true the caller already holds the pending reservation.
func (s *Service) start(a Automation, trigger, scheduledFor string) (Run, bool, error) {
	return s.startReserved(a, trigger, scheduledFor, false, PrecheckResult{})
}

func (s *Service) startReserved(a Automation, trigger, scheduledFor string, reserved bool, pre PrecheckResult) (Run, bool, error) {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return Run{}, false, ErrUnavailable
	}
	if reserved {
		delete(s.pending, a.ID)
	}
	if s.busyLocked(a.ID) {
		s.mu.Unlock()
		return Run{}, false, nil
	}
	ctx := context.Background()
	n, err := s.store.NextRunNumber(ctx, a.ID)
	if err != nil {
		s.mu.Unlock()
		return Run{}, false, err
	}
	now := stampTime(s.now())
	run := Run{ID: uuid.NewString(), AutomationID: a.ID, AutomationName: a.Name, RunNumber: n, Title: runTitle(a.Name, n), Trigger: trigger, Status: StatusQueued, ScheduledFor: scheduledFor, ProjectID: a.ProjectID, TaskID: a.TaskID, Provider: a.Provider, Model: a.Model, AgentID: a.AgentID, Precheck: pre, OccurrenceCount: 1, CreatedAt: now, UpdatedAt: now}
	if err := s.store.InsertRun(ctx, run); err != nil {
		s.mu.Unlock()
		return Run{}, false, err
	}
	runCtx, cancel := context.WithCancel(s.ctx)
	s.active[run.ID] = &activeRun{automationID: a.ID, cancel: cancel}
	s.runs.Add(1)
	s.mu.Unlock()
	s.publish(run)
	go s.execute(runCtx, cancel, a, run)
	return run, true, nil
}

func (s *Service) progress(r Run) {
	if s.isClosing() {
		return
	}
	r.UpdatedAt = stampTime(s.now())
	if err := s.store.UpdateRun(context.Background(), r); err != nil {
		log.Printf("automations: persist run %s: %v", r.ID, err)
		return
	}
	s.publish(r)
}

func (s *Service) execute(ctx context.Context, cancel context.CancelFunc, a Automation, run Run) {
	defer s.runs.Done()
	defer cancel()
	exec := s.opts.Execute
	if exec == nil {
		exec = s.executeChat
	}
	final := exec(ctx, a, run, s.progress)
	s.mu.Lock()
	entry := s.active[run.ID]
	cancelRequested := entry != nil && entry.cancelRequested
	delete(s.active, run.ID)
	closing := s.closing
	s.mu.Unlock()
	if closing && !cancelRequested && ctx.Err() != nil {
		// Shutdown: leave the row active; the next start marks it failed.
		return
	}
	if IsActive(final.Status) {
		if cancelRequested {
			final.Status = StatusCancelled
		} else {
			final.Status = StatusFailed
			final.Error = appendNote(final.Error, "Run ended without a terminal status.")
		}
	}
	now := stampTime(s.now())
	if final.FinishedAt == "" {
		final.FinishedAt = now
	}
	final.UpdatedAt = now
	bg := context.Background()
	if err := s.store.UpdateRun(bg, final); err != nil {
		log.Printf("automations: finalize run %s: %v", final.ID, err)
	}
	if err := s.store.Prune(bg, a.ID, RunRetention); err != nil {
		log.Printf("automations: prune runs for %s: %v", a.ID, err)
	}
	s.publish(final)
}

func (s *Service) cancelRequested(runID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.active[runID]
	return r != nil && r.cancelRequested
}

// Close stops the scheduler and abandons in-flight runs without recording
// an outcome; chat turns are closed by the chat service itself.
func (s *Service) Close() {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return
	}
	s.closing = true
	s.mu.Unlock()
	s.stop()
	s.loop.Wait()
	s.dispatches.Wait()
	s.runs.Wait()
}
