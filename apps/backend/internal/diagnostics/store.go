package diagnostics

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"time"
)

type store struct {
	db   *sql.DB
	path string
}

const schema = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spans (
 span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_id TEXT NOT NULL,
 name TEXT NOT NULL, start_ns INTEGER NOT NULL, end_ns INTEGER,
 status TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
 provider TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id,start_ns,span_id);
CREATE INDEX IF NOT EXISTS spans_time ON spans(start_ns);
CREATE INDEX IF NOT EXISTS spans_task ON spans(task_id,project_id,start_ns);
CREATE TABLE IF NOT EXISTS logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, span_id TEXT NOT NULL,
 timestamp_ns INTEGER NOT NULL, name TEXT NOT NULL, severity TEXT NOT NULL,
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_time ON logs(timestamp_ns,id);
CREATE INDEX IF NOT EXISTS logs_trace ON logs(trace_id,timestamp_ns,id);
CREATE INDEX IF NOT EXISTS logs_task ON logs(task_id,project_id,timestamp_ns);
CREATE TABLE IF NOT EXISTS metrics (
 bucket_ns INTEGER NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
 count INTEGER NOT NULL, errors INTEGER NOT NULL, duration_ms REAL NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, known_runs INTEGER NOT NULL,
 PRIMARY KEY(bucket_ns,name,provider,model,status)
);
CREATE TABLE IF NOT EXISTS features (
 bucket_ns INTEGER NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(bucket_ns,name)
);
PRAGMA user_version=2;
`

func openStore(path string, settings Settings) (*store, Settings, int64, error) {
	if path == "" {
		return nil, settings, 0, fmt.Errorf("%w: empty storage path", ErrInvalid)
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, settings, 0, err
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, settings, 0, err
	}
	db.SetMaxOpenConns(1)
	failed := func(err error) (*store, Settings, int64, error) { _ = db.Close(); return nil, settings, 0, err }
	if _, err = db.Exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;`); err != nil {
		return failed(err)
	}
	var version int
	if err = db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return failed(err)
	}
	if version > 2 {
		return failed(fmt.Errorf("unsupported diagnostics schema %d", version))
	}
	if version == 1 {
		tx, e := db.Begin()
		if e != nil {
			return failed(e)
		}
		if _, e = tx.Exec(`ALTER TABLE metrics RENAME TO metrics_legacy`); e == nil {
			_, e = tx.Exec(schema)
		}
		// Prior aggregates did not retain model identity; preserve that absence.
		if e == nil {
			_, e = tx.Exec(`INSERT INTO metrics SELECT bucket_ns,name,provider,'',status,count,errors,duration_ms,input_tokens,output_tokens,known_runs FROM metrics_legacy; DROP TABLE metrics_legacy;`)
		}
		if e == nil {
			e = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if e != nil {
			return failed(e)
		}
	} else if _, err = db.Exec(schema); err != nil {
		return failed(err)
	}
	data, _ := json.Marshal(settings)
	if _, err = db.Exec(`INSERT OR IGNORE INTO metadata(key,value) VALUES('settings',?)`, string(data)); err != nil {
		return failed(err)
	}
	var raw string
	if err = db.QueryRow(`SELECT value FROM metadata WHERE key='settings'`).Scan(&raw); err != nil {
		return failed(err)
	}
	if err = json.Unmarshal([]byte(raw), &settings); err != nil {
		return failed(err)
	}
	if err = validateSettings(settings); err != nil {
		return failed(err)
	}
	var dropped int64
	_ = db.QueryRow(`SELECT CAST(value AS INTEGER) FROM metadata WHERE key='dropped_records'`).Scan(&dropped)
	// Recovery never invents an end timestamp or successful completion.
	rows, err := db.Query(`SELECT span_id,payload FROM spans WHERE status='running'`)
	if err != nil {
		return failed(err)
	}
	type recovery struct {
		id      string
		payload string
	}
	pending := []recovery{}
	for rows.Next() {
		var id, payload string
		if err = rows.Scan(&id, &payload); err != nil {
			break
		}
		var span SpanRecord
		if err = json.Unmarshal([]byte(payload), &span); err != nil {
			break
		}
		span.Status = "unknown"
		data, _ := json.Marshal(span)
		pending = append(pending, recovery{id, string(data)})
	}
	if closeErr := rows.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return failed(err)
	}
	for _, r := range pending {
		if _, err = db.Exec(`UPDATE spans SET status='unknown',payload=? WHERE span_id=?`, r.payload, r.id); err != nil {
			return failed(err)
		}
	}
	return &store{db: db, path: path}, settings, dropped, nil
}
func (d *store) write(w write) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if w.span != nil {
		r := w.span
		data, err := json.Marshal(r)
		if err != nil {
			return err
		}
		var end any
		if r.EndTime != nil {
			end = r.EndTime.UnixNano()
		}
		query := `INSERT INTO spans(span_id,trace_id,parent_id,name,start_ns,end_ns,status,project_id,task_id,provider,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(span_id) DO NOTHING`
		if w.final {
			query = `INSERT INTO spans(span_id,trace_id,parent_id,name,start_ns,end_ns,status,project_id,task_id,provider,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(span_id) DO UPDATE SET end_ns=excluded.end_ns,status=excluded.status,payload=excluded.payload WHERE spans.status='running'`
		}
		result, err := tx.Exec(query, r.SpanID, r.TraceID, r.ParentSpanID, r.Name, r.StartTime.UnixNano(), end, r.Status, r.ProjectID, r.TaskID, r.Provider, string(data))
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if w.final && changed > 0 {
			errors := 0
			if r.Status == "error" {
				errors = 1
			}
			known := 0
			var input, output any
			if r.InputTokens != nil && r.OutputTokens != nil {
				input = *r.InputTokens
				output = *r.OutputTokens
				known = 1
			}
			_, err = tx.Exec(`INSERT INTO metrics(bucket_ns,name,provider,model,status,count,errors,duration_ms,input_tokens,output_tokens,known_runs) VALUES(?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(bucket_ns,name,provider,model,status) DO UPDATE SET count=count+1,errors=errors+excluded.errors,duration_ms=duration_ms+excluded.duration_ms,input_tokens=CASE WHEN excluded.input_tokens IS NULL THEN input_tokens ELSE COALESCE(input_tokens,0)+excluded.input_tokens END,output_tokens=CASE WHEN excluded.output_tokens IS NULL THEN output_tokens ELSE COALESCE(output_tokens,0)+excluded.output_tokens END,known_runs=known_runs+excluded.known_runs`, r.EndTime.Truncate(time.Hour).UnixNano(), r.Name, r.Provider, r.Model, r.Status, errors, r.DurationMS, input, output, known)
			if err != nil {
				return err
			}
		}
	}
	if w.log != nil {
		r := w.log
		data, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO logs(trace_id,span_id,timestamp_ns,name,severity,project_id,task_id,provider,payload) VALUES(?,?,?,?,?,?,?,?,?)`, r.TraceID, r.SpanID, r.Timestamp.UnixNano(), r.Name, r.Severity, r.ProjectID, r.TaskID, r.Provider, string(data)); err != nil {
			return err
		}
		if len(r.Name) > 8 && r.Name[:8] == "feature." {
			if _, err = tx.Exec(`INSERT INTO features(bucket_ns,name,count) VALUES(?,?,1) ON CONFLICT(bucket_ns,name) DO UPDATE SET count=count+1`, r.Timestamp.Truncate(time.Hour).UnixNano(), r.Name); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
func (s *Service) maintainLocked() error {
	s.settingsMu.RLock()
	settings := s.settings
	s.settingsMu.RUnlock()
	now := time.Now().UTC()
	tx, err := s.store.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	removed := int64(0)
	for _, q := range []struct {
		query  string
		cutoff int64
	}{
		{`DELETE FROM spans WHERE start_ns<?`, now.AddDate(0, 0, -settings.RetentionDays).UnixNano()},
		{`DELETE FROM logs WHERE timestamp_ns<?`, now.AddDate(0, 0, -settings.RetentionDays).UnixNano()},
		{`DELETE FROM metrics WHERE bucket_ns<?`, now.AddDate(0, 0, -settings.MetricsRetentionDays).UnixNano()},
		{`DELETE FROM features WHERE bucket_ns<?`, now.AddDate(0, 0, -settings.MetricsRetentionDays).UnixNano()},
	} {
		res, err := tx.Exec(q.query, q.cutoff)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		removed += n
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if removed > 0 {
		if err = s.compactLocked(); err != nil {
			return err
		}
	}
	// Checkpoint transient WAL bytes before deciding that retained history exceeds
	// the budget; otherwise healthy detail would be evicted for reclaimable pages.
	if _, err = s.store.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return err
	}
	budget := int64(settings.MaxStorageMB) * 1024 * 1024
	// Cleanup detail first; under severe pressure aggregates are evicted next.
	for s.storageBytes() > budget {
		changed := int64(0)
		for _, q := range []string{
			`DELETE FROM spans WHERE span_id IN (SELECT span_id FROM spans ORDER BY start_ns,span_id LIMIT 500)`,
			`DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp_ns,id LIMIT 500)`,
		} {
			res, err := s.store.db.Exec(q)
			if err != nil {
				return err
			}
			n, _ := res.RowsAffected()
			changed += n
		}
		if changed == 0 {
			for _, q := range []string{`DELETE FROM metrics WHERE bucket_ns=(SELECT MIN(bucket_ns) FROM metrics)`, `DELETE FROM features WHERE bucket_ns=(SELECT MIN(bucket_ns) FROM features)`} {
				res, err := s.store.db.Exec(q)
				if err != nil {
					return err
				}
				n, _ := res.RowsAffected()
				changed += n
			}
		}
		if changed == 0 {
			break
		}
		s.dropped.Add(changed)
		if err = s.compactLocked(); err != nil {
			return err
		}
	}
	_, err = s.store.db.Exec(`INSERT INTO metadata(key,value) VALUES('dropped_records',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, fmt.Sprint(s.dropped.Load()))
	return err
}
func (s *Service) compactLocked() error {
	if _, err := s.store.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return err
	}
	_, err := s.store.db.Exec(`VACUUM`)
	if err != nil {
		return err
	}
	_, err = s.store.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}
func (s *Service) storageBytes() int64 {
	if s.store.path == ":memory:" {
		var pages, size int64
		_ = s.store.db.QueryRow(`PRAGMA page_count`).Scan(&pages)
		_ = s.store.db.QueryRow(`PRAGMA page_size`).Scan(&size)
		return pages * size
	}
	var size int64
	for _, path := range []string{s.store.path, s.store.path + "-wal", s.store.path + "-shm"} {
		if info, err := os.Stat(path); err == nil {
			size += info.Size()
		}
	}
	return size
}
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	if s == nil || s.closed.Load() {
		return Settings{}, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return Settings{}, err
	}
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	return s.settings, nil
}
func (s *Service) UpdateSettings(ctx context.Context, settings Settings) error {
	if err := validateSettings(settings); err != nil {
		return err
	}
	if s == nil || s.closed.Load() {
		return ErrUnavailable
	}
	data, _ := json.Marshal(settings)
	s.dbMu.Lock()
	defer s.dbMu.Unlock()
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE metadata SET value=? WHERE key='settings'`, string(data)); err != nil {
		return err
	}
	s.settingsMu.RLock()
	wasEnabled := s.settings.Enabled
	s.settingsMu.RUnlock()
	if wasEnabled && !settings.Enabled {
		if _, err := tx.ExecContext(ctx, `UPDATE spans SET status='unknown',payload=json_set(payload,'$.status','unknown') WHERE status='running'`); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.settingsMu.Lock()
	// Publish the disable fence with its settings so Start cannot pair the
	// previous enabled state with the next generation.
	if wasEnabled && !settings.Enabled {
		s.generation.Add(1)
	}
	s.settings = settings
	s.settingsMu.Unlock()
	return s.maintainLocked()
}
func (s *Service) Clear(ctx context.Context) error {
	if s == nil || s.closed.Load() {
		return ErrUnavailable
	}
	s.dbMu.Lock()
	defer s.dbMu.Unlock()
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"spans", "logs", "metrics", "features"} {
		if _, err = tx.ExecContext(ctx, `DELETE FROM `+table); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM metadata WHERE key='dropped_records'`); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	// Advance only after deletion commits. dbMu keeps the writer behind this
	// fence, including writes queued during the transaction. A failed clear leaves
	// existing operations able to record their observed completion.
	s.generation.Add(1)
	s.dropped.Store(0)
	return s.compactLocked()
}
