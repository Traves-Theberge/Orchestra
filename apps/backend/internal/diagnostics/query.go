package diagnostics

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"runtime"
	"strings"
	"time"
)

const detailLimit = 1000
const exportLimit = 5000

func normalizeFilter(f Filter) (Filter, error) {
	if f.Limit == 0 {
		f.Limit = 100
	}
	if f.Limit < 1 || f.Limit > 500 || f.Offset < 0 || f.Offset > 1000000 || len(f.Query) > 128 {
		return f, ErrInvalid
	}
	if len(f.ProjectID) > 128 || len(f.TaskID) > 128 || len(f.Provider) > 96 {
		return f, ErrInvalid
	}
	switch f.Status {
	case "", "running", "ok", "error", "cancelled", "unknown":
	default:
		return f, ErrInvalid
	}
	switch f.Severity {
	case "", "debug", "info", "warn", "error":
	default:
		return f, ErrInvalid
	}
	var since, until time.Time
	var err error
	if f.Since != "" {
		since, err = time.Parse(time.RFC3339Nano, f.Since)
		if err != nil {
			return f, fmt.Errorf("%w: since", ErrInvalid)
		}
	}
	if f.Until != "" {
		until, err = time.Parse(time.RFC3339Nano, f.Until)
		if err != nil {
			return f, fmt.Errorf("%w: until", ErrInvalid)
		}
	}
	if !since.IsZero() && !until.IsZero() && since.After(until) {
		return f, fmt.Errorf("%w: time range", ErrInvalid)
	}
	return f, nil
}
func filters(f Filter, timeColumn string, includeStatus bool) (string, []any) {
	clauses := []string{"1=1"}
	args := []any{}
	for _, v := range []struct{ column, value string }{{"project_id", f.ProjectID}, {"task_id", f.TaskID}, {"provider", f.Provider}} {
		if v.value != "" {
			clauses = append(clauses, v.column+"=?")
			args = append(args, v.value)
		}
	}
	if includeStatus && f.Status != "" {
		clauses = append(clauses, "status=?")
		args = append(args, f.Status)
	}
	if f.Query != "" {
		clauses = append(clauses, `(instr(lower(name),lower(?))>0 OR instr(lower(task_id),lower(?))>0 OR instr(lower(provider),lower(?))>0 OR instr(lower(COALESCE(json_extract(payload,'$.http_method'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(payload,'$.http_route'),'')),lower(?))>0)`)
		args = append(args, f.Query, f.Query, f.Query, f.Query, f.Query)
	}
	if f.Since != "" {
		v, _ := time.Parse(time.RFC3339Nano, f.Since)
		clauses = append(clauses, timeColumn+">=?")
		args = append(args, v.UnixNano())
	}
	if f.Until != "" {
		v, _ := time.Parse(time.RFC3339Nano, f.Until)
		clauses = append(clauses, timeColumn+"<=?")
		args = append(args, v.UnixNano())
	}
	return strings.Join(clauses, " AND "), args
}

const traceCTE = `WITH grouped AS (
 SELECT trace_id,COUNT(*) AS span_count,MIN(start_ns) AS first_ns,MAX(end_ns) AS last_ns,
 CASE WHEN SUM(status='unknown')>0 THEN 'unknown' WHEN SUM(status='running')>0 THEN 'running'
 ELSE COALESCE((SELECT a.status FROM spans a WHERE a.trace_id=spans.trace_id AND a.name IN ('chat.turn','task.run','task.attempt') ORDER BY (a.name IN ('chat.turn','task.run')) DESC,(a.parent_id='') DESC,a.start_ns DESC,a.span_id LIMIT 1),
 (SELECT a.status FROM spans a WHERE a.trace_id=spans.trace_id ORDER BY (a.parent_id='') DESC,a.start_ns,a.span_id LIMIT 1)) END AS outcome FROM spans GROUP BY trace_id
), summaries AS (
 SELECT g.trace_id,g.span_count,g.first_ns,g.last_ns,g.outcome,
 (SELECT r.payload FROM spans r WHERE r.trace_id=g.trace_id ORDER BY (r.parent_id='') DESC,r.start_ns,r.span_id LIMIT 1) AS payload,
 (SELECT r.payload FROM spans r WHERE r.trace_id=g.trace_id AND (r.task_id<>'' OR r.project_id<>'' OR r.provider<>'' OR json_extract(r.payload,'$.session_id')<>'') ORDER BY r.start_ns,r.span_id LIMIT 1) AS identity_payload
 FROM grouped g
) `

func traceWhere(f Filter) (string, []any) {
	where, args := filters(f, "start_ns", false)
	result := `trace_id IN (SELECT trace_id FROM spans WHERE ` + where + `)`
	if f.Status != "" {
		result += " AND outcome=?"
		args = append(args, f.Status)
	}
	return result, args
}
func scanSummary(rows *sql.Rows) (TraceSummary, error) {
	var r TraceSummary
	var payload string
	var identityPayload sql.NullString
	var first int64
	var last sql.NullInt64
	var outcome string
	if err := rows.Scan(&payload, &r.SpanCount, &first, &last, &outcome, &identityPayload); err != nil {
		return r, err
	}
	if err := json.Unmarshal([]byte(payload), &r.SpanRecord); err != nil {
		return r, err
	}
	if identityPayload.Valid {
		var observed SpanRecord
		if err := json.Unmarshal([]byte(identityPayload.String), &observed); err != nil {
			return r, err
		}
		// Empty root fields may be filled only from one actual descendant, never
		// invented or composed from unrelated parallel children.
		r.Fields = merge(observed.Fields, r.Fields)
	}
	r.StartTime = time.Unix(0, first).UTC()
	r.Status = outcome
	if outcome == "unknown" {
		r.EndTime = nil
		r.DurationMS = 0
	} else if outcome == "running" {
		r.EndTime = nil
		r.DurationMS = float64(time.Since(r.StartTime)) / float64(time.Millisecond)
	} else if last.Valid {
		end := time.Unix(0, last.Int64).UTC()
		r.EndTime = &end
		r.DurationMS = float64(last.Int64-first) / float64(time.Millisecond)
	}
	r.Label, r.Description = describe(r.Name, r.HTTPFields)
	return r, nil
}
func (s *Service) ListTraces(ctx context.Context, f Filter) (TracePage, error) {
	f, err := normalizeFilter(f)
	page := TracePage{Items: []TraceSummary{}, Limit: f.Limit, Offset: f.Offset}
	if err != nil {
		return page, err
	}
	if s == nil || s.closed.Load() {
		return page, ErrUnavailable
	}
	where, args := traceWhere(f)
	if err = s.store.db.QueryRowContext(ctx, traceCTE+`SELECT COUNT(*) FROM summaries WHERE `+where, args...).Scan(&page.Total); err != nil {
		return page, err
	}
	params := append(append([]any{}, args...), f.Limit, f.Offset)
	rows, err := s.store.db.QueryContext(ctx, traceCTE+`SELECT payload,span_count,first_ns,last_ns,outcome,identity_payload FROM summaries WHERE `+where+` ORDER BY first_ns DESC,trace_id LIMIT ? OFFSET ?`, params...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		r, err := scanSummary(rows)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, r)
	}
	return page, rows.Err()
}
func (s *Service) Trace(ctx context.Context, id string) (TraceDetail, error) {
	detail := TraceDetail{Spans: []SpanRecord{}, Logs: []LogRecord{}}
	if s == nil || s.closed.Load() {
		return detail, ErrUnavailable
	}
	decoded, err := hex.DecodeString(id)
	if err != nil || len(decoded) != 16 {
		return detail, ErrInvalid
	}
	rows, err := s.store.db.QueryContext(ctx, traceCTE+`SELECT payload,span_count,first_ns,last_ns,outcome,identity_payload FROM summaries WHERE trace_id=?`, id)
	if err != nil {
		return detail, err
	}
	if !rows.Next() {
		err = rows.Err()
		rows.Close()
		if err != nil {
			return detail, err
		}
		return detail, ErrNotFound
	}
	detail.Trace, err = scanSummary(rows)
	rows.Close()
	if err != nil {
		return detail, err
	}
	spans, err := s.store.db.QueryContext(ctx, `SELECT payload FROM spans WHERE trace_id=? ORDER BY start_ns,span_id LIMIT ?`, id, detailLimit+1)
	if err != nil {
		return detail, err
	}
	for spans.Next() {
		var raw string
		if err = spans.Scan(&raw); err != nil {
			break
		}
		var r SpanRecord
		if err = json.Unmarshal([]byte(raw), &r); err != nil {
			break
		}
		if len(detail.Spans) == detailLimit {
			detail.Partial = true
			break
		}
		r.Label, r.Description = describe(r.Name, r.HTTPFields)
		detail.Spans = append(detail.Spans, r)
	}
	if err == nil {
		err = spans.Err()
	}
	spans.Close()
	if err != nil {
		return detail, err
	}
	logs, err := s.store.db.QueryContext(ctx, `SELECT id,payload FROM logs WHERE trace_id=? ORDER BY timestamp_ns,id LIMIT ?`, id, detailLimit+1)
	if err != nil {
		return detail, err
	}
	for logs.Next() {
		r, scanErr := scanLog(logs)
		if scanErr != nil {
			err = scanErr
			break
		}
		if len(detail.Logs) == detailLimit {
			detail.Partial = true
			break
		}
		detail.Logs = append(detail.Logs, r)
	}
	if err == nil {
		err = logs.Err()
	}
	logs.Close()
	if err != nil {
		return detail, err
	}
	ids := make(map[string]bool, len(detail.Spans))
	for _, r := range detail.Spans {
		ids[r.SpanID] = true
		if r.Status == "unknown" {
			detail.Partial = true
		}
	}
	for _, r := range detail.Spans {
		if r.ParentSpanID != "" && !ids[r.ParentSpanID] {
			detail.Partial = true
		}
	}
	return detail, nil
}
func scanLog(rows *sql.Rows) (LogRecord, error) {
	var r LogRecord
	var id int64
	var raw string
	if err := rows.Scan(&id, &raw); err != nil {
		return r, err
	}
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return r, err
	}
	r.ID = id
	r.Label, r.Description = describe(r.Name, r.HTTPFields)
	return r, nil
}
func (s *Service) Logs(ctx context.Context, f Filter) (LogPage, error) {
	f, err := normalizeFilter(f)
	page := LogPage{Items: []LogRecord{}, Limit: f.Limit, Offset: f.Offset}
	if err != nil {
		return page, err
	}
	if s == nil || s.closed.Load() {
		return page, ErrUnavailable
	}
	where, args := filters(f, "timestamp_ns", false)
	if f.Severity != "" {
		where += " AND severity=?"
		args = append(args, f.Severity)
	}
	if f.Status != "" {
		where += ` AND trace_id IN (SELECT trace_id FROM summaries WHERE outcome=?)`
		args = append(args, f.Status)
	}
	if err = s.store.db.QueryRowContext(ctx, traceCTE+`SELECT COUNT(*) FROM logs WHERE `+where, args...).Scan(&page.Total); err != nil {
		return page, err
	}
	rows, err := s.store.db.QueryContext(ctx, traceCTE+`SELECT id,payload FROM logs WHERE `+where+` ORDER BY timestamp_ns DESC,id DESC LIMIT ? OFFSET ?`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		r, err := scanLog(rows)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, r)
	}
	return page, rows.Err()
}
func (s *Service) Overview(ctx context.Context, f Filter) (Overview, error) {
	out := Overview{Points: []Point{}, Operations: []Operation{}, Usage: []Usage{}, Features: []Feature{}}
	f, err := normalizeFilter(f)
	if err != nil {
		return out, err
	}
	if s == nil || s.closed.Load() {
		return out, ErrUnavailable
	}
	where, args := traceWhere(f)
	if err = s.store.db.QueryRowContext(ctx, traceCTE+`SELECT COUNT(*),COALESCE(SUM(outcome='error'),0),COALESCE(SUM(outcome='running'),0) FROM summaries WHERE `+where, args...).Scan(&out.TotalTraces, &out.FailedTraces, &out.ActiveTraces); err != nil {
		return out, err
	}
	out.DroppedRecords = s.dropped.Load()
	out.QueueDepth = len(s.queue)
	out.StorageBytes = s.storageBytes()
	out.Settings, err = s.Settings(ctx)
	if err != nil {
		return out, err
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	out.Runtime = Runtime{Goroutines: runtime.NumGoroutine(), HeapBytes: memory.HeapAlloc}
	out.DetailedScope = f.ProjectID != "" || f.TaskID != "" || f.Query != ""
	source := `SELECT * FROM metrics WHERE 1=1`
	metricArgs := []any{}
	if out.DetailedScope {
		detailWhere, detailArgs := filters(f, "end_ns", true)
		source = `SELECT (end_ns/3600000000000)*3600000000000 AS bucket_ns,name,provider,COALESCE(json_extract(payload,'$.model'),'') AS model,status,1 AS count,(status='error') AS errors,json_extract(payload,'$.duration_ms') AS duration_ms,json_extract(payload,'$.input_tokens') AS input_tokens,json_extract(payload,'$.output_tokens') AS output_tokens,(json_extract(payload,'$.input_tokens') IS NOT NULL AND json_extract(payload,'$.output_tokens') IS NOT NULL) AS known_runs FROM spans WHERE end_ns IS NOT NULL AND ` + detailWhere
		metricArgs = detailArgs
	} else {
		if f.Provider != "" {
			source += " AND provider=?"
			metricArgs = append(metricArgs, f.Provider)
		}
		if f.Status != "" {
			source += " AND status=?"
			metricArgs = append(metricArgs, f.Status)
		}
		if f.Since != "" {
			v, _ := time.Parse(time.RFC3339Nano, f.Since)
			source += " AND bucket_ns>=?"
			metricArgs = append(metricArgs, v.Truncate(time.Hour).UnixNano())
		}
		if f.Until != "" {
			v, _ := time.Parse(time.RFC3339Nano, f.Until)
			source += " AND bucket_ns<=?"
			metricArgs = append(metricArgs, v.Truncate(time.Hour).UnixNano())
		}
	}
	rows, err := s.store.db.QueryContext(ctx, `SELECT (bucket_ns/86400000000000)*86400000000000 AS day,SUM(count),SUM(errors),SUM(duration_ms),SUM(input_tokens),SUM(output_tokens) FROM (`+source+`) GROUP BY day ORDER BY day DESC LIMIT 240`, metricArgs...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var p Point
		var ns int64
		var input, output sql.NullInt64
		if err = rows.Scan(&ns, &p.Operations, &p.Errors, &p.DurationMS, &input, &output); err != nil {
			break
		}
		p.Time = time.Unix(0, ns).UTC()
		if input.Valid {
			v := input.Int64
			p.InputTokens = &v
		}
		if output.Valid {
			v := output.Int64
			p.OutputTokens = &v
		}
		out.Points = append(out.Points, p)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return out, err
	}
	for i, j := 0, len(out.Points)-1; i < j; i, j = i+1, j-1 {
		out.Points[i], out.Points[j] = out.Points[j], out.Points[i]
	}
	rows, err = s.store.db.QueryContext(ctx, `SELECT name,SUM(count),SUM(errors),SUM(duration_ms)/SUM(count) FROM (`+source+`) GROUP BY name ORDER BY SUM(count) DESC,name LIMIT 200`, metricArgs...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var op Operation
		if err = rows.Scan(&op.Name, &op.Count, &op.Errors, &op.AverageDurationMS); err != nil {
			break
		}
		out.Operations = append(out.Operations, op)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = s.store.db.QueryContext(ctx, `SELECT provider,model,COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),SUM(known_runs) FROM (`+source+`) WHERE known_runs>0 GROUP BY provider,model ORDER BY provider,model LIMIT 100`, metricArgs...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var usage Usage
		if err = rows.Scan(&usage.Provider, &usage.Model, &usage.InputTokens, &usage.OutputTokens, &usage.KnownRuns); err != nil {
			break
		}
		out.Usage = append(out.Usage, usage)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return out, err
	}
	if !out.DetailedScope && f.Provider == "" && f.Status == "" {
		featureWhere := "1=1"
		featureArgs := []any{}
		if f.Since != "" {
			v, _ := time.Parse(time.RFC3339Nano, f.Since)
			featureWhere += " AND bucket_ns>=?"
			featureArgs = append(featureArgs, v.Truncate(time.Hour).UnixNano())
		}
		if f.Until != "" {
			v, _ := time.Parse(time.RFC3339Nano, f.Until)
			featureWhere += " AND bucket_ns<=?"
			featureArgs = append(featureArgs, v.Truncate(time.Hour).UnixNano())
		}
		rows, err = s.store.db.QueryContext(ctx, `SELECT name,SUM(count) FROM features WHERE `+featureWhere+` GROUP BY name ORDER BY SUM(count) DESC,name LIMIT 200`, featureArgs...)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var feature Feature
			if err = rows.Scan(&feature.Name, &feature.Count); err != nil {
				break
			}
			out.Features = append(out.Features, feature)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
	}
	return out, err
}
func (s *Service) Export(ctx context.Context, f Filter) (Export, error) {
	out := Export{SchemaVersion: 1, ExportedAt: time.Now().UTC(), Traces: []TraceSummary{}, Spans: []SpanRecord{}, Logs: []LogRecord{}}
	f, err := normalizeFilter(f)
	if err != nil {
		return out, err
	}
	f.Limit = 500
	if s == nil || s.closed.Load() {
		return out, ErrUnavailable
	}
	// A single read fence keeps clear/retention from splitting an export snapshot.
	s.dbMu.Lock()
	defer s.dbMu.Unlock()
	page, err := s.ListTraces(ctx, f)
	if err != nil {
		return out, err
	}
	out.Traces = page.Items
	out.Truncated = page.Total > len(page.Items)+page.Offset
	if len(page.Items) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(page.Items))
	args := make([]any, 0, len(page.Items)+1)
	for i, r := range page.Items {
		placeholders[i] = "?"
		args = append(args, r.TraceID)
	}
	args = append(args, exportLimit+1)
	where := `trace_id IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := s.store.db.QueryContext(ctx, `SELECT payload FROM spans WHERE `+where+` ORDER BY start_ns,span_id LIMIT ?`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		if len(out.Spans) == exportLimit {
			out.Truncated = true
			break
		}
		var raw string
		var span SpanRecord
		if err = rows.Scan(&raw); err != nil {
			break
		}
		if err = json.Unmarshal([]byte(raw), &span); err != nil {
			break
		}
		span.Label, span.Description = describe(span.Name, span.HTTPFields)
		out.Spans = append(out.Spans, span)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = s.store.db.QueryContext(ctx, `SELECT id,payload FROM logs WHERE `+where+` ORDER BY timestamp_ns,id LIMIT ?`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		if len(out.Logs) == exportLimit {
			out.Truncated = true
			break
		}
		record, scanErr := scanLog(rows)
		if scanErr != nil {
			err = scanErr
			break
		}
		out.Logs = append(out.Logs, record)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	return out, err
}
