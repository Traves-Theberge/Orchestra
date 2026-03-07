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

	latestPath := filepath.Join(logsDir, "latest.log")
	_ = os.WriteFile(latestPath, []byte(output), 0o644)

	return filePath, nil
}

func sanitize(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(trimmed)
}
