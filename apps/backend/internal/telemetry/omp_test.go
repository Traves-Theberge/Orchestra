package telemetry

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/rs/zerolog"
)

func TestScanOMPSessionsIngestsIncrementallyAndWaitsForPartialLines(t *testing.T) {
	ctx := context.Background()
	warehouse, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	root := filepath.Join(t.TempDir(), "sessions")
	dir := filepath.Join(root, "-work-demo")
	if err = os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "2026-10-07T20-52-20-984Z_omp-s-1.jsonl")
	// Synthetic entries in omp 18.7 session-file shapes.
	head := `{"type":"title","v":1,"title":"demo"}
{"type":"session","version":3,"id":"omp-s-1","timestamp":"2026-10-07T20:52:20.984Z","cwd":"/work/demo"}
{"type":"message","id":"a","timestamp":"2026-10-07T20:52:21Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
{"type":"message","id":"b","timestamp":"2026-10-07T20:52:22Z","message":{"role":"toolResult","content":[{"type":"text","text":"` + strings.Repeat("x", 100_000) + `"}]}}
{"type":"message","id":"c","timestamp":"2026-10-07T20:52:23Z","message":{"role":"assistant","model":"gpt-x","content":[{"type":"text","text":"done"}],"usage":{"input":30,"output":6,"cacheRead":70}}}
`
	partial := `{"type":"message","id":"d","timestamp":"2026-10-07T20:52:30Z","message":{"role":"assistant","model":"gpt-x","content":[],"usage":{"input":1,"output":1}}}`
	if err = os.WriteFile(path, []byte(head+partial), 0o644); err != nil {
		t.Fatal(err)
	}
	scanOMPSessions(ctx, warehouse, nil, root, Options{}, zerolog.Nop())
	if got := countSessionEvents(t, warehouse, "omp-s-1"); got != 2 {
		t.Fatalf("expected user+assistant events (partial line deferred), got %d", got)
	}
	var input, output int
	if err = warehouse.QueryRow("SELECT input_tokens, output_tokens FROM events WHERE session_id=? AND kind='assistant'", "omp-s-1").Scan(&input, &output); err != nil || input != 100 || output != 6 {
		t.Fatalf("assistant tokens %d/%d, %v", input, output, err)
	}
	var provider, model string
	if err = warehouse.QueryRow("SELECT provider, COALESCE(model,'') FROM sessions WHERE id=?", "omp-s-1").Scan(&provider, &model); err != nil || provider != "omp" || model != "gpt-x" {
		t.Fatalf("session row %q %q, %v", provider, model, err)
	}
	scanOMPSessions(ctx, warehouse, nil, root, Options{}, zerolog.Nop())
	if got := countSessionEvents(t, warehouse, "omp-s-1"); got != 2 {
		t.Fatalf("rescan must be idempotent, got %d", got)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString("\n")
	_ = f.Close()
	scanOMPSessions(ctx, warehouse, nil, root, Options{}, zerolog.Nop())
	if got := countSessionEvents(t, warehouse, "omp-s-1"); got != 3 {
		t.Fatalf("completed line must be ingested once, got %d", got)
	}
}

func TestReadOMPTelemetryLineSkipsOversizedLines(t *testing.T) {
	data := strings.Repeat("y", 9<<20) + "\n{\"ok\":1}\n"
	reader := bufio.NewReaderSize(strings.NewReader(data), 64*1024)
	line, n, complete, err := readOMPTelemetryLine(reader)
	if line != nil || !complete || err != nil || n != int64(9<<20+1) {
		t.Fatalf("oversized line: %d bytes, complete=%v err=%v n=%d", len(line), complete, err, n)
	}
	line, _, complete, _ = readOMPTelemetryLine(reader)
	if string(line) != `{"ok":1}` || !complete {
		t.Fatalf("next line %q", line)
	}
}
