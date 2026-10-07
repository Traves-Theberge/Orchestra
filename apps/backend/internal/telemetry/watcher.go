// Package telemetry provides a file watcher that ingests session logs from
// external agent providers (Claude, Codex, Gemini, OpenCode) and records
// events and sessions into the local database.
package telemetry

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/rs/zerolog"
	_ "modernc.org/sqlite"
)

var (
	piiEmailRegex = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
	piiIPRegex    = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`)
	piiKeyRegex   = regexp.MustCompile(`(?i)(api[_-]?key|secret|password|token)["'=\s:]+([a-zA-Z0-9_\-\.]{16,})`)
	preambleRegex = regexp.MustCompile(`^(?i)(shadow\s*clone|blackops\s*session)[:-]?\s*`)
	healthState   = newHealthState()
)

// Options configures the telemetry watcher behavior including which providers
// to scan and whether to store raw event payloads.
type Options struct {
	Providers       []string
	StoreRawPayload bool
}

// ProviderHealth tracks operational metrics for a single telemetry provider
// including scan counts, event throughput, and error rates.
type ProviderHealth struct {
	Provider           string `json:"provider"`
	LastSuccessAt      string `json:"last_success_at"`
	SourcesScanned     int64  `json:"sources_scanned"`
	EventsWritten      int64  `json:"events_written"`
	EventsDropped      int64  `json:"events_dropped"`
	ParseErrors        int64  `json:"parse_errors"`
	LastScanDurationMs int64  `json:"last_scan_duration_ms"`
}

// HealthSnapshot captures the current health state of the telemetry watcher
// across all providers at a point in time.
type HealthSnapshot struct {
	LastTickAt string           `json:"last_tick_at"`
	Providers  []ProviderHealth `json:"providers"`
}

type telemetryHealthState struct {
	mu        sync.Mutex
	lastTick  time.Time
	providers map[string]*ProviderHealth
}

func newHealthState() *telemetryHealthState {
	return &telemetryHealthState{providers: map[string]*ProviderHealth{}}
}

func (s *telemetryHealthState) beginTick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastTick = time.Now().UTC()
}

func (s *telemetryHealthState) provider(provider string) *ProviderHealth {
	if p, ok := s.providers[provider]; ok {
		return p
	}
	p := &ProviderHealth{Provider: provider}
	s.providers[provider] = p
	return p
}

func (s *telemetryHealthState) addSource(provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.provider(provider)
	p.SourcesScanned++
}

func (s *telemetryHealthState) addEvent(provider string, count int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.provider(provider)
	p.EventsWritten += count
}

func (s *telemetryHealthState) addDropped(provider string, count int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.provider(provider)
	p.EventsDropped += count
}

func (s *telemetryHealthState) addParseError(provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.provider(provider)
	p.ParseErrors++
}

func (s *telemetryHealthState) markSuccess(provider string, started time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.provider(provider)
	p.LastSuccessAt = time.Now().UTC().Format(time.RFC3339)
	p.LastScanDurationMs = time.Since(started).Milliseconds()
}

func (s *telemetryHealthState) snapshot() HealthSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	providers := make([]ProviderHealth, 0, len(s.providers))
	for _, p := range s.providers {
		providers = append(providers, *p)
	}
	sort.Slice(providers, func(i, j int) bool { return providers[i].Provider < providers[j].Provider })
	return HealthSnapshot{
		LastTickAt: s.lastTick.Format(time.RFC3339),
		Providers:  providers,
	}
}

// Health returns a snapshot of the current telemetry watcher health across all providers.
func Health() HealthSnapshot {
	return healthState.snapshot()
}

func sanitizePII(text string) string {
	if text == "" {
		return text
	}

	hashReplacement := func(match string) string {
		hash := sha256.Sum256([]byte(match))
		return "[REDACTED:" + hex.EncodeToString(hash[:8]) + "]"
	}

	text = piiEmailRegex.ReplaceAllStringFunc(text, hashReplacement)
	text = piiIPRegex.ReplaceAllStringFunc(text, hashReplacement)

	// For keys, we only want to replace the value group, but standard ReplaceAllStringFunc replaces the whole match.
	text = piiKeyRegex.ReplaceAllStringFunc(text, func(match string) string {
		parts := piiKeyRegex.FindStringSubmatch(match)
		if len(parts) > 2 {
			hash := sha256.Sum256([]byte(parts[2]))
			return parts[1] + " [REDACTED:" + hex.EncodeToString(hash[:8]) + "]"
		}
		return match
	})

	return text
}

func stripPreamble(title string) string {
	return strings.TrimSpace(preambleRegex.ReplaceAllString(title, ""))
}

// ClaudeLogEntry represents a single parsed entry from a Claude Code JSONL log file.
type ClaudeLogEntry struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Tokens    struct {
		Input  int `json:"input"`
		Output int `json:"output"`
	} `json:"tokens,omitempty"`
	// Support for newer Claude logs
	Usage *struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage,omitempty"`
}

func extractTokens(raw map[string]interface{}) (input, output int) {
	// 1. Direct tokens (old format)
	if tokens, ok := raw["tokens"].(map[string]interface{}); ok {
		if in, ok := tokens["input"].(float64); ok {
			input = int(in)
		}
		if out, ok := tokens["output"].(float64); ok {
			output = int(out)
		}
		if input > 0 || output > 0 {
			return
		}
	}

	// 2. Claude message.usage format
	if msg, ok := raw["message"].(map[string]interface{}); ok {
		if usage, ok := msg["usage"].(map[string]interface{}); ok {
			if in, ok := usage["input_tokens"].(float64); ok {
				input = int(in)
			}
			if out, ok := usage["output_tokens"].(float64); ok {
				output = int(out)
			}
			if input > 0 || output > 0 {
				return
			}
		}
	}

	// 3. Codex payload.info.last_token_usage format
	if payload, ok := raw["payload"].(map[string]interface{}); ok {
		if info, ok := payload["info"].(map[string]interface{}); ok {
			if usage, ok := info["last_token_usage"].(map[string]interface{}); ok {
				if in, ok := usage["input_tokens"].(float64); ok {
					input = int(in)
				}
				if out, ok := usage["output_tokens"].(float64); ok {
					output = int(out)
				}
				if input > 0 || output > 0 {
					return
				}
			}
		}
	}

	return
}

// StartWatcher begins watching external agent log directories
func StartWatcher(ctx context.Context, database *db.DB, manualRoots []string, opts Options, logger zerolog.Logger) {
	if database == nil {
		return
	}
	providerSet := normalizeProviderSet(opts.Providers)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	homeDir, _ := os.UserHomeDir()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			healthState.beginTick()
			// 0. History Files (to map sessions to projects)
			if providerSet["claude"] {
				processHistoryFile(ctx, database, filepath.Join(homeDir, ".claude", "history.jsonl"), "claude", logger)
			}
			if providerSet["codex"] {
				processHistoryFile(ctx, database, filepath.Join(homeDir, ".codex", "history.jsonl"), "codex", logger)
			}
			if providerSet["gemini"] {
				processHistoryFile(ctx, database, filepath.Join(homeDir, ".gemini", "history.jsonl"), "gemini", logger)
			}

			// 1. Claude Code
			if providerSet["claude"] {
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".claude", "projects"), "claude", opts, logger)
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".claude", "logs"), "claude", opts, logger)
			}

			// 2. Codex
			if providerSet["codex"] {
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".codex", "sessions"), "codex", opts, logger)
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".codex", "log"), "codex", opts, logger)
			}

			// 3. OpenCode
			if providerSet["opencode"] {
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".opencode", "logs"), "opencode", opts, logger)
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".opencode", "sessions"), "opencode", opts, logger)
			}

			// 4. Gemini CLI
			if providerSet["gemini"] {
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".gemini", "logs"), "gemini", opts, logger)
				scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".gemini", "sessions"), "gemini", opts, logger)
				scanGeminiJSON(ctx, database, manualRoots, filepath.Join(homeDir, ".gemini"), opts, logger)
			}

			// 5. OpenCode
			if providerSet["opencode"] {
				scanOpenCodeSQLite(ctx, database, manualRoots, filepath.Join(homeDir, ".local", "share", "opencode", "opencode.db"), opts, logger)
			}

			// 6. omp (oh-my-pi)
			if providerSet["omp"] {
				scanOMPSessions(ctx, database, manualRoots, filepath.Join(homeDir, ".omp", "agent", "sessions"), opts, logger)
			}
		}
	}
}

func normalizeProviderSet(providers []string) map[string]bool {
	defaultSet := map[string]bool{"claude": true, "codex": true, "gemini": true, "opencode": true, "omp": true}
	if len(providers) == 0 {
		return defaultSet
	}
	set := map[string]bool{}
	for _, provider := range providers {
		trimmed := strings.ToLower(strings.TrimSpace(provider))
		if trimmed == "" {
			continue
		}
		set[trimmed] = true
	}
	if len(set) == 0 {
		return defaultSet
	}
	return set
}

type geminiChatFile struct {
	SessionID   string `json:"sessionId"`
	ProjectHash string `json:"projectHash"`
	StartTime   string `json:"startTime"`
	LastUpdated string `json:"lastUpdated"`
	Messages    []struct {
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
		Type      string `json:"type"`
		Content   any    `json:"content"`
		Tokens    struct {
			Input  int `json:"input"`
			Output int `json:"output"`
		} `json:"tokens"`
	} `json:"messages"`
}

type geminiLogEntry struct {
	SessionID string `json:"sessionId"`
	MessageID int    `json:"messageId"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func scanGeminiJSON(ctx context.Context, database *db.DB, manualRoots []string, geminiHome string, opts Options, logger zerolog.Logger) {
	started := time.Now()
	healthState.addSource("gemini")
	aliasMap := loadGeminiProjectAliases(filepath.Join(geminiHome, "projects.json"))

	tmpRoot := filepath.Join(geminiHome, "tmp")
	chatGlobs, _ := filepath.Glob(filepath.Join(tmpRoot, "*", "chats", "session-*.json"))
	for _, chatFile := range chatGlobs {
		if shouldProcessJSONFile(ctx, database, chatFile) {
			processGeminiChatFile(ctx, database, manualRoots, aliasMap, chatFile, opts, logger)
		}
	}

	logGlobs, _ := filepath.Glob(filepath.Join(tmpRoot, "*", "logs.json"))
	for _, logFile := range logGlobs {
		if shouldProcessJSONFile(ctx, database, logFile) {
			processGeminiLogsFile(ctx, database, manualRoots, aliasMap, logFile, opts, logger)
		}
	}
	healthState.markSuccess("gemini", started)
}

func loadGeminiProjectAliases(projectsPath string) map[string]string {
	data, err := os.ReadFile(projectsPath)
	if err != nil {
		return map[string]string{}
	}

	var payload struct {
		Projects map[string]string `json:"projects"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return map[string]string{}
	}

	aliases := make(map[string]string, len(payload.Projects))
	for root, alias := range payload.Projects {
		if strings.TrimSpace(alias) == "" || strings.TrimSpace(root) == "" {
			continue
		}
		aliases[alias] = root
	}

	return aliases
}

func shouldProcessJSONFile(ctx context.Context, database *db.DB, filePath string) bool {
	info, err := os.Stat(filePath)
	if err != nil {
		return false
	}

	lastMtime := getOffset(ctx, database, filePath+":mtime")
	lastSize := getOffset(ctx, database, filePath+":size")
	currentMtime := info.ModTime().UnixNano()
	currentSize := info.Size()

	if currentMtime > lastMtime {
		return true
	}
	return currentSize != lastSize
}

func saveJSONFileCheckpoint(ctx context.Context, database *db.DB, filePath string) {
	if info, err := os.Stat(filePath); err == nil {
		saveOffset(ctx, database, filePath+":mtime", info.ModTime().UnixNano())
		saveOffset(ctx, database, filePath+":size", info.Size())
	}
}

func geminiAliasFromPath(filePath string) string {
	parts := strings.Split(filepath.Clean(filePath), string(os.PathSeparator))
	for i := 0; i < len(parts)-1; i++ {
		if parts[i] == "tmp" {
			return parts[i+1]
		}
	}
	return ""
}

// matchExistingProject finds a project by directory path without creating one.
func matchExistingProject(ctx context.Context, database *db.DB, directory string) string {
	if strings.TrimSpace(directory) == "" {
		return ""
	}
	cleanDir := filepath.Clean(directory)
	projects, _ := database.GetProjects(ctx)
	for _, p := range projects {
		cleanRoot := filepath.Clean(p.RootPath)
		if cleanDir == cleanRoot || strings.HasPrefix(cleanDir, cleanRoot+"/") {
			return p.ID
		}
	}
	return ""
}

func resolveGeminiProject(ctx context.Context, database *db.DB, manualRoots []string, aliasMap map[string]string, filePath string, logger zerolog.Logger) string {
	// Match against existing projects only — never create new ones
	alias := geminiAliasFromPath(filePath)
	if root, ok := aliasMap[alias]; ok {
		projects, _ := database.GetProjects(ctx)
		cleanRoot := filepath.Clean(root)
		for _, p := range projects {
			if filepath.Clean(p.RootPath) == cleanRoot {
				return p.ID
			}
		}
	}

	projectID, _ := findProjectRoot(ctx, database, filePath, manualRoots, logger)
	return projectID
}

func processGeminiChatFile(ctx context.Context, database *db.DB, manualRoots []string, aliasMap map[string]string, filePath string, opts Options, logger zerolog.Logger) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		healthState.addParseError("gemini")
		return
	}

	var chat geminiChatFile
	if err := json.Unmarshal(data, &chat); err != nil {
		healthState.addParseError("gemini")
		return
	}

	if chat.SessionID == "" {
		return
	}

	projectID := resolveGeminiProject(ctx, database, manualRoots, aliasMap, filePath, logger)
	_ = database.RecordSession(ctx, chat.SessionID, projectID, "", chat.SessionID, "gemini", "", "unknown")

	for idx, msg := range chat.Messages {
		kind := strings.TrimSpace(msg.Type)
		if kind == "" {
			kind = "message"
		}

		ts := msg.Timestamp
		if ts == "" {
			ts = chat.LastUpdated
		}
		if ts == "" {
			ts = chat.StartTime
		}
		if ts == "" {
			ts = time.Now().Format(time.RFC3339)
		}

		eventKey := msg.ID
		if eventKey == "" {
			eventKey = fmt.Sprintf("%d", idx)
		}
		eventHash := sha256.Sum256([]byte("gemini-chat:" + chat.SessionID + ":" + eventKey))
		eventID := hex.EncodeToString(eventHash[:16])

		message := geminiContentText(msg.Content)
		if message == "" {
			message = kind
		}

		raw, _ := json.Marshal(msg)
		rawPayload := raw
		if !opts.StoreRawPayload {
			rawPayload = nil
		}
		_ = database.RecordEvent(ctx, eventID, chat.SessionID, kind, sanitizePII(message), rawPayload, msg.Tokens.Input, msg.Tokens.Output, ts)
		healthState.addEvent("gemini", 1)
	}

	saveJSONFileCheckpoint(ctx, database, filePath)
}

func geminiContentText(content any) string {
	switch value := content.(type) {
	case string:
		return strings.TrimSpace(value)
	case []any:
		parts := make([]string, 0, len(value))
		for _, item := range value {
			if m, ok := item.(map[string]any); ok {
				if text, ok := m["text"].(string); ok {
					trimmed := strings.TrimSpace(text)
					if trimmed != "" {
						parts = append(parts, trimmed)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

func processGeminiLogsFile(ctx context.Context, database *db.DB, manualRoots []string, aliasMap map[string]string, filePath string, opts Options, logger zerolog.Logger) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		healthState.addParseError("gemini")
		return
	}

	var entries []geminiLogEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		healthState.addParseError("gemini")
		return
	}

	projectID := resolveGeminiProject(ctx, database, manualRoots, aliasMap, filePath, logger)

	for _, entry := range entries {
		if entry.SessionID == "" {
			continue
		}
		_ = database.RecordSession(ctx, entry.SessionID, projectID, "", entry.SessionID, "gemini", "", "unknown")

		ts := entry.Timestamp
		if ts == "" {
			ts = time.Now().Format(time.RFC3339)
		}

		eventHash := sha256.Sum256([]byte(fmt.Sprintf("gemini-log:%s:%d:%s", entry.SessionID, entry.MessageID, entry.Type)))
		eventID := hex.EncodeToString(eventHash[:16])
		kind := entry.Type
		if kind == "" {
			kind = "log"
		}
		raw, _ := json.Marshal(entry)
		rawPayload := raw
		if !opts.StoreRawPayload {
			rawPayload = nil
		}
		_ = database.RecordEvent(ctx, eventID, entry.SessionID, kind, sanitizePII(entry.Message), rawPayload, 0, 0, ts)
		healthState.addEvent("gemini", 1)
	}

	saveJSONFileCheckpoint(ctx, database, filePath)
}

func scanOpenCodeSQLite(ctx context.Context, database *db.DB, manualRoots []string, dbPath string, opts Options, logger zerolog.Logger) {
	started := time.Now()
	healthState.addSource("opencode")
	if _, err := os.Stat(dbPath); err != nil {
		return
	}

	extDB, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		logger.Debug().Err(err).Msg("failed to open opencode sqlite db")
		return
	}
	defer extDB.Close()

	messageCheckpointKey := "opencode:message:rowid"
	partCheckpointKey := "opencode:part:rowid"
	lastMessage := getOffset(ctx, database, messageCheckpointKey)
	lastPart := getOffset(ctx, database, partCheckpointKey)

	maxMessage := lastMessage
	maxPart := lastPart

	msgRows, err := extDB.QueryContext(ctx, `
		SELECT m.rowid, m.id, m.session_id, m.time_created, m.data, COALESCE(s.directory, '')
		FROM message m
		LEFT JOIN session s ON s.id = m.session_id
		WHERE m.rowid > ?
		ORDER BY m.rowid ASC
	`, lastMessage)
	if err == nil {
		defer msgRows.Close()
		for msgRows.Next() {
			var messageID, sessionID, dataJSON, directory string
			var createdAt, rowID int64
			if err := msgRows.Scan(&rowID, &messageID, &sessionID, &createdAt, &dataJSON, &directory); err != nil {
				healthState.addParseError("opencode")
				continue
			}
			if rowID > maxMessage {
				maxMessage = rowID
			}

			projectID := matchExistingProject(ctx, database, directory)

			var payload map[string]any
			if err := json.Unmarshal([]byte(dataJSON), &payload); err != nil {
				healthState.addParseError("opencode")
				continue
			}

			// Extract model from OpenCode message data
			sessionModel := extractOpenCodeModel(payload)
			_ = database.RecordSession(ctx, sessionID, projectID, "", sessionID, "opencode", sessionModel, "unknown")

			role, _ := payload["role"].(string)
			kind := "message"
			if role != "" {
				kind = "message_" + role
			}
			msg := ""
			if summary, ok := payload["summary"].(string); ok {
				msg = strings.TrimSpace(summary)
			}
			if msg == "" {
				msg = kind
			}

			inputTokens, outputTokens := extractOpenCodeTokens(payload)
			timestamp := msEpochToRFC3339(createdAt)
			eventHash := sha256.Sum256([]byte("opencode-message:" + messageID))
			eventID := hex.EncodeToString(eventHash[:16])
			rawPayload := []byte(dataJSON)
			if !opts.StoreRawPayload {
				rawPayload = nil
			}
			_ = database.RecordEvent(ctx, eventID, sessionID, kind, sanitizePII(msg), rawPayload, inputTokens, outputTokens, timestamp)
			healthState.addEvent("opencode", 1)
		}
	}

	partRows, err := extDB.QueryContext(ctx, `
		SELECT p.rowid, p.id, p.session_id, p.time_created, p.data, COALESCE(s.directory, '')
		FROM part p
		LEFT JOIN session s ON s.id = p.session_id
		WHERE p.rowid > ?
		ORDER BY p.rowid ASC
	`, lastPart)
	if err == nil {
		defer partRows.Close()
		for partRows.Next() {
			var partID, sessionID, dataJSON, directory string
			var createdAt, rowID int64
			if err := partRows.Scan(&rowID, &partID, &sessionID, &createdAt, &dataJSON, &directory); err != nil {
				healthState.addParseError("opencode")
				continue
			}
			if rowID > maxPart {
				maxPart = rowID
			}

			projectID := matchExistingProject(ctx, database, directory)
			_ = database.RecordSession(ctx, sessionID, projectID, "", sessionID, "opencode", "", "unknown")

			var payload map[string]any
			if err := json.Unmarshal([]byte(dataJSON), &payload); err != nil {
				healthState.addParseError("opencode")
				continue
			}

			kind, _ := payload["type"].(string)
			if kind == "" {
				kind = "part"
			}
			message := extractOpenCodePartText(payload)
			if message == "" {
				message = kind
			}

			timestamp := msEpochToRFC3339(createdAt)
			eventHash := sha256.Sum256([]byte("opencode-part:" + partID))
			eventID := hex.EncodeToString(eventHash[:16])
			rawPayload := []byte(dataJSON)
			if !opts.StoreRawPayload {
				rawPayload = nil
			}
			_ = database.RecordEvent(ctx, eventID, sessionID, "part_"+kind, sanitizePII(message), rawPayload, 0, 0, timestamp)
			healthState.addEvent("opencode", 1)
		}
	}

	if maxMessage > lastMessage {
		saveOffset(ctx, database, messageCheckpointKey, maxMessage)
	}
	if maxPart > lastPart {
		saveOffset(ctx, database, partCheckpointKey, maxPart)
	}
	healthState.markSuccess("opencode", started)
}

// extractModelFromEntry pulls the model identifier from a raw JSONL log entry
// based on the provider format:
//   - Claude: type=="assistant" → message.model
//   - Codex: type=="turn_context" → payload.model
func extractModelFromEntry(raw map[string]interface{}, provider string) string {
	switch provider {
	case "claude":
		// Claude assistant entries have message.model
		if entryType, _ := raw["type"].(string); entryType == "assistant" {
			if msg, ok := raw["message"].(map[string]interface{}); ok {
				if model, ok := msg["model"].(string); ok && model != "" {
					return model
				}
			}
		}
	case "codex":
		// Codex turn_context entries have payload.model
		if entryType, _ := raw["type"].(string); entryType == "turn_context" {
			if payload, ok := raw["payload"].(map[string]interface{}); ok {
				if model, ok := payload["model"].(string); ok && model != "" {
					return model
				}
			}
		}
	}
	return ""
}

// extractOpenCodeModel pulls the model identifier from an OpenCode message payload.
// Format: data.model.modelID
func extractOpenCodeModel(payload map[string]any) string {
	modelObj, ok := payload["model"].(map[string]any)
	if !ok {
		return ""
	}
	if modelID, ok := modelObj["modelID"].(string); ok && modelID != "" {
		return modelID
	}
	return ""
}

func extractOpenCodeTokens(payload map[string]any) (int, int) {
	tokens, ok := payload["tokens"].(map[string]any)
	if !ok {
		return 0, 0
	}
	var in, out int
	if v, ok := tokens["input"].(float64); ok {
		in = int(v)
	}
	if v, ok := tokens["output"].(float64); ok {
		out = int(v)
	}
	return in, out
}

func extractOpenCodePartText(payload map[string]any) string {
	if text, ok := payload["text"].(string); ok {
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			return trimmed
		}
	}
	if tool, ok := payload["tool"].(string); ok {
		return "tool:" + tool
	}
	if reason, ok := payload["reason"].(string); ok {
		return reason
	}
	return ""
}

func msEpochToRFC3339(ms int64) string {
	if ms <= 0 {
		return time.Now().Format(time.RFC3339)
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func scanDirectory(ctx context.Context, database *db.DB, manualRoots []string, dir string, provider string, opts Options, logger zerolog.Logger) {
	started := time.Now()
	healthState.addSource(provider)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return
	}

	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".jsonl" && ext != ".log" {
			return nil
		}

		// Skip history files in this walker, they are handled explicitly
		if strings.HasSuffix(path, "history.jsonl") {
			return nil
		}

		processFile(ctx, database, manualRoots, path, provider, opts, logger)
		return nil
	})
	healthState.markSuccess(provider, started)
}

func getOffset(ctx context.Context, database *db.DB, path string) int64 {
	var offset int64
	err := database.QueryRowContext(ctx, "SELECT bytes_read FROM ingest_offsets WHERE file_path = ?", path).Scan(&offset)
	if err != nil {
		return 0
	}
	return offset
}

func saveOffset(ctx context.Context, database *db.DB, path string, offset int64) {
	query := `
		INSERT INTO ingest_offsets (file_path, bytes_read)
		VALUES (?, ?)
		ON CONFLICT(file_path) DO UPDATE SET bytes_read = excluded.bytes_read, updated_at = CURRENT_TIMESTAMP
	`
	_, _ = database.ExecContext(ctx, query, path, offset)
}

func deriveProjectFromPath(path string) string {
	// Claude paths encode the project working directory as a dash-separated segment:
	//   /home/traves/.claude/projects/-home-traves-Development-symphony-main/session.jsonl
	// Dashes replace path separators, but folder names may also contain dashes (e.g. "symphony-main").
	// We reconstruct the real path by greedily consuming segments and checking the filesystem.
	segments := strings.Split(path, string(os.PathSeparator))
	for _, seg := range segments {
		if strings.HasPrefix(seg, "-home-") || strings.HasPrefix(seg, "-tmp-") || strings.HasPrefix(seg, "-usr-") {
			parts := strings.Split(seg, "-")
			// Skip the leading empty element (from the leading dash)
			if len(parts) > 0 && parts[0] == "" {
				parts = parts[1:]
			}
			derived := greedyResolvePath(parts)
			if derived != "" {
				if eval, err := filepath.EvalSymlinks(derived); err == nil {
					return eval
				}
				return derived
			}
			// No valid path found on disk - return empty to skip project creation
			return ""
		}
	}
	return ""
}

// greedyResolvePath reconstructs a filesystem path from dash-split segments.
// Claude Code encodes project paths by replacing "/" with "-" and non-separator
// special characters (dots, spaces) with sequences that produce empty segments
// when split on "-". For example:
//
//	"1. Personal"  → "1--Personal"  (split: ["1","","Personal"])
//	"symphony-main"→ "symphony-main" (split: ["symphony","main"])
//
// The algorithm greedily tries the longest filesystem match at each level,
// rejoining segments with "-" and collapsing empty segments into ". " to
// recover the original directory name.
func greedyResolvePath(parts []string) string {
	if len(parts) == 0 {
		return ""
	}

	current := "/" + parts[0]
	parts = parts[1:]

	for len(parts) > 0 {
		found := false
		for take := len(parts); take >= 1; take-- {
			segment := recoverSegmentName(parts[:take])
			candidate := current + "/" + segment
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				current = candidate
				parts = parts[take:]
				found = true
				break
			}
			// Also try "." as joiner (e.g. "6.GroupProjects" encoded as "6-GroupProjects")
			if take >= 2 && parts[0] != "" {
				dotCandidate := current + "/" + parts[0] + "." + strings.Join(parts[1:take], "-")
				if info, err := os.Stat(dotCandidate); err == nil && info.IsDir() {
					current = dotCandidate
					parts = parts[take:]
					found = true
					break
				}
			}
		}
		if !found {
			current = current + "/" + parts[0]
			parts = parts[1:]
		}
	}

	if _, err := os.Stat(current); err == nil {
		return current
	}
	return ""
}

// recoverSegmentName rejoins dash-split parts into a directory name.
// Empty parts (from "--" sequences) are collapsed: an empty part followed by
// a non-empty part becomes ". " + next (e.g. ["1","","Personal"] → "1. Personal").
// An empty part at the end is dropped. Adjacent non-empty parts are joined with "-".
func recoverSegmentName(parts []string) string {
	var b strings.Builder
	for i := 0; i < len(parts); i++ {
		if parts[i] == "" {
			// Double-dash marker: next segment is prefixed with ". "
			if i+1 < len(parts) {
				if b.Len() > 0 {
					// nothing between current and the dot
				}
				b.WriteString(". ")
				b.WriteString(parts[i+1])
				i++ // skip the next part
			}
		} else {
			if b.Len() > 0 && !strings.HasSuffix(b.String(), ". ") {
				b.WriteString("-")
			}
			b.WriteString(parts[i])
		}
	}
	return b.String()
}

func findProjectRoot(ctx context.Context, database *db.DB, path string, manualRoots []string, logger zerolog.Logger) (string, string) {
	cleanPath := filepath.Clean(path)
	if eval, err := filepath.EvalSymlinks(cleanPath); err == nil {
		cleanPath = eval
	}

	// Try to match against existing projects in the DB only.
	// The watcher never creates projects — users add them explicitly via the API.
	projects, err := database.GetProjects(ctx)
	if err != nil {
		return "", ""
	}

	// 1. Check if the file path falls under any known project root
	for _, p := range projects {
		absRoot := filepath.Clean(p.RootPath)
		if eval, err := filepath.EvalSymlinks(absRoot); err == nil {
			absRoot = eval
		}
		if strings.HasPrefix(cleanPath, absRoot+"/") || cleanPath == absRoot {
			return p.ID, p.RootPath
		}
	}

	// 2. Try deriving the project path from the tool-specific encoded path,
	//    then match against existing projects
	if derived := deriveProjectFromPath(cleanPath); derived != "" {
		for _, p := range projects {
			absRoot := filepath.Clean(p.RootPath)
			if eval, err := filepath.EvalSymlinks(absRoot); err == nil {
				absRoot = eval
			}
			if strings.HasPrefix(derived, absRoot+"/") || derived == absRoot {
				return p.ID, p.RootPath
			}
		}
	}

	return "", ""
}

func processHistoryFile(ctx context.Context, database *db.DB, path string, provider string, logger zerolog.Logger) {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return
	}

	currentOffset := getOffset(ctx, database, path)
	if fileInfo.Size() <= currentOffset {
		return
	}

	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	if _, err := file.Seek(currentOffset, io.SeekStart); err != nil {
		return
	}

	scanner := bufio.NewScanner(file)
	var bytesRead int64 = currentOffset

	for scanner.Scan() {
		line := scanner.Text()
		bytesRead += int64(len(line)) + 1

		var entry struct {
			SessionID  string `json:"sessionId"`  // Claude
			Session_ID string `json:"session_id"` // Codex
			Project    string `json:"project"`    // Claude
		}
		if json.Unmarshal([]byte(line), &entry) == nil {
			sid := entry.SessionID
			if sid == "" {
				sid = entry.Session_ID
			}
			if sid != "" && entry.Project != "" {
				// Only link to existing projects — never auto-create from history
				projects, _ := database.GetProjects(ctx)
				for _, p := range projects {
					cleanRoot := filepath.Clean(p.RootPath)
					cleanProject := filepath.Clean(entry.Project)
					if strings.HasPrefix(cleanProject, cleanRoot+"/") || cleanProject == cleanRoot {
						logger.Debug().Str("sid", sid).Str("project", entry.Project).Str("id", p.ID).Msg("linking session to project from history")
						_ = database.UpdateSessionProject(ctx, sid, p.ID)
						break
					}
				}
			}
		}
	}
	saveOffset(ctx, database, path, bytesRead)
}

func processFile(ctx context.Context, database *db.DB, manualRoots []string, path string, provider string, opts Options, logger zerolog.Logger) {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return
	}

	currentOffset := getOffset(ctx, database, path)
	if fileInfo.Size() <= currentOffset {
		if fileInfo.Size() < currentOffset {
			saveOffset(ctx, database, path, 0)
		}
		return
	}

	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	if _, err := file.Seek(currentOffset, io.SeekStart); err != nil {
		return
	}

	projectID, _ := findProjectRoot(ctx, database, path, manualRoots, logger)

	// Default session ID for plain text logs
	sessionHash := sha256.Sum256([]byte(path))
	fallbackSessionID := hex.EncodeToString(sessionHash[:16])

	scanner := bufio.NewScanner(file)
	var bytesRead int64 = currentOffset

	for scanner.Scan() {
		line := scanner.Text()
		bytesRead += int64(len(line)) + 1

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			var entry ClaudeLogEntry
			_ = json.Unmarshal([]byte(line), &entry)

			// Extract actual session ID from tool logs if available
			sid := fallbackSessionID
			if s, ok := raw["sessionId"].(string); ok && s != "" {
				sid = s
			} else if s, ok := raw["session_id"].(string); ok && s != "" {
				sid = s
			}

			// Extract model from provider-specific log formats
			sessionModel := extractModelFromEntry(raw, provider)

			_ = database.RecordSession(ctx, sid, projectID, "", sid, provider, sessionModel, "unknown")

			if entry.Timestamp != "" {
				eventID := uuid.New().String()
				msg := sanitizePII(entry.Message)
				kind := stripPreamble(entry.Type)

				input, output := extractTokens(raw)
				rawPayload := []byte(line)
				if !opts.StoreRawPayload {
					rawPayload = nil
				}
				_ = database.RecordEvent(ctx, eventID, sid, kind, msg, rawPayload, input, output, entry.Timestamp)
				healthState.addEvent(provider, 1)
			}
		} else {
			healthState.addParseError(provider)
			// Fallback for plain text .log files
			if len(strings.TrimSpace(line)) > 0 {
				_ = database.RecordSession(ctx, fallbackSessionID, projectID, "", fallbackSessionID, provider, "", "unknown")
				eventID := uuid.New().String()
				kind := "log"
				if strings.Contains(strings.ToLower(line), "error") {
					kind = "error"
				}
				rawPayload := []byte(line)
				if !opts.StoreRawPayload {
					rawPayload = nil
				}
				_ = database.RecordEvent(ctx, eventID, fallbackSessionID, kind, sanitizePII(line), rawPayload, 0, 0, time.Now().Format(time.RFC3339))
				healthState.addEvent(provider, 1)
			}
		}
	}

	if err := scanner.Err(); err == nil {
		saveOffset(ctx, database, path, bytesRead)
	}
}
