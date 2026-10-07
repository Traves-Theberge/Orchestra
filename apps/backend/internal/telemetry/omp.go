package telemetry

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/rs/zerolog"
)

// ompEntry is the subset of an omp session-file entry ingested as telemetry.
type ompEntry struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Cwd       string `json:"cwd"`
	Message   *struct {
		Role    string          `json:"role"`
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   *struct {
			Input     int `json:"input"`
			Output    int `json:"output"`
			CacheRead int `json:"cacheRead"`
		} `json:"usage"`
	} `json:"message"`
}

// scanOMPSessions ingests ~/.omp/agent/sessions/**.jsonl incrementally via
// ingest_offsets. omp lines carry whole tool results, so lines are read
// without the default scanner's 64 KiB cap, oversized ones are skipped, and
// a trailing partial line is left for the next tick.
func scanOMPSessions(ctx context.Context, database *db.DB, manualRoots []string, dir string, opts Options, logger zerolog.Logger) {
	started := time.Now()
	healthState.addSource("omp")
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return
	}
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".jsonl") || ctx.Err() != nil {
			return nil
		}
		processOMPFile(ctx, database, manualRoots, path, opts, logger)
		return nil
	})
	healthState.markSuccess("omp", started)
}

func processOMPFile(ctx context.Context, database *db.DB, manualRoots []string, path string, opts Options, logger zerolog.Logger) {
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	offset := getOffset(ctx, database, path)
	if info.Size() <= offset {
		if info.Size() < offset {
			saveOffset(ctx, database, path, 0)
		}
		return
	}
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	sessionID, cwd := ompSessionHeader(file, path)
	projectID := matchExistingProject(ctx, database, cwd)
	if projectID == "" {
		projectID, _ = findProjectRoot(ctx, database, path, manualRoots, logger)
	}
	if _, err = file.Seek(offset, io.SeekStart); err != nil {
		return
	}
	reader := bufio.NewReaderSize(file, 256*1024)
	consumed := offset
	recorded := false
	for {
		line, n, complete, readErr := readOMPTelemetryLine(reader)
		if !complete {
			break
		}
		consumed += n
		if line != nil && bytes.Contains(line, []byte(`"type":"message"`)) {
			var entry ompEntry
			if json.Unmarshal(line, &entry) != nil {
				healthState.addParseError("omp")
			} else if entry.Message != nil && (entry.Message.Role == "user" || entry.Message.Role == "assistant") {
				if !recorded || entry.Message.Model != "" {
					_ = database.RecordSession(ctx, sessionID, projectID, "", sessionID, "omp", entry.Message.Model, "unknown")
					recorded = true
				}
				input, output := 0, 0
				if entry.Message.Usage != nil {
					input, output = entry.Message.Usage.Input+entry.Message.Usage.CacheRead, entry.Message.Usage.Output
				}
				var raw []byte
				if opts.StoreRawPayload {
					raw = line
				}
				timestamp := entry.Timestamp
				if timestamp == "" {
					timestamp = time.Now().UTC().Format(time.RFC3339)
				}
				_ = database.RecordEvent(ctx, uuid.New().String(), sessionID, entry.Message.Role, sanitizePII(ompContentText(entry.Message.Content)), raw, input, output, timestamp)
				healthState.addEvent("omp", 1)
			}
		}
		if readErr != nil {
			break
		}
	}
	saveOffset(ctx, database, path, consumed)
}

// ompSessionHeader reads the session id and cwd from the file's header
// entry. Subagent files without a header fall back to a path-derived id.
func ompSessionHeader(file *os.File, path string) (string, string) {
	reader := bufio.NewReaderSize(io.LimitReader(file, 1<<20), 64*1024)
	for i := 0; i < 8; i++ {
		line, _, complete, err := readOMPTelemetryLine(reader)
		if line != nil && bytes.Contains(line, []byte(`"type":"session"`)) {
			var entry ompEntry
			if json.Unmarshal(line, &entry) == nil && entry.ID != "" {
				return entry.ID, entry.Cwd
			}
		}
		if !complete || err != nil {
			break
		}
	}
	sum := sha256.Sum256([]byte(path))
	return "omp-" + hex.EncodeToString(sum[:12]), ""
}

// readOMPTelemetryLine returns one newline-terminated line and its byte
// length. Lines over 8 MiB return a nil line but still advance the offset;
// complete is false when the data ends without a newline.
func readOMPTelemetryLine(reader *bufio.Reader) (line []byte, n int64, complete bool, err error) {
	oversized := false
	for {
		chunk, readErr := reader.ReadSlice('\n')
		n += int64(len(chunk))
		if !oversized {
			if len(line)+len(chunk) > 8<<20 {
				oversized, line = true, nil
			} else {
				line = append(line, chunk...)
			}
		}
		if readErr == nil {
			if oversized {
				return nil, n, true, nil
			}
			return bytes.TrimRight(line, "\r\n"), n, true, nil
		}
		if errors.Is(readErr, bufio.ErrBufferFull) {
			continue
		}
		return nil, n, false, readErr
	}
}

func ompContentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return truncateOMPText(text)
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	for _, part := range parts {
		if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
			return truncateOMPText(part.Text)
		}
	}
	return ""
}

func truncateOMPText(text string) string {
	if len(text) > 2000 {
		return text[:2000]
	}
	return text
}
