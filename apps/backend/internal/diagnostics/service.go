package diagnostics

import (
	"context"
	"database/sql"
	"fmt"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"regexp"
	"sync"
	"sync/atomic"
	"time"
)

const defaultQueueSize = 2048

type contextKey struct{}
type identity struct {
	fields     Fields
	service    *Service
	generation uint64
}

// ContextWithParent carries the recorder's correlation and history fence across
// a callback boundary while retaining the invocation's cancellation/deadline.
// Copying only the OTel SpanContext loses the fence and can revive cleared traces.
func ContextWithParent(ctx, parent context.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if parent == nil {
		return ctx
	}
	ctx = trace.ContextWithSpanContext(ctx, trace.SpanContextFromContext(parent))
	if inherited, ok := parent.Value(contextKey{}).(identity); ok {
		ctx = context.WithValue(ctx, contextKey{}, inherited)
	}
	return ctx
}

type write struct {
	generation uint64
	span       *SpanRecord
	log        *LogRecord
	final      bool
	barrier    chan error
	stop       bool
}

// Service owns its tracer provider, queue and dedicated database. It never installs
// global providers/exporters or sends telemetry over the network.
type Service struct {
	store        *store
	provider     *sdktrace.TracerProvider
	tracer       trace.Tracer
	queue        chan write
	uncertain    chan write
	uncertainAll atomic.Uint64
	done         chan struct{}
	submitMu     sync.Mutex
	dbMu         sync.Mutex
	settingsMu   sync.RWMutex
	settings     Settings
	generation   atomic.Uint64
	dropped      atomic.Int64
	closed       atomic.Bool
	broken       atomic.Bool
	closeOnce    sync.Once
	closeErr     error
}
type Span struct {
	service    *Service
	span       trace.Span
	id         string
	traceID    string
	fields     Fields
	generation uint64
	mu         sync.Mutex
	ended      bool
	http       HTTPFields
	started    time.Time
}

func defaultSettings() Settings {
	return Settings{Enabled: true, RetentionDays: 7, MetricsRetentionDays: 30, MaxStorageMB: 250}
}
func validateSettings(v Settings) error {
	if v.RetentionDays < 1 || v.RetentionDays > 365 || v.MetricsRetentionDays < v.RetentionDays || v.MetricsRetentionDays > 3650 || v.MaxStorageMB < 1 || v.MaxStorageMB > 10240 {
		return fmt.Errorf("%w: retention 1..365, metrics retention >= detail and <=3650, storage 1..10240 MiB", ErrInvalid)
	}
	return nil
}
func Open(path string, options Options) (*Service, error) {
	settings := defaultSettings()
	if options.Settings != nil {
		settings = *options.Settings
	}
	if err := validateSettings(settings); err != nil {
		return nil, err
	}
	size := options.QueueSize
	if size == 0 {
		size = defaultQueueSize
	}
	if size < 1 || size > 65536 {
		return nil, fmt.Errorf("%w: queue size", ErrInvalid)
	}
	db, settings, dropped, err := openStore(path, settings)
	if err != nil {
		return nil, err
	}
	s := &Service{store: db, queue: make(chan write, size), uncertain: make(chan write, size), done: make(chan struct{}), settings: settings}
	s.generation.Store(1)
	s.dropped.Store(dropped)
	s.provider = sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.AlwaysSample()), sdktrace.WithSpanProcessor(&processor{service: s}), sdktrace.WithSpanLimits(sdktrace.SpanLimits{AttributeCountLimit: 16, AttributeValueLengthLimit: 128, EventCountLimit: 0, LinkCountLimit: 0, AttributePerEventCountLimit: 1, AttributePerLinkCountLimit: 0}))
	s.tracer = s.provider.Tracer("orchestra.local.diagnostics", trace.WithInstrumentationVersion("1"))
	go s.run()
	return s, nil
}

var opaquePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var labelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$`)
var namePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$`)
var credentialPattern = regexp.MustCompile(`(?i)(authorization|bearer|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|https?:|file:|^sk-|^gh[pousr]_|^github_pat_|^AKIA|^eyJ|^[a-z]:)`)

func safeValue(value string, pattern *regexp.Regexp) string {
	if pattern.MatchString(value) && !credentialPattern.MatchString(value) {
		return value
	}
	return ""
}
func sanitize(f Fields) Fields {
	f.ProjectID = safeValue(f.ProjectID, opaquePattern)
	f.TaskID = safeValue(f.TaskID, opaquePattern)
	f.RunID = safeValue(f.RunID, opaquePattern)
	f.SessionID = safeValue(f.SessionID, opaquePattern)
	f.Provider = safeValue(f.Provider, labelPattern)
	f.Model = safeValue(f.Model, labelPattern)
	if f.Attempt < 0 || f.Attempt > 100000 {
		f.Attempt = 0
	}
	return f
}
func merge(parent, child Fields) Fields {
	if child.ProjectID != "" {
		parent.ProjectID = child.ProjectID
	}
	if child.TaskID != "" {
		parent.TaskID = child.TaskID
	}
	if child.RunID != "" {
		parent.RunID = child.RunID
	}
	if child.SessionID != "" {
		parent.SessionID = child.SessionID
	}
	if child.Provider != "" {
		parent.Provider = child.Provider
	}
	if child.Model != "" {
		parent.Model = child.Model
	}
	if child.Attempt != 0 {
		parent.Attempt = child.Attempt
	}
	return parent
}
func fieldAttributes(f Fields, generation uint64) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.String("orchestra.project_id", f.ProjectID), attribute.String("orchestra.task_id", f.TaskID), attribute.String("orchestra.run_id", f.RunID), attribute.String("orchestra.session_id", f.SessionID), attribute.String("gen_ai.provider.name", f.Provider), attribute.String("gen_ai.request.model", f.Model), attribute.Int("orchestra.attempt", f.Attempt), attribute.Int64("orchestra.generation", int64(generation)), attribute.String("orchestra.status", "running"),
	}
}

// Start is safe on a nil/disabled/closed service. Call sites supply constant
// operation names and opaque IDs; free text and arbitrary attributes are excluded.
func (s *Service) Start(ctx context.Context, name string, fields Fields) (context.Context, *Span) {
	if ctx == nil {
		ctx = context.Background()
	}
	if s == nil || s.closed.Load() || s.broken.Load() {
		return ctx, &Span{}
	}
	s.settingsMu.RLock()
	enabled := s.settings.Enabled
	generation := s.generation.Load()
	s.settingsMu.RUnlock()
	if !enabled {
		return ctx, &Span{}
	}
	if inherited, ok := ctx.Value(contextKey{}).(identity); ok && inherited.service == s {
		fields = merge(inherited.fields, fields)
		generation = inherited.generation
	}
	if generation != s.generation.Load() {
		return ctx, &Span{}
	}
	fields = sanitize(fields)
	if len(name) > 96 || !namePattern.MatchString(name) || credentialPattern.MatchString(name) {
		name = "operation"
	}
	ctx, otelSpan := s.tracer.Start(ctx, name, trace.WithAttributes(fieldAttributes(fields, generation)...))
	sc := otelSpan.SpanContext()
	ctx = context.WithValue(ctx, contextKey{}, identity{fields, s, generation})
	return ctx, &Span{service: s, span: otelSpan, id: sc.SpanID().String(), traceID: sc.TraceID().String(), fields: fields, generation: generation, started: time.Now()}
}
func (s *Span) End(status string) {
	if s == nil || s.service == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return
	}
	s.ended = true
	switch status {
	case "ok", "error", "cancelled", "unknown":
	default:
		status = "unknown"
	}
	s.span.SetAttributes(attribute.String("orchestra.status", status))
	if status == "error" {
		s.span.SetStatus(codes.Error, "")
	} else if status == "ok" {
		s.span.SetStatus(codes.Ok, "")
	}
	s.span.End()
}
func (s *Span) Event(name, severity string) {
	if s == nil || s.service == nil || len(name) > 96 || !namePattern.MatchString(name) || credentialPattern.MatchString(name) {
		return
	}
	switch severity {
	case "debug", "info", "warn", "error":
	default:
		severity = "info"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return
	}
	s.span.AddEvent(name, trace.WithAttributes(attribute.String("severity", severity)))
	s.service.enqueue(write{generation: s.generation, log: &LogRecord{Fields: s.fields, TraceID: s.traceID, SpanID: s.id, Timestamp: time.Now().UTC(), Name: name, Severity: severity, HTTPFields: s.http, DurationMS: s.eventDuration(name)}})
}
func (s *Span) Usage(input, output int64) {
	if s == nil || s.service == nil || input < 0 || output < 0 || input > 1e12 || output > 1e12 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return
	}
	s.span.SetAttributes(attribute.Int64("gen_ai.usage.input_tokens", input), attribute.Int64("gen_ai.usage.output_tokens", output))
}
func (s *Service) enqueue(w write) {
	s.submitMu.Lock()
	defer s.submitMu.Unlock()
	if s.closed.Load() || w.generation != s.generation.Load() {
		return
	}
	if s.broken.Load() {
		s.dropped.Add(1)
		s.markUncertain(w)
		return
	}
	select {
	case s.queue <- w:
	default:
		s.dropped.Add(1)
		s.markUncertain(w)
	}
}

// Completion loss has its own bounded, nonblocking lane. If that lane fills,
// conservatively invalidate active evidence rather than retain invented activity.
func (s *Service) markUncertain(w write) {
	if !w.final || w.span == nil {
		return
	}
	select {
	case s.uncertain <- w:
	default:
		s.uncertainAll.Store(w.generation)
	}
}

// Called only by the store worker with dbMu held; producers never wait on SQLite.
func (s *Service) reconcileLocked() error {
	if len(s.uncertain) == 0 && s.uncertainAll.Load() == 0 {
		return nil
	}
	generation := s.generation.Load()
	all := s.uncertainAll.Swap(0) == generation
	ids := make([]string, 0, len(s.uncertain))
	for i := 0; i < cap(s.uncertain); i++ {
		select {
		case w := <-s.uncertain:
			if w.generation == generation {
				ids = append(ids, w.span.SpanID)
			}
		default:
			i = cap(s.uncertain)
		}
	}
	if !all && len(ids) == 0 {
		return nil
	}
	var pending []string
	tx, err := s.store.db.Begin()
	if err == nil {
		defer tx.Rollback()
		query := `UPDATE spans SET status='unknown',payload=json_set(payload,'$.status','unknown') WHERE status='running'`
		if all {
			_, err = tx.Exec(query)
		} else {
			for _, id := range ids {
				var result sql.Result
				if result, err = tx.Exec(query+` AND span_id=?`, id); err != nil {
					break
				}
				changed, _ := result.RowsAffected()
				if changed == 0 {
					var exists bool
					if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM spans WHERE span_id=?)`, id).Scan(&exists); err != nil {
						break
					}
					if !exists {
						pending = append(pending, id)
					}
				}
			}
		}
		if err == nil {
			err = tx.Commit()
		}
	}
	if err != nil {
		s.uncertainAll.Store(generation)
	} else {
		// A barrier can race a producer whose start is still queued. Keep the
		// missing ID until that start is processed; discarded starts stay bounded.
		for _, id := range pending {
			s.markUncertain(write{generation: generation, span: &SpanRecord{SpanID: id}, final: true})
		}
		if all && len(s.queue) > 0 {
			s.uncertainAll.Store(generation)
		}
	}
	return err
}
func (s *Service) run() {
	defer close(s.done)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	processed := 0
	for {
		select {
		case w := <-s.queue:
			s.dbMu.Lock()
			var err error
			if w.barrier != nil {
				err = s.reconcileLocked()
				if err == nil {
					err = s.maintainLocked()
				}
				s.broken.Store(err != nil)
			} else if w.generation == s.generation.Load() {
				if s.broken.Load() {
					s.dropped.Add(1)
					s.markUncertain(w)
				} else {
					err = s.store.write(w)
				}
				processed++
				if err == nil && processed%128 == 0 {
					err = s.maintainLocked()
				}
			}
			if err != nil {
				s.dropped.Add(1)
				s.markUncertain(w)
				s.broken.Store(true)
			}
			if err == nil && len(s.queue) == 0 {
				err = s.reconcileLocked()
				if err != nil {
					s.dropped.Add(1)
					s.broken.Store(true)
				}
			}
			s.dbMu.Unlock()
			if w.barrier != nil {
				w.barrier <- err
			}
			if w.stop {
				return
			}
		case <-ticker.C:
			s.dbMu.Lock()
			err := s.reconcileLocked()
			if err == nil {
				err = s.maintainLocked()
			}
			s.broken.Store(err != nil)
			if err != nil {
				s.dropped.Add(1)
			}
			s.dbMu.Unlock()
		}
	}
}
func (s *Service) Flush(ctx context.Context) error {
	if s == nil || s.closed.Load() {
		return ErrUnavailable
	}
	barrier := make(chan error, 1)
	select {
	case s.queue <- write{barrier: barrier}:
	case <-s.done:
		return ErrUnavailable
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-barrier:
		return err
	case <-s.done:
		return ErrUnavailable
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		s.submitMu.Lock()
		s.closed.Store(true)
		s.submitMu.Unlock()
		_ = s.provider.Shutdown(context.Background())
		barrier := make(chan error, 1)
		s.queue <- write{barrier: barrier, stop: true}
		s.closeErr = <-barrier
		<-s.done
		if err := s.store.db.Close(); s.closeErr == nil {
			s.closeErr = err
		}
	})
	return s.closeErr
}

type processor struct{ service *Service }

func (p *processor) OnStart(_ context.Context, span sdktrace.ReadWriteSpan) {
	r, generation := snapshot(span)
	p.service.enqueue(write{generation: generation, span: &r})
}
func (p *processor) OnEnd(span sdktrace.ReadOnlySpan) {
	r, generation := snapshot(span)
	p.service.enqueue(write{generation: generation, span: &r, final: true})
}
func (p *processor) Shutdown(context.Context) error       { return nil }
func (p *processor) ForceFlush(ctx context.Context) error { return p.service.Flush(ctx) }
func snapshot(span sdktrace.ReadOnlySpan) (SpanRecord, uint64) {
	r := SpanRecord{TraceID: span.SpanContext().TraceID().String(), SpanID: span.SpanContext().SpanID().String(), Name: span.Name(), StartTime: span.StartTime().UTC(), Status: "running"}
	if span.Parent().IsValid() {
		r.ParentSpanID = span.Parent().SpanID().String()
	}
	var generation uint64
	for _, a := range span.Attributes() {
		switch string(a.Key) {
		case "orchestra.project_id":
			r.ProjectID = a.Value.AsString()
		case "orchestra.task_id":
			r.TaskID = a.Value.AsString()
		case "orchestra.run_id":
			r.RunID = a.Value.AsString()
		case "orchestra.session_id":
			r.SessionID = a.Value.AsString()
		case "gen_ai.provider.name":
			r.Provider = a.Value.AsString()
		case "gen_ai.request.model":
			r.Model = a.Value.AsString()
		case "orchestra.attempt":
			r.Attempt = int(a.Value.AsInt64())
		case "orchestra.generation":
			generation = uint64(a.Value.AsInt64())
		case "orchestra.status":
			r.Status = a.Value.AsString()
		case "http.request.method":
			r.HTTPMethod = a.Value.AsString()
		case "http.route":
			r.HTTPRoute = a.Value.AsString()
		case "http.response.status_code":
			r.HTTPStatusCode = int(a.Value.AsInt64())
		case "gen_ai.usage.input_tokens":
			v := a.Value.AsInt64()
			r.InputTokens = &v
		case "gen_ai.usage.output_tokens":
			v := a.Value.AsInt64()
			r.OutputTokens = &v
		}
	}
	if !span.EndTime().IsZero() {
		end := span.EndTime().UTC()
		r.EndTime = &end
		r.DurationMS = float64(span.EndTime().Sub(span.StartTime())) / float64(time.Millisecond)
	}
	return r, generation
}
