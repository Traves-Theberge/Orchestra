package automations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

const schema = `
CREATE TABLE IF NOT EXISTS automations (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	prompt TEXT NOT NULL,
	provider TEXT NOT NULL,
	model TEXT NOT NULL DEFAULT '',
	reasoning_effort TEXT NOT NULL DEFAULT '',
	project_id TEXT NOT NULL DEFAULT '',
	task_id TEXT NOT NULL DEFAULT '',
	workspace_mode TEXT NOT NULL DEFAULT 'project',
	base_branch TEXT NOT NULL DEFAULT '',
	schedule TEXT NOT NULL,
	grace_minutes INTEGER NOT NULL DEFAULT 720,
	precheck_command TEXT NOT NULL DEFAULT '',
	precheck_timeout_seconds INTEGER NOT NULL DEFAULT 60,
	enabled INTEGER NOT NULL DEFAULT 1,
	next_run_at TEXT NOT NULL DEFAULT '',
	run_counter INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	id TEXT UNIQUE NOT NULL,
	automation_id TEXT NOT NULL,
	run_number INTEGER NOT NULL,
	title TEXT NOT NULL,
	trigger TEXT NOT NULL,
	status TEXT NOT NULL,
	scheduled_for TEXT NOT NULL DEFAULT '',
	started_at TEXT NOT NULL DEFAULT '',
	finished_at TEXT NOT NULL DEFAULT '',
	project_id TEXT NOT NULL DEFAULT '',
	workspace_id TEXT NOT NULL DEFAULT '',
	workspace_path TEXT NOT NULL DEFAULT '',
	branch TEXT NOT NULL DEFAULT '',
	chat_project_id TEXT NOT NULL DEFAULT '',
	chat_session_id TEXT NOT NULL DEFAULT '',
	task_id TEXT NOT NULL DEFAULT '',
	provider TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	output TEXT NOT NULL DEFAULT '',
	output_truncated INTEGER NOT NULL DEFAULT 0,
	error TEXT NOT NULL DEFAULT '',
	precheck TEXT NOT NULL DEFAULT '{}',
	usage TEXT NOT NULL DEFAULT '{}',
	occurrence_count INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_runs_by_automation ON automation_runs(automation_id, seq);
CREATE INDEX IF NOT EXISTS automation_runs_by_status ON automation_runs(status);
CREATE INDEX IF NOT EXISTS automation_runs_by_task ON automation_runs(task_id);
`

// Store persists automations and their runs. The warehouse connection pool
// has a single connection, so row iterators are always closed before any
// follow-up query.
type Store struct {
	db *db.DB
}

func stampTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseStamp(v string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return time.Time{}
	}
	return t
}

// NewStore creates tables and recovers runs orphaned by a backend restart.
func NewStore(database *db.DB, now time.Time) (*Store, error) {
	if database == nil {
		return nil, ErrUnavailable
	}
	if _, err := database.Exec(schema); err != nil {
		return nil, err
	}
	for _, table := range []string{"automations", "automation_runs"} {
		if err := addColumnIfMissing(database, table, "agent_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
			return nil, err
		}
	}
	ts := stampTime(now)
	if _, err := database.Exec(`UPDATE automation_runs SET status='failed', error=CASE WHEN error='' THEN ? ELSE error || char(10) || ? END, finished_at=?, updated_at=? WHERE status IN ('starting','running')`, restartRunning, restartRunning, ts, ts); err != nil {
		return nil, err
	}
	if _, err := database.Exec(`UPDATE automation_runs SET status='failed', error=?, finished_at=?, updated_at=? WHERE status='queued'`, restartQueued, ts, ts); err != nil {
		return nil, err
	}
	return &Store{db: database}, nil
}

const restartRunning = "Backend restarted during run; outcome unknown."
const restartQueued = "Backend restarted before the run started; it was not executed."

const automationFields = `id,name,prompt,provider,model,reasoning_effort,agent_id,project_id,task_id,workspace_mode,base_branch,schedule,grace_minutes,precheck_command,precheck_timeout_seconds,enabled,next_run_at,created_at,updated_at`

func scanAutomation(row interface{ Scan(...any) error }) (Automation, error) {
	var a Automation
	var schedule string
	var enabled int
	err := row.Scan(&a.ID, &a.Name, &a.Prompt, &a.Provider, &a.Model, &a.ReasoningEffort, &a.AgentID, &a.ProjectID, &a.TaskID, &a.WorkspaceMode, &a.BaseBranch, &schedule, &a.GraceMinutes, &a.Precheck.Command, &a.Precheck.TimeoutSeconds, &enabled, &a.NextRunAt, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return a, ErrNotFound
	}
	if err != nil {
		return a, err
	}
	a.Enabled = enabled != 0
	_ = json.Unmarshal([]byte(schedule), &a.Schedule)
	return a, nil
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func (s *Store) Insert(ctx context.Context, a Automation) error {
	schedule, _ := json.Marshal(a.Schedule)
	_, err := s.db.ExecContext(ctx, `INSERT INTO automations(`+automationFields+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Name, a.Prompt, a.Provider, a.Model, a.ReasoningEffort, a.AgentID, a.ProjectID, a.TaskID, a.WorkspaceMode, a.BaseBranch, string(schedule), a.GraceMinutes, a.Precheck.Command, a.Precheck.TimeoutSeconds, boolInt(a.Enabled), a.NextRunAt, a.CreatedAt, a.UpdatedAt)
	return err
}

func (s *Store) Update(ctx context.Context, a Automation) error {
	schedule, _ := json.Marshal(a.Schedule)
	res, err := s.db.ExecContext(ctx, `UPDATE automations SET name=?,prompt=?,provider=?,model=?,reasoning_effort=?,agent_id=?,project_id=?,task_id=?,workspace_mode=?,base_branch=?,schedule=?,grace_minutes=?,precheck_command=?,precheck_timeout_seconds=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?`,
		a.Name, a.Prompt, a.Provider, a.Model, a.ReasoningEffort, a.AgentID, a.ProjectID, a.TaskID, a.WorkspaceMode, a.BaseBranch, string(schedule), a.GraceMinutes, a.Precheck.Command, a.Precheck.TimeoutSeconds, boolInt(a.Enabled), a.NextRunAt, a.UpdatedAt, a.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetNextRun advances the scheduling cursor only.
func (s *Store) SetNextRun(ctx context.Context, id, next string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE automations SET next_run_at=? WHERE id=?`, next, id)
	return err
}

func (s *Store) Get(ctx context.Context, id string) (Automation, error) {
	a, err := scanAutomation(s.db.QueryRowContext(ctx, `SELECT `+automationFields+` FROM automations WHERE id=?`, id))
	if err != nil {
		return a, err
	}
	return a, s.decorateLastRun(ctx, &a)
}

func (s *Store) List(ctx context.Context) ([]Automation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+automationFields+` FROM automations ORDER BY name COLLATE NOCASE, created_at`)
	if err != nil {
		return nil, err
	}
	out := []Automation{}
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.decorateLastRun(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) decorateLastRun(ctx context.Context, a *Automation) error {
	var started, finished, created string
	err := s.db.QueryRowContext(ctx, `SELECT status,started_at,finished_at,created_at FROM automation_runs WHERE automation_id=? ORDER BY seq DESC LIMIT 1`, a.ID).Scan(&a.LastRunStatus, &started, &finished, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	switch {
	case started != "":
		a.LastRunAt = started
	case finished != "":
		a.LastRunAt = finished
	default:
		a.LastRunAt = created
	}
	return nil
}

// Delete removes an automation and all of its runs.
func (s *Store) Delete(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM automations WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM automation_runs WHERE automation_id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// NextRunNumber atomically allocates the next run number.
func (s *Store) NextRunNumber(ctx context.Context, automationID string) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE automations SET run_counter=run_counter+1 WHERE id=?`, automationID)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrNotFound
	}
	var n int64
	if err = tx.QueryRowContext(ctx, `SELECT run_counter FROM automations WHERE id=?`, automationID).Scan(&n); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

const runFields = `r.id,r.automation_id,COALESCE(a.name,''),r.run_number,r.title,r.trigger,r.status,r.scheduled_for,r.started_at,r.finished_at,r.project_id,r.workspace_id,r.workspace_path,r.branch,r.chat_project_id,r.chat_session_id,r.task_id,r.provider,r.model,r.agent_id,r.output,r.output_truncated,r.error,r.precheck,r.usage,r.occurrence_count,r.created_at,r.updated_at`
const runFrom = ` FROM automation_runs r LEFT JOIN automations a ON a.id=r.automation_id`

func scanRun(row interface{ Scan(...any) error }) (Run, error) {
	var r Run
	var truncated int
	var precheck, usage string
	err := row.Scan(&r.ID, &r.AutomationID, &r.AutomationName, &r.RunNumber, &r.Title, &r.Trigger, &r.Status, &r.ScheduledFor, &r.StartedAt, &r.FinishedAt, &r.ProjectID, &r.WorkspaceID, &r.WorkspacePath, &r.Branch, &r.ChatProjectID, &r.ChatSessionID, &r.TaskID, &r.Provider, &r.Model, &r.AgentID, &r.Output, &truncated, &r.Error, &precheck, &usage, &r.OccurrenceCount, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	r.OutputTruncated = truncated != 0
	_ = json.Unmarshal([]byte(precheck), &r.Precheck)
	_ = json.Unmarshal([]byte(usage), &r.Usage)
	return r, nil
}

func (s *Store) InsertRun(ctx context.Context, r Run) error {
	precheck, _ := json.Marshal(r.Precheck)
	usage, _ := json.Marshal(r.Usage)
	if r.OccurrenceCount < 1 {
		r.OccurrenceCount = 1
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO automation_runs(id,automation_id,run_number,title,trigger,status,scheduled_for,started_at,finished_at,project_id,workspace_id,workspace_path,branch,chat_project_id,chat_session_id,task_id,provider,model,agent_id,output,output_truncated,error,precheck,usage,occurrence_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.AutomationID, r.RunNumber, r.Title, r.Trigger, r.Status, r.ScheduledFor, r.StartedAt, r.FinishedAt, r.ProjectID, r.WorkspaceID, r.WorkspacePath, r.Branch, r.ChatProjectID, r.ChatSessionID, r.TaskID, r.Provider, r.Model, r.AgentID, r.Output, boolInt(r.OutputTruncated), r.Error, string(precheck), string(usage), r.OccurrenceCount, r.CreatedAt, r.UpdatedAt)
	return err
}

// UpdateRun writes every mutable field. A missing row (automation deleted
// mid-run) is not an error.
func (s *Store) UpdateRun(ctx context.Context, r Run) error {
	precheck, _ := json.Marshal(r.Precheck)
	usage, _ := json.Marshal(r.Usage)
	_, err := s.db.ExecContext(ctx, `UPDATE automation_runs SET status=?,scheduled_for=?,started_at=?,finished_at=?,project_id=?,workspace_id=?,workspace_path=?,branch=?,chat_project_id=?,chat_session_id=?,provider=?,model=?,output=?,output_truncated=?,error=?,precheck=?,usage=?,occurrence_count=?,updated_at=? WHERE id=?`,
		r.Status, r.ScheduledFor, r.StartedAt, r.FinishedAt, r.ProjectID, r.WorkspaceID, r.WorkspacePath, r.Branch, r.ChatProjectID, r.ChatSessionID, r.Provider, r.Model, r.Output, boolInt(r.OutputTruncated), r.Error, string(precheck), string(usage), r.OccurrenceCount, r.UpdatedAt, r.ID)
	return err
}

func (s *Store) GetRun(ctx context.Context, id string) (Run, error) {
	return scanRun(s.db.QueryRowContext(ctx, `SELECT `+runFields+runFrom+` WHERE r.id=?`, id))
}

func (s *Store) queryRuns(ctx context.Context, query string, args ...any) ([]Run, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListRuns returns runs newest first. automationID and statuses are optional filters.
func (s *Store) ListRuns(ctx context.Context, automationID string, statuses []string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	where := []string{"1=1"}
	args := []any{}
	if automationID != "" {
		where = append(where, "r.automation_id=?")
		args = append(args, automationID)
	}
	if len(statuses) > 0 {
		where = append(where, "r.status IN (?"+strings.Repeat(",?", len(statuses)-1)+")")
		for _, st := range statuses {
			args = append(args, st)
		}
	}
	args = append(args, limit)
	return s.queryRuns(ctx, `SELECT `+runFields+runFrom+` WHERE `+strings.Join(where, " AND ")+` ORDER BY r.seq DESC LIMIT ?`, args...)
}

// ActiveRuns returns runs that are queued, starting or running.
func (s *Store) ActiveRuns(ctx context.Context, automationID string) ([]Run, error) {
	return s.ListRuns(ctx, automationID, []string{StatusQueued, StatusStarting, StatusRunning}, 1000)
}

// RecordSkip inserts a terminal skip run, or folds it into the latest run of
// the automation when that run has the same status and reason.
func (s *Store) RecordSkip(ctx context.Context, r Run) (Run, error) {
	latest, err := s.ListRuns(ctx, r.AutomationID, nil, 1)
	if err != nil {
		return Run{}, err
	}
	if len(latest) == 1 && latest[0].Status == r.Status && latest[0].Error == r.Error && latest[0].Trigger == r.Trigger {
		prev := latest[0]
		prev.OccurrenceCount++
		prev.ScheduledFor = r.ScheduledFor
		prev.FinishedAt = r.FinishedAt
		prev.UpdatedAt = r.UpdatedAt
		prev.Precheck = r.Precheck
		if err := s.UpdateRun(ctx, prev); err != nil {
			return Run{}, err
		}
		return prev, nil
	}
	n, err := s.NextRunNumber(ctx, r.AutomationID)
	if err != nil {
		return Run{}, err
	}
	r.RunNumber = n
	r.Title = runTitle(r.AutomationName, n)
	r.OccurrenceCount = 1
	if err := s.InsertRun(ctx, r); err != nil {
		return Run{}, err
	}
	return r, nil
}

// Prune keeps the newest `keep` finished runs per automation; active runs are
// never pruned.
func (s *Store) Prune(ctx context.Context, automationID string, keep int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM automation_runs WHERE automation_id=? AND status NOT IN ('queued','starting','running') AND seq NOT IN (SELECT seq FROM automation_runs WHERE automation_id=? AND status NOT IN ('queued','starting','running') ORDER BY seq DESC LIMIT ?)`, automationID, automationID, keep)
	return err
}

// LookupTask resolves an issue by id or identifier from the warehouse.
func (s *Store) LookupTask(ctx context.Context, id string) (TaskInfo, error) {
	var t TaskInfo
	var title, desc, pid sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id,identifier,title,description,project_id FROM issues WHERE id=? OR identifier=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`, id, id, id).Scan(&t.ID, &t.Identifier, &title, &desc, &pid)
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	t.Title, t.Description, t.ProjectID = title.String, desc.String, pid.String
	return t, err
}

func runTitle(name string, n int64) string {
	return name + " run " + itoa(n)
}

// addColumnIfMissing migrates tables created before a column existed.
func addColumnIfMissing(database *db.DB, table, column, def string) error {
	rows, err := database.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		found = found || name == column
	}
	rows.Close()
	if found {
		return nil
	}
	_, err = database.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + def)
	return err
}
