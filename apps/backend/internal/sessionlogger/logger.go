// Package sessionlogger writes JSONL session logs.
//
// Each session gets its own JSONL file under
// ~/.orchestra/sessions/{session-uuid}.jsonl
package sessionlogger

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	SchemaVersion = "orchestra/session-log/1.0"
	Harness       = "orchestra"
)

// --- Schema Types ---

// ContentBlock is a typed content element within a message.
type ContentBlock struct {
	Type       string `json:"type"`                 // "text", "reasoning", "tool-call", "tool-result", "image", "file"
	Text       string `json:"text,omitempty"`       // for text and reasoning blocks
	ToolCallID string `json:"toolCallId,omitempty"` // for tool-call and tool-result
	ToolName   string `json:"toolName,omitempty"`   // for tool-call and tool-result
	Input      any    `json:"input,omitempty"`      // for tool-call
	Output     any    `json:"output,omitempty"`     // for tool-result
	IsError    bool   `json:"isError,omitempty"`    // for tool-result
	MediaType  string `json:"mediaType,omitempty"`  // for image and file
	Data       string `json:"data,omitempty"`       // base64 for image and file
}

// Usage tracks token consumption.
type Usage struct {
	InputTokens        int64              `json:"inputTokens,omitempty"`
	OutputTokens       int64              `json:"outputTokens,omitempty"`
	TotalTokens        int64              `json:"totalTokens,omitempty"`
	InputTokenDetails  *InputTokenDetail  `json:"inputTokenDetails,omitempty"`
	OutputTokenDetails *OutputTokenDetail `json:"outputTokenDetails,omitempty"`
}

// InputTokenDetail breaks down input token sources.
type InputTokenDetail struct {
	NoCacheTokens    int64 `json:"noCacheTokens,omitempty"`
	CacheReadTokens  int64 `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64 `json:"cacheWriteTokens,omitempty"`
}

// OutputTokenDetail breaks down output token categories.
type OutputTokenDetail struct {
	TextTokens      int64 `json:"textTokens,omitempty"`
	ReasoningTokens int64 `json:"reasoningTokens,omitempty"`
}

// --- Content Block Builders ---

func TextBlock(t string) ContentBlock { return ContentBlock{Type: "text", Text: t} }

func ToolCallBlock(toolName string, input any, toolCallID string) ContentBlock {
	if toolCallID == "" {
		toolCallID = "tc-" + uuid.New().String()[:12]
	}
	return ContentBlock{Type: "tool-call", ToolCallID: toolCallID, ToolName: toolName, Input: input}
}

func ToolResultBlock(toolCallID, toolName string, output any, isError bool) ContentBlock {
	return ContentBlock{Type: "tool-result", ToolCallID: toolCallID, ToolName: toolName, Output: output, IsError: isError}
}

// --- Logger ---

// Logger writes JSONL session logs to disk. Thread-safe.
type Logger struct {
	mu        sync.Mutex
	outputDir string
	files     map[string]*os.File
	parentIDs map[string]string // sessionID -> last messageID (for parentId threading)
	version   string
	cwd       string
	gitBranch string
}

// NewLogger creates a logger writing to ~/.orchestra/sessions/.
func NewLogger(version string) (*Logger, error) {
	dir, err := defaultOutputDir()
	if err != nil {
		return nil, fmt.Errorf("session-logger: output dir: %w", err)
	}
	return newLogger(dir, version), nil
}

// NewLoggerWithDir creates a logger writing to a custom directory.
func NewLoggerWithDir(dir, version string) *Logger {
	return newLogger(dir, version)
}

func newLogger(dir, version string) *Logger {
	cwd, _ := os.Getwd()
	return &Logger{
		outputDir: dir,
		files:     make(map[string]*os.File),
		parentIDs: make(map[string]string),
		version:   version,
		cwd:       cwd,
		gitBranch: detectGitBranch(),
	}
}

// base returns common fields for every record (mirrors Python _base()).
func (l *Logger) base() map[string]any {
	m := map[string]any{
		"$schema": SchemaVersion,
		"harness": Harness,
	}
	if l.version != "" {
		m["harnessVersion"] = l.version
	}
	if l.cwd != "" {
		m["cwd"] = l.cwd
	}
	if l.gitBranch != "" {
		m["gitBranch"] = l.gitBranch
	}
	return m
}

// --- Session Lifecycle ---

// StartSession writes the session envelope as the first JSONL line.
func (l *Logger) StartSession(sessionID, projectID, firstPrompt string) error {
	m := l.base()
	m["type"] = "session"
	m["id"] = sessionID
	m["projectId"] = slugifyProject(projectID)
	m["status"] = "active"
	m["createdAt"] = utcnow()
	m["firstPrompt"] = truncate(firstPrompt, 500)

	l.mu.Lock()
	l.parentIDs[sessionID] = "" // reset parent chain
	l.mu.Unlock()

	return l.appendJSON(sessionID, m)
}

// CloseSession writes a session close marker, a session_end system message,
// and closes the file handle.
func (l *Logger) CloseSession(sessionID string, totalUsage *Usage) error {
	now := utcnow()
	m := l.base()
	m["type"] = "session"
	m["id"] = sessionID
	m["status"] = "closed"
	m["closedAt"] = now
	m["updatedAt"] = now
	if err := l.appendJSON(sessionID, m); err != nil {
		return err
	}

	// Emit session_end system message (matches Python close())
	_ = l.LogSystem(sessionID, "session_end", nil)

	l.mu.Lock()
	defer l.mu.Unlock()
	if f, ok := l.files[sessionID]; ok {
		f.Close()
		delete(l.files, sessionID)
	}
	delete(l.parentIDs, sessionID)
	return nil
}

// --- Messages ---

// LogMessage writes a message with parentId threading.
func (l *Logger) LogMessage(msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)

	// Apply base fields
	base := l.base()
	for k, v := range base {
		if _, exists := msg[k]; !exists {
			msg[k] = v
		}
	}

	// Defaults
	if msg["type"] == nil {
		msg["type"] = "message"
	}
	if msg["id"] == nil {
		msg["id"] = uuid.New().String()
	}
	if msg["timestamp"] == nil {
		msg["timestamp"] = utcnow()
	}

	// Thread parentId
	l.mu.Lock()
	if sessionID != "" {
		msg["parentId"] = l.parentIDs[sessionID]
		l.parentIDs[sessionID], _ = msg["id"].(string)
	}
	l.mu.Unlock()

	return l.appendJSON(sessionID, msg)
}

// LogUserMessage logs a user text message.
func (l *Logger) LogUserMessage(sessionID, text string) error {
	return l.LogMessage(map[string]any{
		"sessionId": sessionID,
		"role":      "user",
		"content":   []ContentBlock{TextBlock(text)},
	})
}

// LogAssistantMessage logs an assistant response with optional usage.
func (l *Logger) LogAssistantMessage(sessionID, text, model, provider string, u *Usage) error {
	msg := map[string]any{
		"sessionId": sessionID,
		"role":      "assistant",
		"content":   []ContentBlock{TextBlock(text)},
	}
	if model != "" {
		msg["model"] = model
	}
	if provider != "" {
		msg["provider"] = provider
	}
	if u != nil {
		msg["usage"] = u
	}
	return l.LogMessage(msg)
}

// LogToolCall logs a tool invocation.
func (l *Logger) LogToolCall(sessionID, toolCallID, toolName string, input any) error {
	return l.LogMessage(map[string]any{
		"sessionId": sessionID,
		"role":      "assistant",
		"content":   []ContentBlock{ToolCallBlock(toolName, input, toolCallID)},
	})
}

// LogToolResult logs a tool result.
func (l *Logger) LogToolResult(sessionID, toolCallID, toolName string, output any, isError bool) error {
	return l.LogMessage(map[string]any{
		"sessionId": sessionID,
		"role":      "user",
		"content":   []ContentBlock{ToolResultBlock(toolCallID, toolName, output, isError)},
	})
}

// LogSystem logs a system message (e.g. session_end, turn_duration).
func (l *Logger) LogSystem(sessionID, subtype string, extra map[string]any) error {
	msg := map[string]any{
		"sessionId": sessionID,
		"role":      "system",
		"content":   []ContentBlock{},
		"subtype":   subtype,
	}
	for k, v := range extra {
		msg[k] = v
	}
	return l.LogMessage(msg)
}

// --- Todos ---

// TodoObject represents a cross-session work item.
type TodoObject struct {
	UUID             string   `json:"uuid"`
	ProjectID        string   `json:"projectId,omitempty"`
	SessionID        string   `json:"sessionId,omitempty"`
	Status           string   `json:"status"`
	Content          string   `json:"content"`
	ActiveForm       string   `json:"activeForm,omitempty"`
	Source           string   `json:"source,omitempty"`
	BlockedBy        []string `json:"blockedBy,omitempty"`
	EstimatedMinutes int      `json:"estimatedMinutes,omitempty"`
	ExternalID       string   `json:"externalId,omitempty"`
}

// LogTodo writes a todo record.
func (l *Logger) LogTodo(sessionID string, todo TodoObject) (string, error) {
	if todo.UUID == "" {
		todo.UUID = uuid.New().String()
	}

	m := l.base()
	m["type"] = "todo"
	m["uuid"] = todo.UUID
	m["sessionId"] = sessionID
	m["status"] = todo.Status
	m["content"] = todo.Content
	m["createdAt"] = utcnow()
	m["updatedAt"] = utcnow()

	if todo.ProjectID != "" {
		m["projectId"] = todo.ProjectID
	}
	if todo.ActiveForm != "" {
		m["activeForm"] = todo.ActiveForm
	}
	if todo.Source != "" {
		m["source"] = todo.Source
	}
	if len(todo.BlockedBy) > 0 {
		m["blockedBy"] = todo.BlockedBy
	}
	if todo.EstimatedMinutes > 0 {
		m["estimatedMinutes"] = todo.EstimatedMinutes
	}
	if todo.ExternalID != "" {
		m["externalId"] = todo.ExternalID
	}
	if todo.Status == "completed" {
		m["completedAt"] = utcnow()
	}

	return todo.UUID, l.appendJSON(sessionID, m)
}

// LogTodoEvent writes a todo status transition event.
func (l *Logger) LogTodoEvent(sessionID, todoUUID, newStatus, oldStatus, messageID string) error {
	m := l.base()
	m["type"] = "todo_event"
	m["todoUuid"] = todoUUID
	m["newStatus"] = newStatus
	m["eventAt"] = utcnow()
	if oldStatus != "" {
		m["oldStatus"] = oldStatus
	}
	if messageID != "" {
		m["messageId"] = messageID
	}
	return l.appendJSON(sessionID, m)
}

// --- Metrics ---

// LogMetric writes a legacy usage rollup metric.
func (l *Logger) LogMetric(sessionID, window string, u *Usage, projectID string, messageCount int, costUsd float64) error {
	m := l.base()
	m["type"] = "metric"
	m["window"] = window
	m["usage"] = u
	if projectID != "" {
		m["projectId"] = projectID
	}
	if messageCount > 0 {
		m["messageCount"] = messageCount
	}
	if costUsd > 0 {
		m["costUsd"] = costUsd
	}
	return l.appendJSON(sessionID, m)
}

// ValidMetricTypes for DataPoint records.
var ValidMetricTypes = map[string]bool{
	"count": true, "gauge": true, "rate": true,
	"histogram": true, "distribution": true, "set": true,
}

// LogDataPoint writes a Datadog/StatsD/OpenTelemetry compatible metric.
func (l *Logger) LogDataPoint(sessionID string, metricName, metricType string, value any, tags map[string]string, interval int, unit string) error {
	if !ValidMetricTypes[metricType] {
		return fmt.Errorf("session-logger: invalid metricType %q", metricType)
	}

	m := l.base()
	m["type"] = "datapoint"
	m["metric"] = metricName
	m["metricType"] = metricType
	m["value"] = value
	m["timestamp"] = utcnow()
	if len(tags) > 0 {
		m["tags"] = tags
	}
	if interval > 0 {
		m["interval"] = interval
	}
	if unit != "" {
		m["unit"] = unit
	}
	return l.appendJSON(sessionID, m)
}

// --- Projects ---

// LogProject writes a project identity record.
func (l *Logger) LogProject(sessionID, projectID string, displayName, projectPath, visibility string) error {
	m := l.base()
	m["type"] = "project"
	m["id"] = projectID
	if displayName != "" {
		m["displayName"] = displayName
	}
	if projectPath != "" {
		m["path"] = projectPath
	}
	if visibility != "" {
		m["visibility"] = visibility
	}
	return l.appendJSON(sessionID, m)
}

// --- Tool Definitions ---

// LogToolDefinition writes a tool schema record.
func (l *Logger) LogToolDefinition(sessionID, name string, inputSchema map[string]any, description string) error {
	m := l.base()
	m["type"] = "tool_definition"
	m["name"] = name
	m["inputSchema"] = inputSchema
	if description != "" {
		m["description"] = description
	}
	return l.appendJSON(sessionID, m)
}

// --- Alert Thresholds ---

// LogAlertThreshold writes an alert threshold record.
func (l *Logger) LogAlertThreshold(sessionID string, windowMinutes int, metricName string, threshold float64, enabled bool) error {
	m := l.base()
	m["type"] = "alert_threshold"
	m["windowMinutes"] = windowMinutes
	m["metric"] = metricName
	m["thresholdValue"] = threshold
	m["enabled"] = enabled
	return l.appendJSON(sessionID, m)
}

// --- Training Run Events ---

func (l *Logger) LogTrainingStart(sessionID, runID, model string, config map[string]any) error {
	m := map[string]any{"$schema": SchemaVersion, "type": "run.start", "run_id": runID, "model": model, "ts": utcnow()}
	if config != nil {
		m["config"] = config
	}
	return l.appendJSON(sessionID, m)
}

func (l *Logger) LogTrainingLoss(sessionID, runID string, step int, loss float64, lr *float64) error {
	m := map[string]any{"$schema": SchemaVersion, "type": "run.loss", "run_id": runID, "step": step, "loss": loss, "ts": utcnow()}
	if lr != nil {
		m["lr"] = *lr
	}
	return l.appendJSON(sessionID, m)
}

func (l *Logger) LogTrainingSample(sessionID, runID string, step int, text string, loss *float64) error {
	m := map[string]any{"$schema": SchemaVersion, "type": "run.sample", "run_id": runID, "step": step, "text": text, "ts": utcnow()}
	if loss != nil {
		m["loss"] = *loss
	}
	return l.appendJSON(sessionID, m)
}

func (l *Logger) LogTrainingCheckpoint(sessionID, runID string, step int, path string, sizeBytes *int64) error {
	m := map[string]any{"$schema": SchemaVersion, "type": "run.checkpoint", "run_id": runID, "step": step, "path": path, "ts": utcnow()}
	if sizeBytes != nil {
		m["size_bytes"] = *sizeBytes
	}
	return l.appendJSON(sessionID, m)
}

func (l *Logger) LogTrainingEval(sessionID, runID string, step int, evalName string, score float64) error {
	return l.appendJSON(sessionID, map[string]any{
		"$schema": SchemaVersion, "type": "run.eval", "run_id": runID,
		"step": step, "eval": evalName, "score": score, "ts": utcnow(),
	})
}

func (l *Logger) LogTrainingEnd(sessionID, runID string, finalLoss *float64, wallMs *int64) error {
	m := map[string]any{"$schema": SchemaVersion, "type": "run.end", "run_id": runID, "ts": utcnow()}
	if finalLoss != nil {
		m["final_loss"] = *finalLoss
	}
	if wallMs != nil {
		m["wall_ms"] = *wallMs
	}
	return l.appendJSON(sessionID, m)
}

// --- Lifecycle ---

// Close closes all open file handles.
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for id, f := range l.files {
		f.Close()
		delete(l.files, id)
	}
}

// --- Internal ---

func (l *Logger) appendJSON(sessionID string, obj any) error {
	data, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("session-logger: marshal: %w", err)
	}
	data = append(data, '\n')

	l.mu.Lock()
	defer l.mu.Unlock()

	f, ok := l.files[sessionID]
	if !ok {
		if err := os.MkdirAll(l.outputDir, 0755); err != nil {
			return fmt.Errorf("session-logger: mkdir: %w", err)
		}
		path := filepath.Join(l.outputDir, sessionID+".jsonl")
		f, err = os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return fmt.Errorf("session-logger: open %s: %w", path, err)
		}
		l.files[sessionID] = f
	}

	_, err = f.Write(data)
	return err
}

func defaultOutputDir() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(u.HomeDir, ".orchestra", "sessions")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func slugifyProject(path string) string {
	if path == "" {
		return ""
	}
	s := strings.ReplaceAll(path, "/", "-")
	s = strings.ReplaceAll(s, ".", "-")
	s = strings.TrimLeft(s, "-")
	if s == "" {
		return "root"
	}
	return s
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func utcnow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func detectGitBranch() string {
	out, err := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
