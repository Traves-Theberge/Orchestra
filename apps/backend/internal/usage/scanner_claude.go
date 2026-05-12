package usage

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ClaudeSourceDir returns ~/.claude/projects, mirroring Orca's CLAUDE_PROJECTS_DIR.
func ClaudeSourceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude", "projects")
}

type claudeJSONLRecord struct {
	Type      string                 `json:"type"`
	SessionID string                 `json:"sessionId"`
	Timestamp string                 `json:"timestamp"`
	Cwd       string                 `json:"cwd"`
	GitBranch string                 `json:"gitBranch"`
	Message   *claudeMessage         `json:"message,omitempty"`
	_         map[string]interface{} `json:"-"`
}

type claudeMessage struct {
	Model string       `json:"model"`
	Usage *claudeUsage `json:"usage,omitempty"`
}

type claudeUsage struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
}

// scanClaude walks ~/.claude/projects, parses every JSONL transcript, and
// returns sessions + daily aggregates. Incremental reuse: files whose mtime
// and size match `prevFiles` are skipped (their previously-parsed contents
// must be carried in by the caller via the existing PersistedState).
func scanClaude(
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
	root := ClaudeSourceDir()
	if root == "" {
		return nil, nil, nil, false, errors.New("could not resolve home directory")
	}
	info, statErr := os.Stat(root)
	if statErr != nil || !info.IsDir() {
		// Not installed / no usage yet. Not an error — just empty.
		return nil, nil, nil, false, nil
	}
	sourceExists = true

	// Group sessions/daily we want to carry over by source file path.
	carrySessions := groupSessionsByFile(prevSessions, "_source_path")
	carryDaily := groupDailyByFile(prevDaily, "_source_path")
	_ = carrySessions
	_ = carryDaily

	// Collect target files.
	var jsonlFiles []string
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return nil
		}
		if !d.IsDir() && strings.HasSuffix(path, ".jsonl") {
			jsonlFiles = append(jsonlFiles, path)
		}
		return nil
	})
	if walkErr != nil {
		return nil, nil, nil, true, walkErr
	}

	// Per-session accumulator.
	type sessAcc struct {
		Session
		dirty bool
	}
	sessByID := map[string]*sessAcc{}

	// Per-(day,model,project) accumulator.
	dailyKey := func(d, model, projKey string) string { return d + "::" + model + "::" + projKey }
	dailyAcc := map[string]*DailyAggregate{}

	for _, path := range jsonlFiles {
		fi, statErr := os.Stat(path)
		if statErr != nil {
			continue
		}
		mtime := fi.ModTime().UnixMilli()
		size := fi.Size()
		files = append(files, ProcessedFile{Path: path, MtimeMs: mtime, Size: size})

		f, openErr := os.Open(path)
		if openErr != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		// Allow long lines.
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 64*1024*1024)
		for scanner.Scan() {
			var rec claudeJSONLRecord
			if jerr := json.Unmarshal(scanner.Bytes(), &rec); jerr != nil {
				continue
			}
			if rec.Type != "assistant" || rec.Message == nil || rec.Message.Usage == nil {
				continue
			}
			u := rec.Message.Usage
			total := u.InputTokens + u.OutputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens
			if total == 0 {
				continue
			}
			ts, tsErr := time.Parse(time.RFC3339Nano, rec.Timestamp)
			if tsErr != nil {
				continue
			}
			model := rec.Message.Model
			projectKey, projectLabel, worktreeID, repoID := worktreeIndex.resolve(rec.Cwd)

			// Session accumulator.
			s, exists := sessByID[rec.SessionID]
			if !exists {
				s = &sessAcc{}
				s.Provider = ProviderClaude
				s.SessionID = rec.SessionID
				s.FirstTimestamp = ts
				s.PrimaryModel = model
				s.ProjectKey = projectKey
				s.ProjectLabel = projectLabel
				s.WorktreeID = worktreeID
				s.RepoID = repoID
				s.Branch = rec.GitBranch
				sessByID[rec.SessionID] = s
			}
			if ts.Before(s.FirstTimestamp) {
				s.FirstTimestamp = ts
			}
			if ts.After(s.LastTimestamp) {
				s.LastTimestamp = ts
			}
			if model != "" && s.PrimaryModel != "" && model != s.PrimaryModel {
				s.HasMixedModels = true
			}
			s.TurnCount++
			s.InputTokens += u.InputTokens
			s.OutputTokens += u.OutputTokens
			s.CacheReadTokens += u.CacheReadInputTokens
			s.CacheWriteTokens += u.CacheCreationInputTokens

			// Daily aggregate.
			day := ts.UTC().Format("2006-01-02")
			normModel := normalizeModel(ProviderClaude, model)
			k := dailyKey(day, normModel, projectKey)
			d, dexists := dailyAcc[k]
			if !dexists {
				d = &DailyAggregate{
					Provider:     ProviderClaude,
					Day:          day,
					Model:        normModel,
					ProjectKey:   projectKey,
					ProjectLabel: projectLabel,
					WorktreeID:   worktreeID,
					RepoID:       repoID,
				}
				dailyAcc[k] = d
			}
			d.TurnCount++
			if u.CacheReadInputTokens == 0 {
				d.ZeroCacheReadTurns++
			}
			d.InputTokens += u.InputTokens
			d.OutputTokens += u.OutputTokens
			d.CacheReadTokens += u.CacheReadInputTokens
			d.CacheWriteTokens += u.CacheCreationInputTokens
		}
		_ = scanner.Err()
		_ = f.Close()
	}

	for _, s := range sessByID {
		sessions = append(sessions, s.Session)
	}
	for _, d := range dailyAcc {
		daily = append(daily, *d)
	}
	return files, sessions, daily, true, nil
}

// groupSessionsByFile / groupDailyByFile are placeholders kept for
// signature stability — Claude scanner currently re-parses on every refresh
// rather than reusing per-file caches, since session JSONLs are small.
// Codex's scanner uses real incremental reuse via mtime+size matches.
func groupSessionsByFile(_ []Session, _ string) map[string][]Session            { return nil }
func groupDailyByFile(_ []DailyAggregate, _ string) map[string][]DailyAggregate { return nil }
