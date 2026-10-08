package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
	"go.opentelemetry.io/otel/propagation"
)

func (s *Server) diagnosticsReady(w http.ResponseWriter) bool {
	if s.diagnostics == nil {
		writeJSONError(w, 503, "diagnostics_unavailable", "Local diagnostics are unavailable")
		return false
	}
	return true
}
func diagnosticsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, diagnostics.ErrNotFound):
		writeJSONError(w, 404, "trace_not_found", "Diagnostic trace not found")
	case errors.Is(err, diagnostics.ErrInvalid):
		writeJSONError(w, 400, "invalid_diagnostics", "Invalid diagnostics query or settings")
	case errors.Is(err, diagnostics.ErrUnavailable):
		writeJSONError(w, 503, "diagnostics_unavailable", "Local diagnostics are unavailable")
	default:
		writeJSONError(w, 500, "diagnostics_failed", "Local diagnostics operation failed")
	}
}
func diagnosticsFilter(r *http.Request) (diagnostics.Filter, error) {
	f := diagnostics.Filter{Limit: 100}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return f, diagnostics.ErrInvalid
	}
	for key, values := range q {
		if len(values) != 1 || len(values[0]) > 200 {
			return f, diagnostics.ErrInvalid
		}
		v := values[0]
		switch key {
		case "project_id":
			f.ProjectID = v
		case "task_id":
			f.TaskID = v
		case "provider":
			f.Provider = v
		case "q":
			f.Query = v
		case "status":
			f.Status = v
		case "severity":
			f.Severity = v
		case "since":
			f.Since = v
		case "until":
			f.Until = v
		case "limit":
			f.Limit, err = strconv.Atoi(v)
			if err != nil || f.Limit < 1 || f.Limit > 500 {
				return f, diagnostics.ErrInvalid
			}
		case "offset":
			f.Offset, err = strconv.Atoi(v)
			if err != nil || f.Offset < 0 || f.Offset > 1000000 {
				return f, diagnostics.ErrInvalid
			}
		default:
			return f, diagnostics.ErrInvalid
		}
	}
	switch f.Status {
	case "", "running", "ok", "error", "cancelled", "unknown":
	default:
		return f, diagnostics.ErrInvalid
	}
	var since, until time.Time
	switch f.Severity {
	case "", "debug", "info", "warn", "error":
	default:
		return f, diagnostics.ErrInvalid
	}
	if f.Since != "" {
		since, err = time.Parse(time.RFC3339Nano, f.Since)
		if err != nil {
			return f, diagnostics.ErrInvalid
		}
	}
	if f.Until != "" {
		until, err = time.Parse(time.RFC3339Nano, f.Until)
		if err != nil {
			return f, diagnostics.ErrInvalid
		}
	}
	if !since.IsZero() && !until.IsZero() && since.After(until) {
		return f, diagnostics.ErrInvalid
	}
	return f, nil
}
func (s *Server) diagnosticsRead(w http.ResponseWriter, r *http.Request, kind string) {
	if !s.diagnosticsReady(w) {
		return
	}
	f, err := diagnosticsFilter(r)
	if err != nil {
		diagnosticsError(w, err)
		return
	}
	var result any
	switch kind {
	case "traces":
		result, err = s.diagnostics.ListTraces(r.Context(), f)
	case "logs":
		result, err = s.diagnostics.Logs(r.Context(), f)
	case "overview":
		result, err = s.diagnostics.Overview(r.Context(), f)
	case "export":
		result, err = s.diagnostics.Export(r.Context(), f)
	}
	if err != nil {
		diagnosticsError(w, err)
		return
	}
	if kind == "export" {
		w.Header().Set("Content-Disposition", `attachment; filename="orchestra-diagnostics.json"`)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
func (s *Server) diagnosticsTrace(w http.ResponseWriter, r *http.Request) {
	if !s.diagnosticsReady(w) {
		return
	}
	id := chi.URLParam(r, "trace_id")
	if len(id) != 32 {
		diagnosticsError(w, diagnostics.ErrInvalid)
		return
	}
	for _, c := range id {
		if !strings.ContainsRune("0123456789abcdef", c) {
			diagnosticsError(w, diagnostics.ErrInvalid)
			return
		}
	}
	detail, err := s.diagnostics.Trace(r.Context(), id)
	if err != nil {
		diagnosticsError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(detail)
}
func (s *Server) diagnosticsSettings(w http.ResponseWriter, r *http.Request) {
	if !s.diagnosticsReady(w) {
		return
	}
	if r.Method == http.MethodPut {
		var settings diagnostics.Settings
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&settings) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			diagnosticsError(w, diagnostics.ErrInvalid)
			return
		}
		if err := s.diagnostics.UpdateSettings(r.Context(), settings); err != nil {
			diagnosticsError(w, err)
			return
		}
	}
	settings, err := s.diagnostics.Settings(r.Context())
	if err != nil {
		diagnosticsError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(settings)
}
func (s *Server) diagnosticsClear(w http.ResponseWriter, r *http.Request) {
	if !s.diagnosticsReady(w) {
		return
	}
	if err := s.diagnostics.Clear(r.Context()); err != nil {
		diagnosticsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) diagnosticsHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/diagnostics/") {
			next.ServeHTTP(w, r)
			return
		}
		parent := propagation.TraceContext{}.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		ctx, span := s.diagnostics.Start(parent, "http.request", diagnostics.Fields{})
		status := "unknown"
		defer func() { span.End(status) }()
		response := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(response, r.WithContext(ctx))
		code := response.Status()
		if code == 0 {
			code = http.StatusOK
		}
		route := ""
		if routing := chi.RouteContext(r.Context()); routing != nil {
			route = routing.RoutePattern()
		}
		span.HTTP(r.Method, route, code)
		status = "ok"
		if response.Status() >= 400 {
			status = "error"
		}
		if ctx.Err() != nil {
			status = "cancelled"
		}
		severity := "info"
		if status == "error" {
			severity = "error"
		}
		span.Event("http.completed", severity)
	})
}
