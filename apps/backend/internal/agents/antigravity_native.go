package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// AntigravityNativeSession speaks the documented AGY stream-json process
// protocol. It does not use the repository's unwired ACP fixture transport.
// Permission decisions remain inside AGY's headless policy; this adapter does
// not auto-approve tools or fabricate interactive approval replies.
type AntigravityNativeSession struct {
	ctx       context.Context
	cancel    context.CancelFunc
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	writeMu   sync.Mutex
	mu        sync.Mutex
	threadID  string
	info      NativeModelInfo
	turnCount int64
	active    bool
	turnID    string
	resultCh  chan antigravityTurnResult
	readyCh   chan antigravityInitResult
	done      chan struct{}
	closeOnce sync.Once
	onEvent   NativeEventHandler
	failure   error
	// release restores workspace files written for the agent profile.
	release func()
}

type antigravityInitResult struct {
	id   string
	info NativeModelInfo
	err  error
}
type antigravityTurnResult struct {
	result NativeTurnResult
	err    error
}
type antigravityWire struct {
	Event          string                     `json:"event"`
	ConversationID string                     `json:"conversation_id"`
	Init           map[string]json.RawMessage `json:"init"`
	StepUpdate     map[string]json.RawMessage `json:"step_update"`
	Result         map[string]json.RawMessage `json:"result"`
}

// NewAntigravityNativeSession launches AGY with safe native-session flags.
// command must be a configured executable command; extra behavior flags are
// not inherited from the batch runner.
func NewAntigravityNativeSession(ctx context.Context, command string, request TurnRequest, conversationID string, onEvent NativeEventHandler) (*AntigravityNativeSession, error) {
	return newAntigravityNativeSessionWithArgs(ctx, command, nil, request, conversationID, onEvent, nil)
}

func newAntigravityNativeSession(ctx context.Context, command string, request TurnRequest, conversationID string, onEvent NativeEventHandler, extraEnv []string) (*AntigravityNativeSession, error) {
	return newAntigravityNativeSessionWithArgs(ctx, command, nil, request, conversationID, onEvent, extraEnv)
}

func newAntigravityNativeSessionWithArgs(ctx context.Context, command string, prefixArgs []string, request TurnRequest, conversationID string, onEvent NativeEventHandler, extraEnv []string) (*AntigravityNativeSession, error) {
	if err := validateTurnWorkspace(request); err != nil {
		return nil, err
	}
	if strings.TrimSpace(command) == "" {
		return nil, errors.New("native Antigravity command is empty")
	}
	if request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal {
		return nil, errors.New("native Antigravity remote sessions are not supported")
	}
	if request.ProviderTurnCounter < 0 || conversationID == "" && request.ProviderTurnCounter != 0 {
		return nil, errors.New("invalid Antigravity cumulative turn baseline")
	}
	args := []string{"--input-format", "stream-json", "--output-format", "stream-json"}
	model := effectiveModel(request)
	if model != "" {
		args = append(args, "--model", model)
	}
	if request.Agent != nil && request.Agent.Effort != "" {
		args = append(args, "--effort", request.Agent.Effort)
	}
	binary, err := resolveAntigravityExecutable(command)
	if err != nil {
		return nil, err
	}
	// agy has no per-run config mechanism: agent, rules, skills and MCP files
	// are merged into the run cwd and restored when this session closes.
	applied, err := applyAntigravityWorkspace(request.Workspace, request)
	if err != nil {
		return nil, fmt.Errorf("apply Antigravity agent profile: %w", err)
	}
	expectedAgent := applied.agentName
	if expectedAgent == "" && request.Agent == nil {
		expectedAgent = request.RequestedAgentID
	}
	if expectedAgent != "" {
		args = append(args, "--agent", expectedAgent)
	}
	if conversationID != "" {
		args = append(args, "--conversation", conversationID)
	}
	// Headless AGY cannot ask for permission, so it denies reads outside the
	// workspace. Agents like superpowers read their skills from these shared
	// directories, so add them (read access) instead of failing the turn.
	for _, dir := range antigravityReadableDirs() {
		args = append(args, "--add-dir", dir)
	}
	release := func() {
		if applied.overlay != nil {
			applied.overlay.release()
		}
	}
	if request.Agent != nil && request.Agent.Permissions.Restrictive() {
		applied.receipt.skip("permissions")
	}
	childCtx, cancel := context.WithCancel(ctx)
	processArgs := append(append([]string(nil), prefixArgs...), args...)
	cmd := backgroundcommand.CommandContext(childCtx, binary, processArgs...)
	cmd.Dir = request.Workspace
	cmd.Env = safeSubprocessEnv(request.SessionID, ProviderAntigravity)
	cmd.Env = append(cmd.Env, extraEnv...)
	cmd.Stderr = io.Discard
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		release()
		return nil, fmt.Errorf("native Antigravity stdout: %w", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		release()
		return nil, fmt.Errorf("native Antigravity stdin: %w", err)
	}
	s := &AntigravityNativeSession{ctx: childCtx, cancel: cancel, cmd: cmd, stdin: stdin, threadID: conversationID, turnCount: request.ProviderTurnCounter, readyCh: make(chan antigravityInitResult, 1), done: make(chan struct{}), onEvent: onEvent, release: release}
	if err = cmd.Start(); err != nil {
		cancel()
		release()
		return nil, fmt.Errorf("start native Antigravity: %w", err)
	}
	go s.read(stdout)
	go func() {
		waitErr := cmd.Wait()
		s.mu.Lock()
		if s.failure == nil {
			if waitErr != nil {
				s.failure = fmt.Errorf("native Antigravity exited: %w", waitErr)
			} else {
				s.failure = io.EOF
			}
		}
		failure := s.failure
		resultCh := s.resultCh
		s.mu.Unlock()
		if resultCh != nil {
			select {
			case resultCh <- antigravityTurnResult{err: failure}:
			default:
			}
		}
		close(s.done)
	}()
	select {
	case ready := <-s.readyCh:
		if ready.err != nil {
			_ = s.Close()
			return nil, ready.err
		}
		if ready.id == "" || conversationID != "" && ready.id != conversationID {
			_ = s.Close()
			return nil, errors.New("Antigravity returned a missing or different conversation identity")
		}
		if expectedAgent != "" && ready.info.AgentID != expectedAgent {
			_ = s.Close()
			return nil, fmt.Errorf("Antigravity did not confirm requested agent %q (reported %q)", expectedAgent, ready.info.AgentID)
		}
		if request.RequestedModel != "" && ready.info.Model != request.RequestedModel {
			_ = s.Close()
			return nil, fmt.Errorf("Antigravity did not confirm requested model %q (reported %q)", request.RequestedModel, ready.info.Model)
		}
		if request.Agent != nil {
			ready.info.AgentID = request.Agent.ID
			ready.info.AgentObservation = applied.receipt.observation()
		}
		s.mu.Lock()
		s.threadID, s.info = ready.id, ready.info
		s.mu.Unlock()
		return s, nil
	case <-ctx.Done():
		_ = s.Close()
		return nil, ctx.Err()
	case <-time.After(20 * time.Second):
		_ = s.Close()
		return nil, errors.New("timed out waiting for Antigravity stream initialization")
	}
}

func resolveAntigravityExecutable(command string) (string, error) {
	return resolveNativeExecutable("Antigravity", command)
}

// resolveNativeExecutable accepts exactly one executable (quoted when its path
// has spaces); native sessions never run a shell command line.
func resolveNativeExecutable(label, command string) (string, error) {
	value := strings.TrimSpace(command)
	if len(value) >= 2 && (value[0] == '\'' && value[len(value)-1] == '\'' || value[0] == '"' && value[len(value)-1] == '"') {
		value = value[1 : len(value)-1]
	} else if strings.ContainsAny(value, " \t\r\n") {
		return "", fmt.Errorf("native %s command must be one executable path; quote paths containing spaces", label)
	}
	if value == "" || strings.ContainsAny(value, ";&|<>$`()") {
		return "", fmt.Errorf("native %s command is not a valid executable path", label)
	}
	if filepath.IsAbs(value) {
		resolved, err := filepath.Abs(value)
		if err != nil {
			return "", err
		}
		info, err := os.Stat(resolved)
		if err != nil || info.IsDir() {
			return "", fmt.Errorf("native %s executable is unavailable: %s", label, resolved)
		}
		return resolved, nil
	}
	resolved, err := exec.LookPath(value)
	if err != nil {
		return "", fmt.Errorf("native %s executable is unavailable: %w", label, err)
	}
	return resolved, nil
}

func (s *AntigravityNativeSession) ThreadID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.threadID
}
func (s *AntigravityNativeSession) ModelInfo() NativeModelInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

func (s *AntigravityNativeSession) SendTurn(ctx context.Context, text, model string) (NativeTurnResult, error) {
	if strings.TrimSpace(text) == "" {
		return NativeTurnResult{}, errors.New("native turn text is empty")
	}
	s.mu.Lock()
	if s.failure != nil || s.ctx.Err() != nil {
		err := s.failure
		if err == nil {
			err = s.ctx.Err()
		}
		s.mu.Unlock()
		return NativeTurnResult{}, fmt.Errorf("native Antigravity session unavailable: %w", err)
	}
	if s.active {
		s.mu.Unlock()
		return NativeTurnResult{}, errors.New("native turn already active")
	}
	if model != "" && model != s.info.Model {
		s.mu.Unlock()
		return NativeTurnResult{}, errors.New("Antigravity model changes require a new provider session; this conversation keeps its original model")
	}
	s.active = true
	s.turnID = uuid.NewString()
	s.resultCh = make(chan antigravityTurnResult, 1)
	turnID, resultCh := s.turnID, s.resultCh
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active = false
		s.turnID = ""
		s.resultCh = nil
		s.mu.Unlock()
	}()
	message, err := json.Marshal(map[string]any{"event": "user", "message": map[string]any{"content": text}})
	if err != nil {
		return NativeTurnResult{}, err
	}
	s.writeMu.Lock()
	_, err = s.stdin.Write(append(message, '\n'))
	s.writeMu.Unlock()
	if err != nil {
		s.fail(fmt.Errorf("Antigravity prompt delivery outcome unknown: %w", err))
		return NativeTurnResult{}, err
	}
	select {
	case done := <-resultCh:
		if done.result.TurnID == "" {
			done.result.TurnID = turnID
		}
		return done.result, done.err
	case <-ctx.Done():
		// AGY stream-json has no documented in-band cancel. Requesting termination
		// of this process cannot prove child processes or provider work have ended.
		_ = s.killProcess()
		return NativeTurnResult{TurnID: turnID, Status: "unknown"}, fmt.Errorf("Antigravity turn outcome unknown after cancellation: %w", ctx.Err())
	case <-s.done:
		s.mu.Lock()
		failure := s.failure
		s.mu.Unlock()
		if failure == nil {
			failure = io.EOF
		}
		return NativeTurnResult{TurnID: turnID, Status: "failed"}, fmt.Errorf("Antigravity session ended before a result: %w", failure)
	}
}

func (s *AntigravityNativeSession) RespondRequest(ctx context.Context, _ string, _ json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.New("Antigravity headless stream-json does not expose a correlated interactive request-response protocol")
}

func (s *AntigravityNativeSession) Interrupt(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.killProcess()
}

func (s *AntigravityNativeSession) killProcess() error {
	s.mu.Lock()
	cmd := s.cmd
	closed := s.ctx.Err() != nil
	s.mu.Unlock()
	if closed || cmd == nil || cmd.Process == nil {
		return nil
	}
	if err := cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}

func (s *AntigravityNativeSession) Close() error {
	var closeErr error
	s.closeOnce.Do(func() {
		_ = s.stdin.Close()
		closeErr = s.killProcess()
		s.cancel()
	})
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		if closeErr == nil {
			closeErr = errors.New("Antigravity process termination remains unconfirmed")
		}
	}
	if s.release != nil {
		s.release()
	}
	return closeErr
}

func (s *AntigravityNativeSession) fail(err error) {
	s.mu.Lock()
	if s.failure == nil {
		s.failure = err
	}
	ready := s.readyCh
	result := s.resultCh
	s.mu.Unlock()
	select {
	case ready <- antigravityInitResult{err: err}:
	default:
	}
	if result != nil {
		select {
		case result <- antigravityTurnResult{err: err}:
		default:
		}
	}
	s.cancel()
}

func (s *AntigravityNativeSession) emit(e NativeEvent) {
	if s.onEvent != nil {
		s.onEvent(e)
	}
}

func (s *AntigravityNativeSession) read(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 4<<20)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var wire antigravityWire
		if err := json.Unmarshal(line, &wire); err != nil || wire.Event == "" {
			s.fail(errors.New("invalid Antigravity stream-json event"))
			return
		}
		switch wire.Event {
		case "init":
			id := wire.ConversationID
			cwd := rawString(wire.Init["cwd"])
			var info NativeModelInfo
			info.Model = rawString(wire.Init["model"])
			info.AgentID = rawString(wire.Init["agent"])
			info.ApprovalPolicy = rawString(wire.Init["permission_mode"])
			if strings.TrimSpace(cwd) == "" || !sameNativePath(cwd, s.cmd.Dir) {
				s.fail(errors.New("Antigravity initialized outside the requested workspace"))
				return
			}
			if id == "" {
				s.fail(errors.New("Antigravity initialization omitted conversation identity"))
				return
			}
			s.mu.Lock()
			expected := s.threadID
			s.threadID = id
			s.mu.Unlock()
			if expected != "" && expected != id {
				s.fail(errors.New("Antigravity initialized a different conversation"))
				return
			}
			select {
			case s.readyCh <- antigravityInitResult{id: id, info: info}:
			default:
			}
			s.emit(NativeEvent{Type: "session/initialized", ThreadID: id, Payload: line})
		case "step_update":
			step := wire.StepUpdate
			conversationID := rawString(step["conversation_id"])
			threadID := s.ThreadID()
			if conversationID != threadID {
				s.fail(errors.New("Antigravity step belongs to a different conversation"))
				return
			}
			stepType := rawString(step["step_type"])
			delta := rawString(step["text_delta"])
			eventType := "step_update"
			itemID := ""
			if stepType == "agent_response" && delta != "" {
				eventType = "item/agentMessage/delta"
			} else if delta != "" && (strings.Contains(stepType, "think") || strings.Contains(stepType, "reason")) {
				// Thinking steps share the reasoning stream shape used by every harness.
				eventType = "item/reasoning/summaryTextDelta"
				itemID = "step-" + string(step["step_index"])
			}
			s.mu.Lock()
			turnID := s.turnID
			s.mu.Unlock()
			s.emit(NativeEvent{Type: eventType, ThreadID: threadID, TurnID: turnID, ItemID: itemID, Delta: delta, Payload: line})
		case "result":
			result := wire.Result
			conversationID := rawString(result["conversation_id"])
			threadID := s.ThreadID()
			if conversationID != threadID {
				s.fail(errors.New("Antigravity result belongs to a different conversation"))
				return
			}
			var cumulativeTurns int64
			if raw := result["num_turns"]; len(raw) == 0 || json.Unmarshal(raw, &cumulativeTurns) != nil || cumulativeTurns < 0 {
				s.fail(errors.New("Antigravity result omitted a valid cumulative turn counter"))
				return
			}
			status := strings.ToUpper(rawString(result["status"]))
			if status != "SUCCESS" && status != "ERROR" {
				s.fail(fmt.Errorf("unsupported Antigravity result status %q", status))
				return
			}
			text := rawString(result["response"])
			s.mu.Lock()
			turnID := s.turnID
			resultCh := s.resultCh
			active := s.active
			expectedTurns := s.turnCount + 1
			info := s.info
			s.mu.Unlock()
			if !active || resultCh == nil {
				s.fail(errors.New("Antigravity result arrived without an active turn"))
				return
			}
			if cumulativeTurns != expectedTurns {
				s.fail(fmt.Errorf("Antigravity cumulative turn counter %d does not match expected turn %d", cumulativeTurns, expectedTurns))
				return
			}
			nativeStatus := "failed"
			if status == "SUCCESS" {
				nativeStatus = "completed"
			}
			nativeResult := NativeTurnResult{TurnID: turnID, Status: nativeStatus, Text: text, Model: info.Model, CumulativeTurnCount: cumulativeTurns}
			s.emit(NativeEvent{Type: "turn/completed", ThreadID: threadID, TurnID: turnID, Payload: line})
			s.mu.Lock()
			s.turnCount = cumulativeTurns
			s.mu.Unlock()
			var resultErr error
			if status != "SUCCESS" {
				resultErr = fmt.Errorf("Antigravity result status %q: %s", status, rawString(result["error"]))
			} else if denied := antigravityDeniedActions(result["denied_actions"]); strings.TrimSpace(text) == "" && len(denied) > 0 {
				// A turn that only hit permission denials produced nothing; say so instead of
				// completing silently with an empty reply.
				nativeResult.Status = "failed"
				resultErr = fmt.Errorf("Antigravity denied %s and ended the turn without replying. Headless mode cannot ask for permission, so the agent could not finish", strings.Join(denied, ", "))
			}
			select {
			case resultCh <- antigravityTurnResult{result: nativeResult, err: resultErr}:
			default:
			}
		default:
			s.fail(fmt.Errorf("unsupported Antigravity stream event %q", wire.Event))
			return
		}
	}
	if err := scanner.Err(); err != nil {
		s.fail(fmt.Errorf("Antigravity stream read: %w", err))
	} else {
		s.fail(io.EOF)
	}
}

// antigravityReadableDirs lists the shared agent and skill directories that
// exist on this machine, for --add-dir.
func antigravityReadableDirs() []string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	var dirs []string
	for _, candidate := range []string{
		filepath.Join(home, ".agents"),
		filepath.Join(home, ".gemini", "antigravity-cli"),
	} {
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			dirs = append(dirs, candidate)
		}
	}
	return dirs
}

// antigravityDeniedActions names the tool actions AGY refused in a turn result.
func antigravityDeniedActions(raw json.RawMessage) []string {
	var denied []struct {
		Action      string `json:"action"`
		DisplayName string `json:"display_name"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &denied) != nil {
		return nil
	}
	seen := map[string]bool{}
	var names []string
	for _, item := range denied {
		name := item.DisplayName
		if name == "" {
			name = item.Action
		}
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}

func rawString(value json.RawMessage) string {
	var result string
	_ = json.Unmarshal(value, &result)
	return result
}

func sameNativePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return filepath.Clean(left) == filepath.Clean(right)
	}
	return strings.EqualFold(filepath.Clean(leftAbs), filepath.Clean(rightAbs))
}
