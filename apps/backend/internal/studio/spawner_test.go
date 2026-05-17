package studio

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func initRepoForSpawn(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	must := func(name string, args ...string) {
		c := exec.Command(name, args...)
		c.Dir = dir
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, string(out))
		}
	}
	must("git", "init")
	must("git", "config", "user.email", "t@t")
	must("git", "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("x"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	must("git", "add", ".")
	must("git", "commit", "-m", "init")
	return dir
}

type fakeRegistryForSpawn struct {
	turns []agents.TurnRequest
	hook  func(agents.TurnRequest)
}

func (f *fakeRegistryForSpawn) RunTurn(_ context.Context, _ agents.Provider, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	f.turns = append(f.turns, req)
	if f.hook != nil {
		f.hook(req)
	}
	return agents.TurnResult{}, nil
}

func TestSpawn_WritesMCPConfigInWorktree(t *testing.T) {
	repo := initRepoForSpawn(t)
	reg := &fakeRegistryForSpawn{}
	sp := NewStudioSpawner(reg, "/usr/bin/orchestrad", "/tmp/studio.sock")

	if err := sp.Spawn(context.Background(), Session{ID: "sess1", Runner: "claude-code", RepoPath: repo}, func(Event) {}); err != nil {
		t.Fatalf("spawn: %v", err)
	}

	sp.mu.Lock()
	st := sp.sessions["sess1"]
	sp.mu.Unlock()
	if st == nil {
		t.Fatalf("no session recorded")
	}

	cfgPath := filepath.Join(st.worktree.Path, ".mcp.json")
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read mcp config: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("parse mcp config: %v", err)
	}
	servers, ok := cfg["mcpServers"].(map[string]any)
	if !ok {
		t.Fatalf("mcpServers missing: %s", string(raw))
	}
	entry, ok := servers["orchestra-studio"].(map[string]any)
	if !ok {
		t.Fatalf("orchestra-studio server missing: %s", string(raw))
	}
	if entry["command"] != "/usr/bin/orchestrad" {
		t.Fatalf("command=%v", entry["command"])
	}
	args, _ := entry["args"].([]any)
	foundSession := false
	for _, a := range args {
		if a == "sess1" {
			foundSession = true
		}
	}
	if !foundSession {
		t.Fatalf("args missing session id: %v", args)
	}

	// Clean up
	_ = sp.Stop("sess1")
}

func TestSendMessage_InvokesRegistryRunTurn(t *testing.T) {
	repo := initRepoForSpawn(t)
	reg := &fakeRegistryForSpawn{}
	sp := NewStudioSpawner(reg, "/usr/bin/orchestrad", "/tmp/studio.sock")

	if err := sp.Spawn(context.Background(), Session{ID: "sess2", Runner: "claude-code", RepoPath: repo}, func(Event) {}); err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer sp.Stop("sess2")

	if err := sp.SendMessage(context.Background(), "sess2", "hello"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(reg.turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(reg.turns))
	}
	if reg.turns[0].Prompt != "hello" {
		t.Fatalf("prompt=%q", reg.turns[0].Prompt)
	}
	if reg.turns[0].SessionID != "sess2" {
		t.Fatalf("sessionID=%q", reg.turns[0].SessionID)
	}
}

func TestSendMessage_UnknownSession(t *testing.T) {
	sp := NewStudioSpawner(&fakeRegistryForSpawn{}, "/usr/bin/orchestrad", "/tmp/studio.sock")
	if err := sp.SendMessage(context.Background(), "unknown", "x"); err == nil {
		t.Fatalf("expected error")
	}
}

func TestStop_RemovesWorktree(t *testing.T) {
	repo := initRepoForSpawn(t)
	sp := NewStudioSpawner(&fakeRegistryForSpawn{}, "/usr/bin/orchestrad", "/tmp/studio.sock")
	if err := sp.Spawn(context.Background(), Session{ID: "sess3", Runner: "claude-code", RepoPath: repo}, func(Event) {}); err != nil {
		t.Fatalf("spawn: %v", err)
	}
	sp.mu.Lock()
	wtPath := sp.sessions["sess3"].worktree.Path
	sp.mu.Unlock()

	if err := sp.Stop("sess3"); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
}
