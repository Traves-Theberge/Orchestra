// Package logfile provides functions for writing and managing agent session log files
// within workspace directories.
package logfile

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WriteSessionLog writes the complete session output to a log file under the workspace
// logs directory and updates the latest.log symlink. Returns the file path.
func WriteSessionLog(workspaceRoot string, issueIdentifier string, sessionID string, output string) (string, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return "", fmt.Errorf("workspace root is required")
	}
	if strings.TrimSpace(issueIdentifier) == "" {
		return "", fmt.Errorf("issue identifier is required")
	}
	if strings.TrimSpace(sessionID) == "" {
		sessionID = fmt.Sprintf("session-%d", time.Now().UnixNano())
	}

	logsDir := filepath.Join(workspaceRoot, "_logs", Sanitize(issueIdentifier))
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return "", fmt.Errorf("create logs dir: %w", err)
	}

	filePath := filepath.Join(logsDir, Sanitize(sessionID)+".log")
	if err := os.WriteFile(filePath, []byte(output), 0o644); err != nil {
		return "", fmt.Errorf("write session log: %w", err)
	}

	_ = ResetLatestLog(workspaceRoot, issueIdentifier, sessionID)

	return filePath, nil
}

// AppendToSessionLog appends a chunk of output to an existing session log file,
// creating it if necessary. Returns the file path.
func AppendToSessionLog(workspaceRoot string, issueIdentifier string, sessionID string, chunk string) (string, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return "", fmt.Errorf("workspace root is required")
	}
	if strings.TrimSpace(issueIdentifier) == "" {
		return "", fmt.Errorf("issue identifier is required")
	}
	if strings.TrimSpace(sessionID) == "" {
		return "", fmt.Errorf("session id is required")
	}

	logsDir := filepath.Join(workspaceRoot, "_logs", Sanitize(issueIdentifier))
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return "", fmt.Errorf("create logs dir: %w", err)
	}

	filePath := filepath.Join(logsDir, Sanitize(sessionID)+".log")
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return "", fmt.Errorf("open session log: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(chunk); err != nil {
		return "", fmt.Errorf("append to session log: %w", err)
	}
	if _, err := os.Stat(filepath.Join(logsDir, "latest.log")); os.IsNotExist(err) {
		_ = ResetLatestLog(workspaceRoot, issueIdentifier, sessionID)
	}

	return filePath, nil
}

// ResetLatestLog updates the latest.log symlink to point to the session log file
// for the given session ID.
func ResetLatestLog(workspaceRoot string, issueIdentifier string, sessionID string) error {
	logsDir := filepath.Join(workspaceRoot, "_logs", Sanitize(issueIdentifier))
	latestPath := filepath.Join(logsDir, "latest.log")
	sessionLogName := Sanitize(sessionID) + ".log"

	_ = os.Remove(latestPath)
	if err := os.Symlink(sessionLogName, latestPath); err == nil {
		return nil
	}
	// Hard links require no symlink privilege on Windows and remain live as the
	// session file is appended. Both names live on the same filesystem.
	return os.Link(filepath.Join(logsDir, sessionLogName), latestPath)
}

// Sanitize replaces filesystem-unsafe characters in the given value with underscores,
// returning "unknown" for empty input.
func Sanitize(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(trimmed)
}
