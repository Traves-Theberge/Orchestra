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

// CodexSourceDir returns ~/.codex/sessions, or $CODEX_HOME/sessions if set.
func CodexSourceDir() string {
	if codexHome := os.Getenv("CODEX_HOME"); codexHome != "" {
		return filepath.Join(codexHome, "sessions")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".codex", "sessions")
}

// codexJSONLRecord — Codex emits multiple record kinds in the same JSONL
// stream. We only care about the three Orca processes.
type codexJSONLRecord struct {
	Kind      string          `json:"kind"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type codexSessionMeta struct {
	SessionID string `json:"session_id"`
	Cwd       string `json:"cwd"`
}

type codexTurnContext struct {
	Cwd   string `json:"cwd"`
	Model string `json:"model"`
}

type codexEventMsg struct {
	Type            string                 `json:"type"`
	TotalTokenUsage *codexTokenSnapshot    `json:"total_token_usage,omitempty"`
	LastTokenUsage  *codexTokenSnapshot    `json:"last_token_usage,omitempty"`
	_               map[string]interface{} `json:"-"`
}

type codexTokenSnapshot struct {
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
	TotalTokens           int64 `json:"total_tokens"`
}

// scanCodex walks $CODEX_HOME/sessions and produces sessions + daily
// aggregates. Codex emits *cumulative* token snapshots, so deltas are
// computed per session per record.
func scanCodex(
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
	root := CodexSourceDir()
	if root == "" {
		return nil, nil, nil, false, errors.New("could not resolve home directory")
	}
	if info, statErr := os.Stat(root); statErr != nil || !info.IsDir() {
		return nil, nil, nil, false, nil
	}
	sourceExists = true

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
	sessByID := map[string]*Session{}
	// Daily accumulator keyed by day+model+project.
	dailyKey := func(d, m, p string) string { return d + "::" + m + "::" + p }
	dailyAcc := map[string]*DailyAggregate{}

	for _, path := range jsonlFiles {
		fi, statErr := os.Stat(path)
		if statErr != nil {
			continue
		}
		files = append(files, ProcessedFile{
			Path:    path,
			MtimeMs: fi.ModTime().UnixMilli(),
			Size:    fi.Size(),
		})
		f, openErr := os.Open(path)
		if openErr != nil {
			continue
		}

		// File-local state — Codex deltas are cumulative within a session.
		var (
			fileSessionID string
			fileCwd       string
			fileModel     string
			prevTotals    codexTokenSnapshot
			haveTotals    bool
		)

		scanner := bufio.NewScanner(f)
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 64*1024*1024)

		for scanner.Scan() {
			var rec codexJSONLRecord
			if jerr := json.Unmarshal(scanner.Bytes(), &rec); jerr != nil {
				continue
			}
			ts, tsErr := time.Parse(time.RFC3339Nano, rec.Timestamp)
			if tsErr != nil {
				continue
			}

			switch rec.Kind {
			case "session_meta":
				var meta codexSessionMeta
				if json.Unmarshal(rec.Payload, &meta) == nil {
					fileSessionID = meta.SessionID
					fileCwd = meta.Cwd
				}
			case "turn_context":
				var ctx codexTurnContext
				if json.Unmarshal(rec.Payload, &ctx) == nil {
					if ctx.Cwd != "" {
						fileCwd = ctx.Cwd
					}
					if ctx.Model != "" {
						fileModel = ctx.Model
					}
				}
			case "event_msg":
				var ev codexEventMsg
				if json.Unmarshal(rec.Payload, &ev) != nil {
					continue
				}
				if ev.Type != "token_count" {
					continue
				}
				var snap codexTokenSnapshot
				switch {
				case ev.TotalTokenUsage != nil:
					snap = *ev.TotalTokenUsage
				case ev.LastTokenUsage != nil:
					snap = *ev.LastTokenUsage
				default:
					continue
				}

				// Compute delta from previous total.
				var delta codexTokenSnapshot
				if haveTotals {
					delta = codexTokenSnapshot{
						InputTokens:           max64(0, snap.InputTokens-prevTotals.InputTokens),
						CachedInputTokens:     max64(0, snap.CachedInputTokens-prevTotals.CachedInputTokens),
						OutputTokens:          max64(0, snap.OutputTokens-prevTotals.OutputTokens),
						ReasoningOutputTokens: max64(0, snap.ReasoningOutputTokens-prevTotals.ReasoningOutputTokens),
						TotalTokens:           max64(0, snap.TotalTokens-prevTotals.TotalTokens),
					}
				} else {
					delta = snap
				}
				prevTotals = snap
				haveTotals = true

				// Clamp cached <= input.
				if delta.CachedInputTokens > delta.InputTokens {
					delta.CachedInputTokens = delta.InputTokens
				}
				if delta.InputTokens+delta.OutputTokens+delta.ReasoningOutputTokens == 0 {
					continue
				}

				sessionID := fileSessionID
				if sessionID == "" {
					sessionID = path
				}
				model := fileModel
				if model == "" {
					model = "gpt-5"
				}
				cwd := fileCwd

				projectKey, projectLabel, worktreeID, repoID := worktreeIndex.resolve(cwd)

				s, ok := sessByID[sessionID]
				if !ok {
					s = &Session{
						Provider:       ProviderCodex,
						SessionID:      sessionID,
						FirstTimestamp: ts,
						PrimaryModel:   model,
						ProjectKey:     projectKey,
						ProjectLabel:   projectLabel,
						WorktreeID:     worktreeID,
						RepoID:         repoID,
					}
					sessByID[sessionID] = s
				}
				if ts.Before(s.FirstTimestamp) {
					s.FirstTimestamp = ts
				}
				if ts.After(s.LastTimestamp) {
					s.LastTimestamp = ts
				}
				if model != s.PrimaryModel {
					s.HasMixedModels = true
				}
				s.TurnCount++
				s.InputTokens += delta.InputTokens
				s.CachedInputTokens += delta.CachedInputTokens
				s.OutputTokens += delta.OutputTokens
				s.ReasoningTokens += delta.ReasoningOutputTokens

				normModel := normalizeModel(ProviderCodex, model)
				_, foundPrice := pricingByProvider[ProviderCodex].models[normModel]
				if !foundPrice {
					s.HasInferredPricing = true
				}

				day := ts.UTC().Format("2006-01-02")
				k := dailyKey(day, normModel, projectKey)
				d, dexists := dailyAcc[k]
				if !dexists {
					d = &DailyAggregate{
						Provider:     ProviderCodex,
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
				d.InputTokens += delta.InputTokens
				d.CachedInputTokens += delta.CachedInputTokens
				d.OutputTokens += delta.OutputTokens
				d.ReasoningTokens += delta.ReasoningOutputTokens
				if !foundPrice {
					d.HasInferredPricing = true
				}
			}
		}
		_ = scanner.Err()
		_ = f.Close()
	}

	for _, s := range sessByID {
		sessions = append(sessions, *s)
	}
	for _, d := range dailyAcc {
		daily = append(daily, *d)
	}
	return files, sessions, daily, true, nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
