# Task Authoring Studio — Phase 2: CLI Runner Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 placeholder `RunnerSpawner` with a real implementation that spawns one of the supported CLI agents (Claude Code, Codex, OpenCode, Gemini) in **studio mode** — a new run mode that uses a read-only scratch worktree and attaches the `orchestra-studio` MCP server as an additional MCP source for the agent.

**Architecture:** A new `internal/studio/runner.go` orchestrates: (1) materialize a read-only scratch worktree, (2) write a per-session MCP config so the chosen CLI agent picks up `orchestra-studio`, (3) spawn the agent via the existing `internal/agents/` registry with a `studio` run mode, (4) bridge JSON-RPC stdin/stdout to the studio MCP server and stream chat output to the manager's event dispatch. Each runner adapter in `internal/agents/` gets a small extension to accept the studio mode.

**Tech Stack:** Go, existing `internal/agents/` Runner interface, existing `internal/workspace/` service, existing `internal/mcp/` MCP infrastructure.

**Prerequisite:** Phase 1 merged.

---

## File Structure

**New files:**
- `apps/backend/internal/studio/runner.go` — production `RunnerSpawner` wiring real CLI agents
- `apps/backend/internal/studio/runner_test.go`
- `apps/backend/internal/studio/worktree.go` — read-only scratch worktree helpers
- `apps/backend/internal/studio/worktree_test.go`
- `apps/backend/internal/studio/mcp_bridge.go` — bridges between agent stdio and the studio MCP server
- `apps/backend/internal/studio/mcp_bridge_test.go`

**Modified files:**
- `apps/backend/internal/agents/types.go` — add a `Mode` field (or equivalent) to `TurnRequest` to indicate studio mode
- `apps/backend/internal/agents/claude_runner.go`, `codex_appserver.go`, `opencode_runner.go`, `gemini_runner.go` — handle `studio` mode (attach extra MCP server config, route stdout/stderr to the supplied event handler, skip workspace write hooks)
- `apps/backend/internal/app/run.go` — pass the real spawner into `studio.NewManager`

---

## Task 1: Decide the agent-side surface and add `Mode` to `TurnRequest`

**Files:**
- Modify: `apps/backend/internal/agents/types.go`
- Test: `apps/backend/internal/agents/types_test.go` (create if missing)

- [ ] **Step 1: Add the type**

Open `apps/backend/internal/agents/types.go`. Add:

```go
type RunMode string

const (
	RunModeExecute RunMode = ""        // default (current behavior)
	RunModeStudio  RunMode = "studio"  // authoring session, read-only worktree
)
```

Find the `TurnRequest` struct. Add field:

```go
Mode RunMode
ExtraMCPServers []MCPServerConfig // additional MCP servers to attach for this turn
```

If `MCPServerConfig` doesn't exist, add it:

```go
type MCPServerConfig struct {
	Name    string
	Command string
	Args    []string
	Env     map[string]string
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/backend && go build ./internal/agents/`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/agents/types.go
git commit -m "feat(agents): add RunMode and ExtraMCPServers on TurnRequest"
```

---

## Task 2: Read-only scratch worktree helper

**Files:**
- Create: `apps/backend/internal/studio/worktree.go`
- Create: `apps/backend/internal/studio/worktree_test.go`

The studio session needs a worktree that the agent can read but not modify. Simplest implementation: `git worktree add --detach` into a temp directory, then set every regular file to mode `0444` and every directory to `0555`. On cleanup, restore permissions and `git worktree remove`.

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/studio/worktree_test.go
package studio

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func initBareRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	must := func(name string, args ...string) {
		cmd := exec.Command(name, args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, string(out))
		}
	}
	must("git", "init")
	must("git", "config", "user.email", "test@test")
	must("git", "config", "user.name", "test")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	must("git", "add", ".")
	must("git", "commit", "-m", "init")
	return dir
}

func TestCreateReadOnlyWorktree(t *testing.T) {
	repo := initBareRepo(t)
	wt, err := CreateReadOnlyWorktree(repo)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer wt.Cleanup()

	info, err := os.Stat(filepath.Join(wt.Path, "README.md"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm()&0222 != 0 {
		t.Fatalf("file is writable: %v", info.Mode())
	}
}

func TestWorktreeCleanup(t *testing.T) {
	repo := initBareRepo(t)
	wt, err := CreateReadOnlyWorktree(repo)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	path := wt.Path
	if err := wt.Cleanup(); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run Worktree -v`
Expected: FAIL — `undefined: CreateReadOnlyWorktree`.

- [ ] **Step 3: Implement**

```go
// apps/backend/internal/studio/worktree.go
package studio

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type ScratchWorktree struct {
	RepoPath string
	Path     string
}

func CreateReadOnlyWorktree(repoPath string) (*ScratchWorktree, error) {
	tmp, err := os.MkdirTemp("", "orchestra-studio-*")
	if err != nil {
		return nil, fmt.Errorf("mkdir tmp: %w", err)
	}
	wtPath := filepath.Join(tmp, "wt")
	cmd := exec.Command("git", "worktree", "add", "--detach", wtPath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, fmt.Errorf("git worktree add: %w: %s", err, string(out))
	}
	if err := setReadOnly(wtPath); err != nil {
		_ = exec.Command("git", "-C", repoPath, "worktree", "remove", "--force", wtPath).Run()
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	return &ScratchWorktree{RepoPath: repoPath, Path: wtPath}, nil
}

func (w *ScratchWorktree) Cleanup() error {
	// Restore permissions so worktree remove can delete files.
	_ = filepath.Walk(w.Path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			_ = os.Chmod(path, 0755)
		} else {
			_ = os.Chmod(path, 0644)
		}
		return nil
	})
	out, err := exec.Command("git", "-C", w.RepoPath, "worktree", "remove", "--force", w.Path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("worktree remove: %w: %s", err, string(out))
	}
	return os.RemoveAll(filepath.Dir(w.Path))
}

func setReadOnly(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if filepath.Base(path) == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return os.Chmod(path, 0555)
		}
		return os.Chmod(path, 0444)
	})
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -run Worktree -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/worktree.go apps/backend/internal/studio/worktree_test.go
git commit -m "feat(studio): read-only scratch worktree helper"
```

---

## Task 3: MCP bridge — stdio in/out → studio MCP server

**Files:**
- Create: `apps/backend/internal/studio/mcp_bridge.go`
- Create: `apps/backend/internal/studio/mcp_bridge_test.go`

The bridge sits between the agent's stdio (where it speaks MCP/JSON-RPC) and the `studio.Server` in-process implementation. It reads JSON-RPC requests from the agent, dispatches via `Server.Dispatch`, writes back JSON-RPC responses.

- [ ] **Step 1: Write failing test using io.Pipe**

```go
// apps/backend/internal/studio/mcp_bridge_test.go
package studio

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"testing"

	mcpstudio "github.com/orchestra/orchestra/apps/backend/internal/mcp/studio"
)

func TestBridgeDispatchesToolCall(t *testing.T) {
	rm := &recordingMgrForBridge{}
	srv := mcpstudio.New(rm, "sess1")

	agentToBridgeR, agentToBridgeW := io.Pipe()
	bridgeToAgentR, bridgeToAgentW := io.Pipe()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go RunMCPBridge(ctx, srv, agentToBridgeR, bridgeToAgentW)

	// Agent writes a JSON-RPC request
	req := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"set_title","arguments":{"text":"Hello"}}}` + "\n"
	go agentToBridgeW.Write([]byte(req))

	scanner := bufio.NewScanner(bridgeToAgentR)
	if !scanner.Scan() {
		t.Fatalf("no response: %v", scanner.Err())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["error"] != nil {
		t.Fatalf("error: %v", resp["error"])
	}
	if len(rm.titles) != 1 || rm.titles[0] != "Hello" {
		t.Fatalf("titles=%v", rm.titles)
	}
}

type recordingMgrForBridge struct{ titles []string }

func (r *recordingMgrForBridge) SetTitle(_, t string) error          { r.titles = append(r.titles, t); return nil }
func (r *recordingMgrForBridge) SetDescription(_, _ string) error          { return nil }
func (r *recordingMgrForBridge) AddAcceptanceCriterion(_, _ string) error  { return nil }
func (r *recordingMgrForBridge) RemoveAcceptanceCriterion(_ string, _ int) error { return nil }
func (r *recordingMgrForBridge) AttachFile(_, _ string) error             { return nil }
func (r *recordingMgrForBridge) AttachLink(_, _, _ string) error          { return nil }
func (r *recordingMgrForBridge) SetProvider(_, _ string) error            { return nil }
func (r *recordingMgrForBridge) SetModel(_, _ string) error               { return nil }
func (r *recordingMgrForBridge) SetMaxTurns(_ string, _ int) error        { return nil }
func (r *recordingMgrForBridge) Push(context.Context, string) (string, error) { return "ISS-1", nil }
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run Bridge -v`
Expected: FAIL — `undefined: RunMCPBridge`.

- [ ] **Step 3: Implement**

```go
// apps/backend/internal/studio/mcp_bridge.go
package studio

import (
	"bufio"
	"context"
	"encoding/json"
	"io"

	mcpstudio "github.com/orchestra/orchestra/apps/backend/internal/mcp/studio"
)

type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"params"`
}

type jsonrpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func RunMCPBridge(ctx context.Context, srv *mcpstudio.Server, in io.Reader, out io.Writer) {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	enc := json.NewEncoder(out)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		var req jsonrpcRequest
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			_ = enc.Encode(jsonrpcResponse{JSONRPC: "2.0", Error: &jsonrpcError{Code: -32700, Message: err.Error()}})
			continue
		}
		if req.Method != "tools/call" {
			_ = enc.Encode(jsonrpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &jsonrpcError{Code: -32601, Message: "method not found"}})
			continue
		}
		result, err := srv.Dispatch(ctx, req.Params.Name, req.Params.Arguments)
		if err != nil {
			_ = enc.Encode(jsonrpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &jsonrpcError{Code: -32000, Message: err.Error()}})
			continue
		}
		_ = enc.Encode(jsonrpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -run Bridge -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/mcp_bridge.go apps/backend/internal/studio/mcp_bridge_test.go
git commit -m "feat(studio): JSON-RPC bridge between agent stdio and MCP server"
```

---

## Task 4: Extend Claude Code runner with studio mode

**Files:**
- Modify: `apps/backend/internal/agents/claude_runner.go`
- Test: `apps/backend/internal/agents/claude_runner_test.go` (create or extend)

The exact mechanism for attaching an extra MCP server is CLI-specific. For Claude Code, an MCP server is attached via the `.mcp.json` file or `--mcp-config` flag. Read the existing runner first to see how config is currently emitted.

- [ ] **Step 1: Read the current runner**

Run: `cat apps/backend/internal/agents/claude_runner.go` — locate where the command line is built and where `.mcp.json` (or equivalent) is written.

- [ ] **Step 2: Write failing test**

```go
func TestClaudeRunnerStudioModeEmitsExtraMCPServer(t *testing.T) {
	r := NewClaudeRunner(...) // match existing constructor signature
	cmd, err := r.BuildCommand(TurnRequest{
		Mode: RunModeStudio,
		ExtraMCPServers: []MCPServerConfig{
			{Name: "orchestra-studio", Command: "/usr/bin/orchestrad", Args: []string{"mcp-bridge", "--session", "sess1"}},
		},
		// ...other required fields
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// Inspect cmd.Args or generated config file for the extra server entry.
	if !containsString(cmd.Args, "orchestra-studio") && !mcpConfigContains(t, cmd, "orchestra-studio") {
		t.Fatalf("studio MCP server not attached: %v", cmd.Args)
	}
}
```

`containsString` and `mcpConfigContains` are small helpers — adapt to what the runner actually emits.

- [ ] **Step 3: Run, verify fail**

Run: `cd apps/backend && go test ./internal/agents/ -run StudioMode -v`
Expected: FAIL.

- [ ] **Step 4: Implement the mode in the runner**

Where the runner builds args / config:

```go
if req.Mode == RunModeStudio {
	for _, srv := range req.ExtraMCPServers {
		mcpConfig.Servers[srv.Name] = mcpServerEntry{
			Command: srv.Command,
			Args:    srv.Args,
			Env:     srv.Env,
		}
	}
	// Optionally suppress write tools / hooks in studio mode if the runner exposes a flag.
}
```

The exact field names match what `claude_runner.go` already uses for MCP config — adjust to match.

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/backend && go test ./internal/agents/ -run StudioMode -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/agents/claude_runner.go apps/backend/internal/agents/claude_runner_test.go
git commit -m "feat(agents/claude): attach extra MCP servers in studio mode"
```

---

## Task 5: Extend Codex, OpenCode, and Gemini runners with studio mode

Repeat the pattern from Task 4 for each runner. Each CLI has its own way of declaring MCP servers — consult its docs / existing config.

- [ ] **Step 1: Codex (`codex_appserver.go`)** — write failing test, attach extra MCP servers, commit.
- [ ] **Step 2: OpenCode (`opencode_runner.go`)** — same.
- [ ] **Step 3: Gemini (`gemini_runner.go`)** — same.

For each, commit message: `feat(agents/<name>): attach extra MCP servers in studio mode`.

If any runner cannot easily accept extra MCP servers, document it inline (`// TODO: studio mode unsupported on <runner> — see issue #N`) and skip the test for that runner only. The studio session creator will refuse to spawn that runner.

---

## Task 6: The real `StudioSpawner`

**Files:**
- Create: `apps/backend/internal/studio/runner.go`
- Create: `apps/backend/internal/studio/runner_test.go`

- [ ] **Step 1: Write failing test (integration-style, no real CLI)**

```go
// apps/backend/internal/studio/runner_test.go
package studio

import (
	"context"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

type fakeRegistry struct {
	turns []agents.TurnRequest
}

func (f *fakeRegistry) RunTurn(ctx context.Context, p agents.Provider, req agents.TurnRequest, on agents.EventHandler) (agents.TurnResult, error) {
	f.turns = append(f.turns, req)
	return agents.TurnResult{}, nil
}

func TestStudioSpawnerStartsRunner(t *testing.T) {
	reg := &fakeRegistry{}
	s := NewStudioSpawner(reg, "/repo", "/usr/bin/orchestrad")
	sess := Session{ID: "sess1", ProjectID: "p", Runner: "claude-code"}

	if err := s.Spawn(context.Background(), sess, func(e Event) {}); err != nil {
		t.Fatalf("spawn: %v", err)
	}
	if len(reg.turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(reg.turns))
	}
	if reg.turns[0].Mode != agents.RunModeStudio {
		t.Fatalf("mode=%q", reg.turns[0].Mode)
	}
	found := false
	for _, m := range reg.turns[0].ExtraMCPServers {
		if m.Name == "orchestra-studio" {
			found = true
		}
	}
	if !found {
		t.Fatalf("studio MCP server not attached: %+v", reg.turns[0].ExtraMCPServers)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run StudioSpawner -v`
Expected: FAIL — `undefined: NewStudioSpawner`.

- [ ] **Step 3: Implement**

```go
// apps/backend/internal/studio/runner.go
package studio

import (
	"context"
	"fmt"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

type AgentRegistry interface {
	RunTurn(ctx context.Context, p agents.Provider, req agents.TurnRequest, on agents.EventHandler) (agents.TurnResult, error)
}

type StudioSpawner struct {
	reg       AgentRegistry
	repoPath  string
	daemonBin string

	mu       sync.Mutex
	sessions map[string]*sessionRuntime
}

type sessionRuntime struct {
	cancel   context.CancelFunc
	worktree *ScratchWorktree
}

func NewStudioSpawner(reg AgentRegistry, repoPath, daemonBin string) *StudioSpawner {
	return &StudioSpawner{
		reg:       reg,
		repoPath:  repoPath,
		daemonBin: daemonBin,
		sessions:  map[string]*sessionRuntime{},
	}
}

func (s *StudioSpawner) Spawn(ctx context.Context, sess Session, onEvent func(Event)) error {
	wt, err := CreateReadOnlyWorktree(s.repoPath)
	if err != nil {
		return fmt.Errorf("worktree: %w", err)
	}
	sessCtx, cancel := context.WithCancel(context.Background())

	mcpServer := agents.MCPServerConfig{
		Name:    "orchestra-studio",
		Command: s.daemonBin,
		Args:    []string{"mcp-bridge", "--session", sess.ID},
	}

	req := agents.TurnRequest{
		Mode:            agents.RunModeStudio,
		ExtraMCPServers: []agents.MCPServerConfig{mcpServer},
		// Populate remaining required fields (cwd = wt.Path, etc.) — match the runner's expectations.
	}

	go func() {
		defer wt.Cleanup()
		_, err := s.reg.RunTurn(sessCtx, agents.Provider(sess.Runner), req, func(ev agents.Event) {
			onEvent(Event{SessionID: sess.ID, Kind: EventChatToken, Payload: ev})
		})
		if err != nil {
			onEvent(Event{SessionID: sess.ID, Kind: EventError, Payload: err.Error()})
		}
	}()

	s.mu.Lock()
	s.sessions[sess.ID] = &sessionRuntime{cancel: cancel, worktree: wt}
	s.mu.Unlock()
	return nil
}

func (s *StudioSpawner) SendMessage(ctx context.Context, sessionID, message string) error {
	// Mechanism depends on whether the CLI supports streaming follow-up messages.
	// For runners that don't support it, the first message is the only message,
	// and SendMessage starts a new turn.
	return fmt.Errorf("studio: send-message not yet implemented for this runner")
}

func (s *StudioSpawner) Stop(sessionID string) error {
	s.mu.Lock()
	rt, ok := s.sessions[sessionID]
	delete(s.sessions, sessionID)
	s.mu.Unlock()
	if !ok {
		return nil
	}
	rt.cancel()
	return rt.worktree.Cleanup()
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -run StudioSpawner -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/runner.go apps/backend/internal/studio/runner_test.go
git commit -m "feat(studio): real RunnerSpawner backed by agent registry"
```

---

## Task 7: Add a `mcp-bridge` subcommand to `orchestrad`

When a CLI agent connects to the `orchestra-studio` MCP server, it spawns `orchestrad mcp-bridge --session <id>` as a subprocess. That subprocess opens a TCP/unix socket back to the running daemon, where the bridge from Task 3 runs the JSON-RPC loop against the live `studio.Server`.

**Files:**
- Modify: `apps/backend/cmd/orchestrad/main.go`
- Modify: `apps/backend/internal/api/studio.go` (add a websocket or unix-socket endpoint)

- [ ] **Step 1: Add the subcommand stub**

In `apps/backend/cmd/orchestrad/main.go`, before the normal daemon `Run`, handle `mcp-bridge`:

```go
if len(os.Args) >= 2 && os.Args[1] == "mcp-bridge" {
	sessionID := flag.NewFlagSet("mcp-bridge", flag.ExitOnError)
	sid := sessionID.String("session", "", "studio session id")
	addr := sessionID.String("addr", os.Getenv("ORCHESTRA_HOST"), "daemon address")
	_ = sessionID.Parse(os.Args[2:])
	if err := studio.RunBridgeSubprocess(*addr, *sid, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	return
}
```

- [ ] **Step 2: Implement `RunBridgeSubprocess`**

In `apps/backend/internal/studio/runner.go` (or a new `bridge_subprocess.go`):

```go
func RunBridgeSubprocess(daemonAddr, sessionID string, in io.Reader, out io.Writer) error {
	conn, err := net.Dial("tcp", daemonAddr) // or unix socket
	if err != nil {
		return err
	}
	defer conn.Close()
	// Identify which session this connection belongs to:
	header := fmt.Sprintf("STUDIO-BRIDGE %s\n", sessionID)
	if _, err := conn.Write([]byte(header)); err != nil {
		return err
	}
	// Bidirectionally copy.
	errCh := make(chan error, 2)
	go func() { _, e := io.Copy(conn, in); errCh <- e }()
	go func() { _, e := io.Copy(out, conn); errCh <- e }()
	return <-errCh
}
```

- [ ] **Step 3: Daemon-side socket listener**

In the API layer (or a dedicated `internal/studio/listener.go`), accept STUDIO-BRIDGE connections, look up the session's `studio.Server` instance, and run `RunMCPBridge` against the connection.

The exact transport (loopback TCP vs unix socket) should match how Orchestra's existing daemon already binds. Default to a unix socket under `ORCHESTRA_WORKSPACE_ROOT/.orchestra/studio.sock` for security; loopback TCP on a random port is acceptable if unix sockets are awkward in the existing code.

- [ ] **Step 4: Tests**

Add an integration test under `internal/studio/` that:
1. Starts a daemon (or in-process listener).
2. Runs `RunBridgeSubprocess` in a goroutine connected to it.
3. Writes a JSON-RPC `set_title` over the subprocess stdin.
4. Asserts the manager's draft now has that title.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/cmd/orchestrad/main.go apps/backend/internal/studio/
git commit -m "feat(daemon): mcp-bridge subcommand + studio session listener"
```

---

## Task 8: Wire the real spawner into `app/run.go`

**Files:**
- Modify: `apps/backend/internal/app/run.go`

- [ ] **Step 1: Replace the `nil` spawner from Phase 1**

```go
daemonBin, _ := os.Executable()
spawner := studio.NewStudioSpawner(agentsRegistry, workspaceRoot, daemonBin)
studioMgr := studio.NewManager(database, pubsub, spawner)
studioMgr.SetTracker(trackerAdapter)
```

- [ ] **Step 2: Build and smoke**

Run: `cd apps/backend && go build -o orchestrad ./cmd/orchestrad/ && go test ./...`
Expected: all PASS.

Boot the daemon and verify a session can be created against a real agent (manually, if one is installed):

```bash
ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra ./apps/backend/orchestrad &
curl -s -X POST -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"project_id":"p","runner":"claude-code"}' http://127.0.0.1:3284/api/studio/sessions
```

Expected: `session_id` returned; backend logs show the agent process spawning in a scratch worktree.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/app/run.go
git commit -m "feat(app): wire real studio spawner with agent registry"
```

---

## Task 9: Final verification

- [ ] `cd apps/backend && go vet ./...` — clean.
- [ ] `cd apps/backend && gofmt -l ./cmd ./internal` — empty.
- [ ] `cd apps/backend && go test -race ./internal/studio/ ./internal/agents/ ./internal/api/` — pass.

## Phase 2 Complete

A real CLI agent can be spawned by the studio against a read-only worktree, calls the studio MCP server's tools, and updates the draft. The frontend (Phase 3) consumes the existing SSE.

What's intentionally missing:
- Frontend studio UI (Phase 3)
- Templates (Phase 4)
- Sophisticated multi-message conversation handling — depends on each runner's support for follow-up messages. Worst case, each user message starts a fresh turn against the existing draft state.
