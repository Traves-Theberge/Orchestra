// Package diagnostics records bounded, content-free operational evidence locally.
package diagnostics

import (
	"errors"
	"time"
)

var (
	ErrNotFound    = errors.New("diagnostic trace not found")
	ErrInvalid     = errors.New("invalid diagnostics query or settings")
	ErrUnavailable = errors.New("diagnostics unavailable")
)

type Fields struct {
	ProjectID string `json:"project_id"`
	TaskID    string `json:"task_id"`
	RunID     string `json:"run_id"`
	SessionID string `json:"session_id"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Attempt   int    `json:"attempt"`
}
type Options struct {
	QueueSize int
	Settings  *Settings
}
type Settings struct {
	Enabled              bool `json:"enabled"`
	RetentionDays        int  `json:"retention_days"`
	MetricsRetentionDays int  `json:"metrics_retention_days"`
	MaxStorageMB         int  `json:"max_storage_mb"`
}
type Filter struct {
	ProjectID, TaskID, Provider, Status, Severity, Query, Since, Until string
	Limit, Offset                                                      int
}
type HTTPFields struct {
	HTTPMethod     string `json:"http_method,omitempty"`
	HTTPRoute      string `json:"http_route,omitempty"`
	HTTPStatusCode int    `json:"http_status_code,omitempty"`
}
type SpanRecord struct {
	Fields
	HTTPFields
	Label        string     `json:"label"`
	Description  string     `json:"description"`
	TraceID      string     `json:"trace_id"`
	SpanID       string     `json:"span_id"`
	ParentSpanID string     `json:"parent_span_id"`
	Name         string     `json:"name"`
	StartTime    time.Time  `json:"start_time"`
	EndTime      *time.Time `json:"end_time,omitempty"`
	DurationMS   float64    `json:"duration_ms"`
	Status       string     `json:"status"`
	InputTokens  *int64     `json:"input_tokens,omitempty"`
	OutputTokens *int64     `json:"output_tokens,omitempty"`
}
type TraceSummary struct {
	SpanRecord
	SpanCount int `json:"span_count"`
}
type TracePage struct {
	Items  []TraceSummary `json:"items"`
	Total  int            `json:"total"`
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}
type LogRecord struct {
	Fields
	HTTPFields
	Label       string    `json:"label"`
	Description string    `json:"description"`
	DurationMS  *float64  `json:"duration_ms,omitempty"`
	ID          int64     `json:"id"`
	TraceID     string    `json:"trace_id"`
	SpanID      string    `json:"span_id"`
	Timestamp   time.Time `json:"timestamp"`
	Name        string    `json:"name"`
	Severity    string    `json:"severity"`
}
type LogPage struct {
	Items  []LogRecord `json:"items"`
	Total  int         `json:"total"`
	Limit  int         `json:"limit"`
	Offset int         `json:"offset"`
}
type TraceDetail struct {
	Trace   TraceSummary `json:"trace"`
	Spans   []SpanRecord `json:"spans"`
	Logs    []LogRecord  `json:"logs"`
	Partial bool         `json:"partial"`
}
type Point struct {
	Time         time.Time `json:"time"`
	Operations   int64     `json:"operations"`
	Errors       int64     `json:"errors"`
	DurationMS   float64   `json:"duration_ms"`
	InputTokens  *int64    `json:"input_tokens,omitempty"`
	OutputTokens *int64    `json:"output_tokens,omitempty"`
}
type Operation struct {
	Name              string  `json:"name"`
	Count             int64   `json:"count"`
	Errors            int64   `json:"errors"`
	AverageDurationMS float64 `json:"average_duration_ms"`
}
type Usage struct {
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	KnownRuns    int64  `json:"known_runs"`
}
type Feature struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}
type Runtime struct {
	Goroutines int    `json:"goroutines"`
	HeapBytes  uint64 `json:"heap_bytes"`
}
type Overview struct {
	DetailedScope  bool        `json:"detailed_scope"`
	TotalTraces    int         `json:"total_traces"`
	FailedTraces   int         `json:"failed_traces"`
	ActiveTraces   int         `json:"active_traces"`
	DroppedRecords int64       `json:"dropped_records"`
	StorageBytes   int64       `json:"storage_bytes"`
	QueueDepth     int         `json:"queue_depth"`
	Points         []Point     `json:"points"`
	Operations     []Operation `json:"operations"`
	Usage          []Usage     `json:"usage"`
	Features       []Feature   `json:"features"`
	Runtime        Runtime     `json:"runtime"`
	Settings       Settings    `json:"settings"`
}
type Export struct {
	SchemaVersion int            `json:"schema_version"`
	ExportedAt    time.Time      `json:"exported_at"`
	Traces        []TraceSummary `json:"traces"`
	Spans         []SpanRecord   `json:"spans"`
	Logs          []LogRecord    `json:"logs"`
	Truncated     bool           `json:"truncated"`
}
