package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// AgentRegistry is the subset of agents.Registry the spawner uses.
// Defined as an interface for test substitution.
type AgentRegistry interface {
	RunTurn(ctx context.Context, p agents.Provider, req agents.TurnRequest, on agents.EventHandler) (agents.TurnResult, error)
}

// StudioSpawner is the production RunnerSpawner. It manages per-session scratch
// worktrees and runs CLI agent turns through the existing agent registry.
type StudioSpawner struct {
	reg         AgentRegistry
	daemonBin   string
	socketPath  string
	turnTimeout time.Duration

	mu       sync.Mutex
	sessions map[string]*spawnedSession
}

type spawnedSession struct {
	worktree *ScratchWorktree
	provider agents.Provider
	onEvent  func(Event)
	cancel   context.CancelFunc
}

// NewStudioSpawner constructs a spawner.
//
//   - reg:        agent registry (real one in production).
//   - daemonBin:  absolute path to the orchestrad binary (for mcp-bridge subprocess).
//   - socketPath: path to the studio listener socket (StartBridgeListener bound this).
func NewStudioSpawner(reg AgentRegistry, daemonBin, socketPath string) *StudioSpawner {
	return &StudioSpawner{
		reg:         reg,
		daemonBin:   daemonBin,
		socketPath:  socketPath,
		turnTimeout: 5 * time.Minute,
		sessions:    map[string]*spawnedSession{},
	}
}

// Spawn provisions a worktree + .mcp.json for the session. Does not run any turn.
func (s *StudioSpawner) Spawn(_ context.Context, sess Session, onEvent func(Event)) error {
	wt, err := CreateReadOnlyWorktree(sess.RepoPath)
	if err != nil {
		return fmt.Errorf("studio spawner: worktree: %w", err)
	}

	// Re-grant write permission for .mcp.json placement, then restore read-only.
	if err := os.Chmod(wt.Path, 0755); err != nil {
		_ = wt.Cleanup()
		return fmt.Errorf("studio spawner: chmod wt: %w", err)
	}
	if err := writeMCPConfig(wt.Path, s.daemonBin, s.socketPath, sess.ID); err != nil {
		_ = wt.Cleanup()
		return fmt.Errorf("studio spawner: write mcp config: %w", err)
	}
	if err := os.Chmod(wt.Path, 0555); err != nil {
		_ = wt.Cleanup()
		return fmt.Errorf("studio spawner: restore read-only: %w", err)
	}

	s.mu.Lock()
	s.sessions[sess.ID] = &spawnedSession{
		worktree: wt,
		provider: agentsProviderFor(sess.Runner),
		onEvent:  onEvent,
	}
	s.mu.Unlock()
	return nil
}

// SendMessage runs one agent turn with the provided text as prompt.
func (s *StudioSpawner) SendMessage(ctx context.Context, sessionID, message string) error {
	s.mu.Lock()
	st, ok := s.sessions[sessionID]
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("studio: no spawned session %s", sessionID)
	}

	turnCtx, cancel := context.WithTimeout(ctx, s.turnTimeout)
	s.mu.Lock()
	st.cancel = cancel
	s.mu.Unlock()
	defer cancel()

	req := agents.TurnRequest{
		SessionID:     sessionID,
		Workspace:     st.worktree.Path,
		WorkspaceRoot: st.worktree.Path,
		Prompt:        message,
		Timeout:       s.turnTimeout,
	}

	// resultText is set when the agent emits a final result event with complete text.
	// accumulated collects streaming deltas as fallback.
	var resultText string
	var accumulated strings.Builder

	_, err := s.reg.RunTurn(turnCtx, st.provider, req, func(ev agents.Event) {
		// Forward raw agent events for any streaming consumers.
		st.onEvent(Event{
			SessionID: sessionID,
			Kind:      EventChatToken,
			Payload:   ev,
		})
		// Track text for the final chat.message.
		// Prefer result/* events (complete text) over accumulated deltas.
		if strings.HasPrefix(ev.Kind, "result/") && ev.Message != "" {
			resultText = ev.Message
		} else if ev.Message != "" && !strings.Contains(ev.Kind, "tool") {
			accumulated.WriteString(ev.Message)
		}
	})
	if err != nil {
		st.onEvent(Event{SessionID: sessionID, Kind: EventError, Payload: err.Error()})
		return err
	}

	// Emit the complete agent response as a chat.message event.
	text := resultText
	if text == "" {
		text = accumulated.String()
	}
	if text != "" {
		st.onEvent(Event{
			SessionID: sessionID,
			Kind:      EventChatMessage,
			Payload:   map[string]string{"role": "agent", "text": text},
		})
	}
	return nil
}

// Stop tears down the spawned session.
func (s *StudioSpawner) Stop(sessionID string) error {
	s.mu.Lock()
	st, ok := s.sessions[sessionID]
	delete(s.sessions, sessionID)
	s.mu.Unlock()
	if !ok {
		return nil
	}
	if st.cancel != nil {
		st.cancel()
	}
	return st.worktree.Cleanup()
}

// agentsProviderFor maps the studio's runner string to an agents.Provider.
// Phase 2 supports Claude Code only; other runners are recognized but their
// MCP integration is not yet validated.
func agentsProviderFor(runner string) agents.Provider {
	switch runner {
	case "claude-code", "CLAUDE":
		return agents.ProviderClaude
	case "codex", "CODEX":
		return agents.ProviderCodex
	case "opencode", "OPENCODE":
		return agents.ProviderOpenCode
	case "gemini", "GEMINI":
		return agents.ProviderGemini
	default:
		return agents.ProviderClaude
	}
}

// writeMCPConfig writes a .mcp.json into wtDir that registers the
// orchestra-studio MCP server pointing at the running daemon via the
// orchestrad mcp-bridge subprocess.
func writeMCPConfig(wtDir, daemonBin, socketPath, sessionID string) error {
	cfg := map[string]any{
		"mcpServers": map[string]any{
			"orchestra-studio": map[string]any{
				"command": daemonBin,
				"args":    []string{"mcp-bridge", "--session", sessionID, "--socket", socketPath},
			},
		},
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(wtDir, ".mcp.json"), data, 0644)
}
