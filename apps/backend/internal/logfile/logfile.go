package logfile

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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

	logsDir := filepath.Join(workspaceRoot, "_logs", sanitize(issueIdentifier))
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return "", fmt.Errorf("create logs dir: %w", err)
	}

	filePath := filepath.Join(logsDir, sanitize(sessionID)+".log")
	if err := os.WriteFile(filePath, []byte(output), 0o644); err != nil {
		return "", fmt.Errorf("write session log: %w", err)
	}

	_ = ResetLatestLog(workspaceRoot, issueIdentifier, sessionID)

	return filePath, nil
}

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

	logsDir := filepath.Join(workspaceRoot, "_logs", sanitize(issueIdentifier))
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return "", fmt.Errorf("create logs dir: %w", err)
	}

	filePath := filepath.Join(logsDir, sanitize(sessionID)+".log")
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return "", fmt.Errorf("open session log: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(chunk); err != nil {
		return "", fmt.Errorf("append to session log: %w", err)
	}

	return filePath, nil
}

func ResetLatestLog(workspaceRoot string, issueIdentifier string, sessionID string) error {
	logsDir := filepath.Join(workspaceRoot, "_logs", sanitize(issueIdentifier))
	latestPath := filepath.Join(logsDir, "latest.log")
	sessionLogName := sanitize(sessionID) + ".log"

	_ = os.Remove(latestPath)
	return os.Symlink(sessionLogName, latestPath)
}

func sanitize(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(trimmed)
}
