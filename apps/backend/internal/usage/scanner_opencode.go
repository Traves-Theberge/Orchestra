package usage

import (
	"errors"
	"os"
	"path/filepath"
	"time"
)

// OpenCodeSourceDir returns ~/.opencode/session-logs.
func OpenCodeSourceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".opencode", "session-logs")
}

// scanOpenCode is a stub. OpenCode's local logs (~/.opencode/session-logs)
// only contain hook events, not token totals — token data lives in external
// transcript files referenced inside the hook payloads. Until we wire that,
// we report only whether logs exist; tokens stay zero.
func scanOpenCode(
	now time.Time,
	prevFiles map[string]ProcessedFile,
	prevSessions []Session,
	prevDaily []DailyAggregate,
	worktreeIndex worktreeIndex,
) (
	files []ProcessedFile,
	sessions []Session,
	daily []DailyAggregate,
	sourceExists bool,
	err error,
) {
	root := OpenCodeSourceDir()
	if root == "" {
		return nil, nil, nil, false, nil
	}
	if info, statErr := os.Stat(root); statErr != nil || !info.IsDir() {
		return nil, nil, nil, false, nil
	}
	return nil, nil, nil, true, errors.New("OpenCode usage import is unavailable: transcript token accounting is not implemented")
}
