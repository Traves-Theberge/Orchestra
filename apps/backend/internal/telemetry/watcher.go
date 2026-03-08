package telemetry

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	"github.com/rs/zerolog"
)

var (
	piiEmailRegex = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
	piiIPRegex    = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`)
	piiKeyRegex   = regexp.MustCompile(`(?i)(api[_-]?key|secret|password|token)["'=\s:]+([a-zA-Z0-9_\-\.]{16,})`)
	preambleRegex = regexp.MustCompile(`^(?i)(shadow\s*clone|blackops\s*session)[:-]?\s*`)
)

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

type ClaudeLogEntry struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Tokens    struct {
		Input  int `json:"input"`
		Output int `json:"output"`
	} `json:"tokens,omitempty"`
}

// StartWatcher begins watching external agent log directories
func StartWatcher(ctx context.Context, database *db.DB, manualRoots []string, logger zerolog.Logger) {
	if database == nil {
		return
	}

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	homeDir, _ := os.UserHomeDir()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 0. History Files (to map sessions to projects)
			processHistoryFile(ctx, database, filepath.Join(homeDir, ".claude", "history.jsonl"), "claude", logger)
			processHistoryFile(ctx, database, filepath.Join(homeDir, ".codex", "history.jsonl"), "codex", logger)

			// 1. Claude Code
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".claude", "projects"), "claude", logger)
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".claude", "logs"), "claude", logger)
			
			// 2. Codex
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".codex", "sessions"), "codex", logger)
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".codex", "log"), "codex", logger)

			// 3. OpenCode
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".opencode", "logs"), "opencode", logger)
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".opencode", "sessions"), "opencode", logger)

			// 4. Gemini CLI
			scanDirectory(ctx, database, manualRoots, filepath.Join(homeDir, ".gemini", "logs"), "gemini", logger)
		}
	}
}

func scanDirectory(ctx context.Context, database *db.DB, manualRoots []string, dir string, provider string, logger zerolog.Logger) {
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

		processFile(ctx, database, manualRoots, path, provider, logger)
		return nil
	})
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
	// Claude paths look like: /home/traves/.claude/projects/-home-traves-repo-name/...
	segments := strings.Split(path, string(os.PathSeparator))
	for _, seg := range segments {
		if strings.HasPrefix(seg, "-home-") || strings.HasPrefix(seg, "-tmp-") || strings.HasPrefix(seg, "-usr-") {
			derived := strings.ReplaceAll(seg, "-", "/")
			if !strings.HasPrefix(derived, "/") {
				derived = "/" + derived
			}
			clean := filepath.Clean(derived)
			if eval, err := filepath.EvalSymlinks(clean); err == nil {
				return eval
			}
			return clean
		}
	}
	return ""
}

func findProjectRoot(ctx context.Context, database *db.DB, path string, manualRoots []string, logger zerolog.Logger) (string, string) {
	cleanPath := filepath.Clean(path)
	if eval, err := filepath.EvalSymlinks(cleanPath); err == nil {
		cleanPath = eval
	}

	// 1. Try Git
	rootPath, remoteURL, err := git.ProjectInfo(ctx, filepath.Dir(cleanPath))
	if err == nil {
		projectID, _ := database.UpsertProject(ctx, rootPath, remoteURL)
		logger.Debug().Str("path", cleanPath).Str("root", rootPath).Str("id", projectID).Msg("found git root")
		return projectID, rootPath
	}

	// 2. Try Manual Roots
	for _, root := range manualRoots {
		absRoot := filepath.Clean(root)
		if eval, err := filepath.EvalSymlinks(absRoot); err == nil {
			absRoot = eval
		}

		if strings.HasPrefix(cleanPath, absRoot) {
			projectID, _ := database.UpsertProject(ctx, absRoot, "local://"+filepath.Base(absRoot))
			logger.Debug().Str("path", cleanPath).Str("root", absRoot).Str("id", projectID).Msg("found manual root")
			return projectID, absRoot
		}
	}

	// 3. Try Deriving from Tool-Specific path
	if derived := deriveProjectFromPath(cleanPath); derived != "" {
		projectID, _ := database.UpsertProject(ctx, derived, "derived://"+filepath.Base(derived))
		logger.Debug().Str("path", cleanPath).Str("derived", derived).Str("id", projectID).Msg("derived project from path")
		return projectID, derived
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
			SessionID string `json:"sessionId"`  // Claude
			Session_ID string `json:"session_id"` // Codex
			Project   string `json:"project"`    // Claude
		}
		if json.Unmarshal([]byte(line), &entry) == nil {
			sid := entry.SessionID
			if sid == "" {
				sid = entry.Session_ID
			}
			if sid != "" && entry.Project != "" {
				projectID, _ := database.UpsertProject(ctx, entry.Project, "")
				logger.Debug().Str("sid", sid).Str("project", entry.Project).Str("id", projectID).Msg("linking session to project from history")
				_ = database.UpdateSessionProject(ctx, sid, projectID)
			}
		}
	}
	saveOffset(ctx, database, path, bytesRead)
}

func processFile(ctx context.Context, database *db.DB, manualRoots []string, path string, provider string, logger zerolog.Logger) {
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

			_ = database.RecordSession(ctx, sid, projectID, sid, provider, "unknown")
			
			if entry.Timestamp != "" {
				eventID := uuid.New().String()
				msg := sanitizePII(entry.Message)
				kind := stripPreamble(entry.Type)
				_ = database.RecordEvent(ctx, eventID, sid, kind, msg, []byte(line), entry.Tokens.Input, entry.Tokens.Output, entry.Timestamp)
			}
		} else {
			// Fallback for plain text .log files
			if len(strings.TrimSpace(line)) > 0 {
				_ = database.RecordSession(ctx, fallbackSessionID, projectID, fallbackSessionID, provider, "unknown")
				eventID := uuid.New().String()
				kind := "log"
				if strings.Contains(strings.ToLower(line), "error") {
					kind = "error"
				}
				_ = database.RecordEvent(ctx, eventID, fallbackSessionID, kind, sanitizePII(line), []byte(line), 0, 0, time.Now().Format(time.RFC3339))
			}
		}
	}

	if err := scanner.Err(); err == nil {
		saveOffset(ctx, database, path, bytesRead)
	}
}
