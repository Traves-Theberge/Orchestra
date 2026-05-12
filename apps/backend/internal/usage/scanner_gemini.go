package usage

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// GeminiSourceDir returns ~/.gemini/tmp.
func GeminiSourceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".gemini", "tmp")
}

type geminiChatFile struct {
	SessionID   string          `json:"sessionId"`
	StartTime   string          `json:"startTime"`
	LastUpdated string          `json:"lastUpdated"`
	ProjectHash string          `json:"projectHash"`
	ProjectPath string          `json:"projectPath"`
	Messages    []geminiMessage `json:"messages"`
}

type geminiMessage struct {
	Type      string        `json:"type"` // "user" | "gemini"
	Model     string        `json:"model"`
	Timestamp string        `json:"timestamp"`
	Tokens    *geminiTokens `json:"tokens,omitempty"`
}

type geminiTokens struct {
	Input    int64 `json:"input"`
	Output   int64 `json:"output"`
	Cached   int64 `json:"cached"`
	Thoughts int64 `json:"thoughts"`
	Tool     int64 `json:"tool"`
	Total    int64 `json:"total"`
}

// scanGemini walks ~/.gemini/tmp/<projectHash>/chats/*.json. Each chat file
// is one session.
func scanGemini(
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
	root := GeminiSourceDir()
	if root == "" {
		return nil, nil, nil, false, errors.New("could not resolve home directory")
	}
	if info, statErr := os.Stat(root); statErr != nil || !info.IsDir() {
		return nil, nil, nil, false, nil
	}
	sourceExists = true

	var jsonFiles []string
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// Per Gemini layout: tmp/<hash>/chats/session-*.json
		if !strings.HasSuffix(path, ".json") {
			return nil
		}
		if !strings.Contains(path, string(os.PathSeparator)+"chats"+string(os.PathSeparator)) {
			return nil
		}
		jsonFiles = append(jsonFiles, path)
		return nil
	})
	if walkErr != nil {
		return nil, nil, nil, true, walkErr
	}

	dailyKey := func(d, m, p string) string { return d + "::" + m + "::" + p }
	dailyAcc := map[string]*DailyAggregate{}

	for _, path := range jsonFiles {
		fi, statErr := os.Stat(path)
		if statErr != nil {
			continue
		}
		files = append(files, ProcessedFile{
			Path:    path,
			MtimeMs: fi.ModTime().UnixMilli(),
			Size:    fi.Size(),
		})

		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			continue
		}
		var chat geminiChatFile
		if jerr := json.Unmarshal(raw, &chat); jerr != nil {
			continue
		}
		if chat.SessionID == "" || len(chat.Messages) == 0 {
			continue
		}

		// Determine project label — Gemini's projectHash is opaque, so we
		// fall back to projectPath when present, otherwise to the hash.
		var projKey, projLabel, worktreeID, repoID string
		if chat.ProjectPath != "" {
			projKey, projLabel, worktreeID, repoID = worktreeIndex.resolve(chat.ProjectPath)
		} else if chat.ProjectHash != "" {
			projKey = "hash:" + chat.ProjectHash
			projLabel = "Gemini project " + shortHash(chat.ProjectHash)
		} else {
			projKey = "unknown"
			projLabel = "Unknown location"
		}

		sess := Session{
			Provider:     ProviderGemini,
			SessionID:    chat.SessionID,
			ProjectKey:   projKey,
			ProjectLabel: projLabel,
			WorktreeID:   worktreeID,
			RepoID:       repoID,
		}
		var lastModel string
		var firstTs, lastTs time.Time
		for _, msg := range chat.Messages {
			ts, _ := time.Parse(time.RFC3339Nano, msg.Timestamp)
			if !ts.IsZero() {
				if firstTs.IsZero() || ts.Before(firstTs) {
					firstTs = ts
				}
				if ts.After(lastTs) {
					lastTs = ts
				}
			}
			if msg.Type != "gemini" || msg.Tokens == nil {
				continue
			}
			tok := msg.Tokens
			if tok.Input+tok.Output+tok.Thoughts == 0 {
				continue
			}
			model := msg.Model
			if model == "" {
				model = lastModel
			}
			lastModel = model

			sess.TurnCount++
			sess.InputTokens += tok.Input
			sess.CachedInputTokens += tok.Cached
			sess.OutputTokens += tok.Output
			sess.ReasoningTokens += tok.Thoughts

			normModel := normalizeModel(ProviderGemini, model)
			_, foundPrice := pricingByProvider[ProviderGemini].models[normModel]
			if !foundPrice {
				sess.HasInferredPricing = true
			}
			if sess.PrimaryModel == "" {
				sess.PrimaryModel = model
			} else if model != "" && model != sess.PrimaryModel {
				sess.HasMixedModels = true
			}

			day := ts.UTC().Format("2006-01-02")
			if day == "0001-01-01" {
				continue
			}
			k := dailyKey(day, normModel, projKey)
			d, dexists := dailyAcc[k]
			if !dexists {
				d = &DailyAggregate{
					Provider:     ProviderGemini,
					Day:          day,
					Model:        normModel,
					ProjectKey:   projKey,
					ProjectLabel: projLabel,
					WorktreeID:   worktreeID,
					RepoID:       repoID,
				}
				dailyAcc[k] = d
			}
			d.TurnCount++
			d.InputTokens += tok.Input
			d.CachedInputTokens += tok.Cached
			d.OutputTokens += tok.Output
			d.ReasoningTokens += tok.Thoughts
			if !foundPrice {
				d.HasInferredPricing = true
			}
		}
		sess.FirstTimestamp = firstTs
		sess.LastTimestamp = lastTs
		if sess.TurnCount > 0 {
			sessions = append(sessions, sess)
		}
	}
	for _, d := range dailyAcc {
		daily = append(daily, *d)
	}
	return files, sessions, daily, true, nil
}

func shortHash(h string) string {
	if len(h) > 7 {
		return h[:7]
	}
	return h
}
