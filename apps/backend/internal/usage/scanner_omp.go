package usage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// OMPSourceDir returns ~/.omp/agent/sessions, where omp writes one JSONL file
// per session (subagent sessions nest under their parent's directory).
func OMPSourceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".omp", "agent", "sessions")
}

// ompSessionLine is the subset of an omp session entry the scanner needs:
// the {"type":"session"} header (id, cwd) and {"type":"message"} entries
// whose assistant messages carry usage and omp's own per-message cost.
type ompSessionLine struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Cwd       string `json:"cwd"`
	Message   *struct {
		Role      string `json:"role"`
		Provider  string `json:"provider"`
		Model     string `json:"model"`
		Timestamp int64  `json:"timestamp"`
		Usage     *struct {
			Input           int64 `json:"input"`
			Output          int64 `json:"output"`
			CacheRead       int64 `json:"cacheRead"`
			CacheWrite      int64 `json:"cacheWrite"`
			ReasoningTokens int64 `json:"reasoningTokens"`
			Cost            *struct {
				Total float64 `json:"total"`
			} `json:"cost"`
		} `json:"usage"`
	} `json:"message"`
}

// scanOMP walks omp session JSONL files. Lines are streamed and only the
// session header and assistant messages are decoded, because tool results
// make these files large. Cost comes from omp's recorded per-message cost,
// which already reflects each provider's pricing.
func scanOMP(
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
	root := OMPSourceDir()
	if root == "" {
		return nil, nil, nil, false, errors.New("could not resolve home directory")
	}
	return scanOMPRoot(root, worktreeIndex)
}

func scanOMPRoot(root string, worktreeIndex worktreeIndex) (files []ProcessedFile, sessions []Session, daily []DailyAggregate, sourceExists bool, err error) {
	if info, statErr := os.Stat(root); statErr != nil || !info.IsDir() {
		return nil, nil, nil, false, nil
	}
	var paths []string
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e == nil && !d.IsDir() && strings.HasSuffix(path, ".jsonl") {
			paths = append(paths, path)
		}
		return nil
	})
	if walkErr != nil {
		return nil, nil, nil, true, walkErr
	}
	dailyAcc := map[string]*DailyAggregate{}
	for _, path := range paths {
		fi, statErr := os.Stat(path)
		if statErr != nil {
			continue
		}
		files = append(files, ProcessedFile{Path: path, MtimeMs: fi.ModTime().UnixMilli(), Size: fi.Size()})
		if sess, ok := scanOMPFile(path, worktreeIndex, dailyAcc); ok {
			sessions = append(sessions, sess)
		}
	}
	for _, d := range dailyAcc {
		daily = append(daily, *d)
	}
	return files, sessions, daily, true, nil
}

func scanOMPFile(path string, worktreeIndex worktreeIndex, dailyAcc map[string]*DailyAggregate) (Session, bool) {
	f, err := os.Open(path)
	if err != nil {
		return Session{}, false
	}
	defer f.Close()
	sess := Session{Provider: ProviderOMP, ProjectKey: "unknown", ProjectLabel: "Unknown location"}
	var cost float64
	costKnown := true
	reader := bufio.NewReaderSize(f, 256*1024)
	for {
		line, readErr := readOMPLine(reader)
		if len(line) > 0 && (bytes.Contains(line, []byte(`"type":"session"`)) || bytes.Contains(line, []byte(`"role":"assistant"`))) {
			var entry ompSessionLine
			if json.Unmarshal(line, &entry) == nil {
				switch {
				case entry.Type == "session" && sess.SessionID == "":
					sess.SessionID = entry.ID
					if entry.Cwd != "" {
						sess.ProjectKey, sess.ProjectLabel, sess.WorktreeID, sess.RepoID = worktreeIndex.resolve(entry.Cwd)
					}
					if ts, parseErr := time.Parse(time.RFC3339Nano, entry.Timestamp); parseErr == nil {
						sess.FirstTimestamp, sess.LastTimestamp = ts, ts
					}
				case entry.Type == "message" && entry.Message != nil && entry.Message.Role == "assistant" && entry.Message.Usage != nil:
					addOMPMessage(&sess, entry, &cost, &costKnown, dailyAcc)
				}
			}
		}
		if readErr != nil {
			break
		}
	}
	if sess.SessionID == "" || sess.TurnCount == 0 {
		return Session{}, false
	}
	if costKnown {
		sess.RecordedCostUSD = &cost
	}
	return sess, true
}

// readOMPLine returns one line; lines over 8 MiB (large tool output) are
// skipped, since assistant usage entries are small.
func readOMPLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		chunk, isPrefix, err := reader.ReadLine()
		if err != nil {
			return line, err
		}
		if len(line)+len(chunk) <= 8<<20 {
			line = append(line, chunk...)
		} else {
			for isPrefix {
				if _, isPrefix, err = reader.ReadLine(); err != nil {
					return nil, err
				}
			}
			return []byte{}, nil
		}
		if !isPrefix {
			return line, nil
		}
	}
}

func addOMPMessage(sess *Session, entry ompSessionLine, cost *float64, costKnown *bool, dailyAcc map[string]*DailyAggregate) {
	msg := entry.Message
	u := msg.Usage
	if u.Input+u.Output+u.CacheRead+u.CacheWrite == 0 {
		return
	}
	ts := time.UnixMilli(msg.Timestamp).UTC()
	if msg.Timestamp == 0 {
		ts, _ = time.Parse(time.RFC3339Nano, entry.Timestamp)
	}
	if !ts.IsZero() {
		if sess.FirstTimestamp.IsZero() || ts.Before(sess.FirstTimestamp) {
			sess.FirstTimestamp = ts
		}
		if ts.After(sess.LastTimestamp) {
			sess.LastTimestamp = ts
		}
	}
	// omp routes one model through several providers; the selector keeps
	// that distinction visible in the model breakdown.
	model := strings.ToLower(strings.TrimSpace(msg.Model))
	if msg.Provider != "" && model != "" {
		model = strings.ToLower(msg.Provider) + "/" + model
	}
	sess.TurnCount++
	sess.InputTokens += u.Input
	sess.OutputTokens += u.Output
	sess.CacheReadTokens += u.CacheRead
	sess.CacheWriteTokens += u.CacheWrite
	sess.ReasoningTokens += u.ReasoningTokens
	if sess.PrimaryModel == "" {
		sess.PrimaryModel = model
	} else if model != "" && model != sess.PrimaryModel {
		sess.HasMixedModels = true
	}
	messageCost := 0.0
	if u.Cost != nil {
		messageCost = u.Cost.Total
		*cost += messageCost
	} else {
		*costKnown = false
		sess.HasInferredPricing = true
	}
	day := ts.Format("2006-01-02")
	if ts.IsZero() {
		return
	}
	key := day + "::" + model + "::" + sess.ProjectKey
	d, ok := dailyAcc[key]
	if !ok {
		zero := 0.0
		d = &DailyAggregate{Provider: ProviderOMP, Day: day, Model: model, ProjectKey: sess.ProjectKey, ProjectLabel: sess.ProjectLabel, WorktreeID: sess.WorktreeID, RepoID: sess.RepoID, RecordedCostUSD: &zero}
		dailyAcc[key] = d
	}
	d.TurnCount++
	if u.CacheRead == 0 {
		d.ZeroCacheReadTurns++
	}
	d.InputTokens += u.Input
	d.OutputTokens += u.Output
	d.CacheReadTokens += u.CacheRead
	d.CacheWriteTokens += u.CacheWrite
	d.ReasoningTokens += u.ReasoningTokens
	if u.Cost != nil && d.RecordedCostUSD != nil {
		*d.RecordedCostUSD += messageCost
	} else {
		d.RecordedCostUSD = nil
		d.HasInferredPricing = true
	}
}
