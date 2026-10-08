package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
)

// OMPNativeSession drives `omp --mode rpc`: JSON commands on stdin, one JSON
// event or command response per stdout line. One process owns one omp session
// (its id is the provider thread, resumed with --resume). Turns are serialized;
// `prompt_result` is the end-of-turn signal. omp's events are translated into
// the Codex-shaped events the chat already renders (agent message deltas,
// reasoning items, command/file/tool items, token usage), and its tool-approval
// dialogs (extension_ui_request) become correlated server requests.
type OMPNativeSession struct {
	ctx       context.Context
	cancel    context.CancelFunc
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	writeMu   sync.Mutex
	mu        sync.Mutex
	seq       atomic.Int64
	threadID  string
	info      NativeModelInfo
	window    int64
	total     TokenUsage
	responses map[string]chan ompResponse
	requests  map[string]ompPendingRequest
	turn      *ompTurn
	readyCh   chan error
	done      chan struct{}
	closeOnce sync.Once
	onEvent   NativeEventHandler
	failure   error
	// release removes per-run temp files and restores workspace overlays.
	release func()
}

type ompResponse struct {
	data json.RawMessage
	err  error
}

// ompPendingRequest is an open omp dialog. approve/deny are the dialog's own
// option labels for a tool-approval select.
type ompPendingRequest struct {
	method  string
	dialog  string
	approve string
	deny    string
	turnID  string
}

// ompTurn is the state of the single active prompt.
type ompTurn struct {
	id        string
	promptID  string
	resultCh  chan NativeTurnResult
	output    strings.Builder
	message   int
	blocks    map[int]string             // content index -> item id within the current message
	toolArgs  map[string]json.RawMessage // tool_execution_end omits the arguments
	streamed  bool                       // the current message streamed text deltas
	stopError string                     // last assistant message ended with an error
}

type ompWire struct {
	Type                  string            `json:"type"`
	ID                    string            `json:"id"`
	Command               string            `json:"command"`
	Success               *bool             `json:"success"`
	Error                 string            `json:"error"`
	Data                  json.RawMessage   `json:"data"`
	Status                string            `json:"status"`
	Method                string            `json:"method"`
	Title                 string            `json:"title"`
	Message               json.RawMessage   `json:"message"`
	Options               []json.RawMessage `json:"options"`
	Placeholder           string            `json:"placeholder"`
	AssistantMessageEvent json.RawMessage   `json:"assistantMessageEvent"`
	ToolCallID            string            `json:"toolCallId"`
	ToolName              string            `json:"toolName"`
	Args                  json.RawMessage   `json:"args"`
	Result                json.RawMessage   `json:"result"`
	IsError               bool              `json:"isError"`
}

type ompState struct {
	Model *struct {
		ID            string `json:"id"`
		Provider      string `json:"provider"`
		ContextWindow int64  `json:"contextWindow"`
	} `json:"model"`
	ThinkingLevel string `json:"thinkingLevel"`
	SessionID     string `json:"sessionId"`
}

// NewOMPNativeSession launches `omp --mode rpc` in the request workspace and
// resumes sessionID when it is non-empty.
func NewOMPNativeSession(ctx context.Context, command string, request TurnRequest, sessionID string, onEvent NativeEventHandler) (*OMPNativeSession, error) {
	return newOMPNativeSession(ctx, command, nil, request, sessionID, onEvent, nil)
}

func newOMPNativeSession(ctx context.Context, command string, prefixArgs []string, request TurnRequest, sessionID string, onEvent NativeEventHandler, extraEnv []string) (*OMPNativeSession, error) {
	if err := validateTurnWorkspace(request); err != nil {
		return nil, err
	}
	if request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal {
		return nil, errors.New("native omp remote sessions are not supported")
	}
	binary, err := resolveNativeExecutable("omp", command)
	if err != nil {
		return nil, err
	}
	applied, err := applyOMP(request, true, func(...string) bool { return false })
	if err != nil {
		return nil, fmt.Errorf("apply omp agent profile: %w", err)
	}
	// Orchestra titles its own conversations; skip omp's extra title call.
	args := append([]string{"--mode", "rpc", "--no-title"}, applied.args...)
	if sessionID != "" {
		args = append(args, "--resume", sessionID)
	}
	childCtx, cancel := context.WithCancel(ctx)
	cmd := backgroundcommand.CommandContext(childCtx, binary, append(append([]string(nil), prefixArgs...), args...)...)
	cmd.Dir = request.Workspace
	cmd.Env = append(safeSubprocessEnv(request.SessionID, ProviderOMP), extraEnv...)
	stderr := &boundedTail{limit: 4096}
	cmd.Stderr = stderr
	// Close terminates on stdin EOF first; the kill is only the fallback.
	cmd.WaitDelay = 3 * time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		applied.cleanup()
		return nil, fmt.Errorf("native omp stdout: %w", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		applied.cleanup()
		return nil, fmt.Errorf("native omp stdin: %w", err)
	}
	s := &OMPNativeSession{ctx: childCtx, cancel: cancel, cmd: cmd, stdin: stdin, threadID: sessionID, responses: map[string]chan ompResponse{}, requests: map[string]ompPendingRequest{}, readyCh: make(chan error, 1), done: make(chan struct{}), onEvent: onEvent, release: applied.cleanup}
	if err = cmd.Start(); err != nil {
		cancel()
		applied.cleanup()
		return nil, fmt.Errorf("start native omp: %w", err)
	}
	go s.read(stdout)
	go func() {
		waitErr := cmd.Wait()
		detail := strings.TrimSpace(stderr.String())
		if waitErr == nil {
			waitErr = io.EOF
		}
		if detail != "" {
			waitErr = fmt.Errorf("%w: %s", waitErr, lastLine(detail))
		}
		s.fail(fmt.Errorf("native omp exited: %w", waitErr))
		close(s.done)
	}()
	fail := func(err error) (*OMPNativeSession, error) {
		_ = s.Close()
		return nil, err
	}
	select {
	case err = <-s.readyCh:
		if err != nil {
			return fail(err)
		}
	case <-ctx.Done():
		return fail(ctx.Err())
	case <-time.After(60 * time.Second):
		return fail(errors.New("timed out waiting for omp rpc readiness"))
	}
	stateCtx, stateCancel := context.WithTimeout(ctx, 20*time.Second)
	defer stateCancel()
	raw, err := s.call(stateCtx, "", map[string]any{"type": "get_state"})
	if err != nil {
		return fail(fmt.Errorf("omp get_state: %w", err))
	}
	var state ompState
	if json.Unmarshal(raw, &state) != nil || state.SessionID == "" {
		return fail(errors.New("omp get_state omitted the session identity"))
	}
	if sessionID != "" && state.SessionID != sessionID {
		return fail(fmt.Errorf("omp resumed session %q instead of %q", state.SessionID, sessionID))
	}
	s.mu.Lock()
	s.threadID = state.SessionID
	s.applyStateLocked(state)
	if request.Agent != nil {
		s.info.AgentID = request.Agent.ID
		s.info.AgentObservation = applied.receipt.observation()
	}
	model := s.info.Model
	s.mu.Unlock()
	payload, _ := json.Marshal(map[string]any{"threadId": state.SessionID, "model": model, "thinkingLevel": state.ThinkingLevel})
	s.emit(NativeEvent{Type: "session/initialized", ThreadID: state.SessionID, Payload: payload})
	return s, nil
}

func (s *OMPNativeSession) applyStateLocked(state ompState) {
	if state.Model != nil && state.Model.ID != "" {
		s.info.Model = ompSelector(state.Model.Provider, state.Model.ID)
		s.window = state.Model.ContextWindow
	}
	s.info.ReasoningEffort = state.ThinkingLevel
}

func ompSelector(provider, id string) string {
	if provider == "" {
		return id
	}
	return provider + "/" + id
}

func (s *OMPNativeSession) ThreadID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.threadID
}

func (s *OMPNativeSession) ModelInfo() NativeModelInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

func (s *OMPNativeSession) SendTurn(ctx context.Context, text, model string) (NativeTurnResult, error) {
	return s.SendTurnWithOptions(ctx, text, NativeTurnOptions{Model: model})
}

// SendTurnWithOptions applies a model or thinking change in-session (omp
// switches both mid-conversation), then sends the prompt and waits for its
// prompt_result.
func (s *OMPNativeSession) SendTurnWithOptions(ctx context.Context, text string, options NativeTurnOptions) (NativeTurnResult, error) {
	if strings.TrimSpace(text) == "" {
		return NativeTurnResult{}, errors.New("native turn text is empty")
	}
	if err := validateNativeReasoningEffort(options.ReasoningEffort); err != nil {
		return NativeTurnResult{}, err
	}
	s.mu.Lock()
	if s.failure != nil {
		err := s.failure
		s.mu.Unlock()
		return NativeTurnResult{}, fmt.Errorf("native omp session unavailable: %w", err)
	}
	if s.turn != nil {
		s.mu.Unlock()
		return NativeTurnResult{}, errors.New("native turn already active")
	}
	turn := &ompTurn{id: uuid.NewString(), resultCh: make(chan NativeTurnResult, 1), blocks: map[int]string{}, toolArgs: map[string]json.RawMessage{}}
	turn.promptID = "orchestra-prompt-" + turn.id
	s.turn = turn
	current := s.info
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.turn == turn {
			s.turn = nil
		}
		s.requests = map[string]ompPendingRequest{}
		s.mu.Unlock()
	}()
	if options.Model != "" && options.Model != current.Model {
		provider, id, ok := strings.Cut(options.Model, "/")
		if !ok || provider == "" || id == "" {
			return NativeTurnResult{}, errors.New("omp model changes need a provider/model selector")
		}
		raw, err := s.call(ctx, "", map[string]any{"type": "set_model", "provider": provider, "modelId": id})
		if err != nil {
			return NativeTurnResult{}, fmt.Errorf("omp set_model %s: %w", options.Model, err)
		}
		var model struct {
			ID            string `json:"id"`
			Provider      string `json:"provider"`
			ContextWindow int64  `json:"contextWindow"`
		}
		_ = json.Unmarshal(raw, &model)
		s.mu.Lock()
		s.info.Model = options.Model
		if model.ID != "" {
			s.info.Model = ompSelector(model.Provider, model.ID)
			s.window = model.ContextWindow
		}
		s.mu.Unlock()
	}
	if options.ReasoningEffort != "" && options.ReasoningEffort != current.ReasoningEffort {
		if _, err := s.call(ctx, "", map[string]any{"type": "set_thinking_level", "level": options.ReasoningEffort}); err != nil {
			return NativeTurnResult{}, fmt.Errorf("omp set_thinking_level %s: %w", options.ReasoningEffort, err)
		}
		s.mu.Lock()
		s.info.ReasoningEffort = options.ReasoningEffort
		s.mu.Unlock()
	}
	if _, err := s.call(ctx, turn.promptID, map[string]any{"type": "prompt", "message": text}); err != nil {
		if ctx.Err() == nil && s.ctx.Err() == nil {
			// A rejected prompt never started; the process remains usable.
			return NativeTurnResult{TurnID: turn.id, Status: "failed"}, fmt.Errorf("omp rejected the prompt: %w", err)
		}
		s.fail(fmt.Errorf("omp prompt delivery outcome unknown: %w", err))
		_ = s.Close()
		return NativeTurnResult{TurnID: turn.id, Status: "unknown"}, err
	}
	threadID := s.ThreadID()
	started, _ := json.Marshal(map[string]any{"threadId": threadID, "turn": map[string]any{"id": turn.id, "status": "inProgress"}})
	s.emit(NativeEvent{Type: "turn/started", ThreadID: threadID, TurnID: turn.id, Payload: started})
	select {
	case result := <-turn.resultCh:
		if result.Status == "failed" {
			return result, fmt.Errorf("omp turn failed: %s", turn.stopError)
		}
		return result, nil
	case <-ctx.Done():
		abortCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, _ = s.call(abortCtx, "", map[string]any{"type": "abort"})
		cancel()
		s.fail(fmt.Errorf("turn interrupted after caller cancellation: %w", ctx.Err()))
		_ = s.Close()
		return NativeTurnResult{TurnID: turn.id, Status: "unknown"}, ctx.Err()
	case <-s.done:
		_ = s.Close()
		return NativeTurnResult{TurnID: turn.id, Status: "failed"}, fmt.Errorf("omp session ended before a result: %w", s.err())
	}
}

// Interrupt aborts the active turn in-band; omp keeps the session and reports
// prompt_result status "aborted".
func (s *OMPNativeSession) Interrupt(ctx context.Context) error {
	s.mu.Lock()
	active := s.turn != nil
	s.mu.Unlock()
	if !active {
		return errors.New("no active native turn")
	}
	_, err := s.call(ctx, "", map[string]any{"type": "abort"})
	return err
}

// RespondRequest answers an omp dialog. Approval selects take Codex decisions
// (accept/acceptForSession/decline/cancel); other dialogs take one answer.
func (s *OMPNativeSession) RespondRequest(ctx context.Context, id string, answer json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	pending, ok := s.requests[id]
	active := s.turn != nil && pending.turnID == s.turn.id
	s.mu.Unlock()
	if !ok || !active {
		return errors.New("native request is no longer pending")
	}
	response, err := ompDialogResponse(pending, answer)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if _, ok = s.requests[id]; !ok {
		s.mu.Unlock()
		return errors.New("native request already answered")
	}
	delete(s.requests, id)
	s.mu.Unlock()
	response["type"] = "extension_ui_response"
	response["id"] = id
	if err = s.write(response); err != nil {
		s.fail(fmt.Errorf("request response delivery unknown: %w", err))
		return err
	}
	threadID := s.ThreadID()
	resolved, _ := json.Marshal(map[string]any{"threadId": threadID, "requestId": id})
	s.emit(NativeEvent{Type: "serverRequest/resolved", ThreadID: threadID, TurnID: pending.turnID, RequestID: id, Payload: resolved})
	return nil
}

func ompDialogResponse(pending ompPendingRequest, answer json.RawMessage) (map[string]any, error) {
	var value map[string]json.RawMessage
	if json.Unmarshal(answer, &value) != nil || value == nil {
		return nil, errors.New("request response must be an object")
	}
	switch pending.method {
	case "item/commandExecution/requestApproval":
		var decision string
		if json.Unmarshal(value["decision"], &decision) != nil {
			return nil, errors.New("approval decision must be a string")
		}
		switch decision {
		case "accept", "acceptForSession":
			if pending.dialog == "confirm" {
				return map[string]any{"confirmed": true}, nil
			}
			return map[string]any{"value": pending.approve}, nil
		case "decline":
			if pending.dialog == "confirm" {
				return map[string]any{"confirmed": false}, nil
			}
			return map[string]any{"value": pending.deny}, nil
		case "cancel":
			return map[string]any{"cancelled": true}, nil
		}
		return nil, errors.New("unsupported approval decision")
	case "item/tool/requestUserInput":
		var answers map[string]struct {
			Answers []string `json:"answers"`
		}
		if json.Unmarshal(value["answers"], &answers) != nil {
			return nil, errors.New("question answers are required")
		}
		a, ok := answers["answer"]
		if !ok || len(a.Answers) == 0 || strings.TrimSpace(a.Answers[0]) == "" {
			return nil, errors.New("missing question answer")
		}
		return map[string]any{"value": a.Answers[0]}, nil
	}
	return nil, fmt.Errorf("unsupported native request %s", pending.method)
}

// Close ends the session with stdin EOF (omp exits cleanly), killing the
// process only if it does not exit in time.
func (s *OMPNativeSession) Close() error {
	var closeErr error
	s.closeOnce.Do(func() {
		_ = s.stdin.Close()
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
			if s.cmd.Process != nil {
				if err := s.cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
					closeErr = err
				}
			}
		}
		s.cancel()
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
			if closeErr == nil {
				closeErr = errors.New("omp process termination remains unconfirmed")
			}
		}
		if s.release != nil {
			s.release()
		}
	})
	return closeErr
}

func (s *OMPNativeSession) err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failure != nil {
		return s.failure
	}
	return io.EOF
}

func (s *OMPNativeSession) fail(err error) {
	s.mu.Lock()
	if s.failure == nil {
		s.failure = err
	}
	responses := s.responses
	s.responses = map[string]chan ompResponse{}
	s.mu.Unlock()
	select {
	case s.readyCh <- err:
	default:
	}
	for _, ch := range responses {
		select {
		case ch <- ompResponse{err: err}:
		default:
		}
	}
}

func (s *OMPNativeSession) write(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write(append(raw, '\n'))
	return err
}

// call sends one rpc command and waits for its correlated response. id may be
// preset (prompt ids also correlate prompt_result).
func (s *OMPNativeSession) call(ctx context.Context, id string, command map[string]any) (json.RawMessage, error) {
	if id == "" {
		id = fmt.Sprintf("orchestra-%d", s.seq.Add(1))
	}
	command["id"] = id
	ch := make(chan ompResponse, 1)
	s.mu.Lock()
	if s.failure != nil {
		err := s.failure
		s.mu.Unlock()
		return nil, err
	}
	s.responses[id] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.responses, id)
		s.mu.Unlock()
	}()
	if err := s.write(command); err != nil {
		return nil, err
	}
	select {
	case r := <-ch:
		return r.data, r.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.done:
		return nil, s.err()
	}
}

func (s *OMPNativeSession) emit(e NativeEvent) {
	if s.onEvent != nil {
		s.onEvent(e)
	}
}

func (s *OMPNativeSession) read(r io.Reader) {
	scanner := bufio.NewScanner(r)
	// agent_end repeats a turn's messages, so frames can be large.
	scanner.Buffer(make([]byte, 64*1024), 64<<20)
	for scanner.Scan() {
		var wire ompWire
		if err := json.Unmarshal(scanner.Bytes(), &wire); err != nil || wire.Type == "" {
			continue // omp may print non-protocol diagnostics; they carry no state.
		}
		s.handle(wire, scanner.Bytes())
	}
	if err := scanner.Err(); err != nil {
		s.fail(fmt.Errorf("omp stream read: %w", err))
	}
}

func (s *OMPNativeSession) handle(wire ompWire, line []byte) {
	switch wire.Type {
	case "ready":
		select {
		case s.readyCh <- nil:
		default:
		}
	case "response":
		s.mu.Lock()
		ch := s.responses[wire.ID]
		s.mu.Unlock()
		if ch == nil {
			return
		}
		response := ompResponse{data: wire.Data}
		if wire.Success == nil || !*wire.Success {
			response.err = errors.New(firstNonEmpty(wire.Error, wire.Command+" failed"))
		}
		select {
		case ch <- response:
		default:
		}
	case "message_update":
		s.messageUpdate(wire.AssistantMessageEvent)
	case "message_start":
		var message struct {
			Role string `json:"role"`
		}
		if json.Unmarshal(wire.Message, &message) == nil && message.Role == "assistant" {
			s.mu.Lock()
			if s.turn != nil {
				s.turn.message++
				s.turn.blocks = map[int]string{}
				s.turn.streamed = false
			}
			s.mu.Unlock()
		}
	case "message_end":
		s.messageEnd(wire.Message)
	case "tool_execution_start", "tool_execution_end":
		s.toolEvent(wire)
	case "extension_ui_request":
		s.dialog(wire, line)
	case "prompt_result":
		s.promptResult(wire)
	}
}

func (s *OMPNativeSession) turnIDs() (string, string, *ompTurn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.turn == nil {
		return s.threadID, "", nil
	}
	return s.threadID, s.turn.id, s.turn
}

func (s *OMPNativeSession) messageUpdate(raw json.RawMessage) {
	var update struct {
		Type         string `json:"type"`
		ContentIndex int    `json:"contentIndex"`
		Delta        string `json:"delta"`
		Content      string `json:"content"`
	}
	if json.Unmarshal(raw, &update) != nil {
		return
	}
	s.mu.Lock()
	turn := s.turn
	if turn == nil {
		s.mu.Unlock()
		return
	}
	threadID, turnID := s.threadID, turn.id
	item := turn.blocks[update.ContentIndex]
	switch update.Type {
	case "text_start", "thinking_start":
		kind := "text"
		if update.Type == "thinking_start" {
			kind = "thinking"
		}
		item = fmt.Sprintf("%s:%s:%d:%d", turnID, kind, turn.message, update.ContentIndex)
		turn.blocks[update.ContentIndex] = item
	case "text_delta":
		if item == "" {
			item = fmt.Sprintf("%s:text:%d:%d", turnID, turn.message, update.ContentIndex)
			turn.blocks[update.ContentIndex] = item
		}
		if update.Delta != "" && !turn.streamed && turn.output.Len() > 0 {
			turn.output.WriteString("\n\n")
		}
		turn.output.WriteString(update.Delta)
		if update.Delta != "" {
			turn.streamed = true
		}
	}
	s.mu.Unlock()
	switch update.Type {
	case "text_delta":
		if update.Delta == "" {
			return
		}
		payload, _ := json.Marshal(map[string]any{"threadId": threadID, "turnId": turnID, "itemId": item, "delta": update.Delta})
		s.emit(NativeEvent{Type: "item/agentMessage/delta", ThreadID: threadID, TurnID: turnID, ItemID: item, Delta: update.Delta, Payload: payload})
	case "thinking_start":
		s.emit(ompReasoningItem("item/started", threadID, turnID, item, nil))
	case "thinking_delta":
		if update.Delta == "" || item == "" {
			return
		}
		payload, _ := json.Marshal(map[string]any{"itemId": item, "delta": update.Delta, "summaryIndex": 0})
		s.emit(NativeEvent{Type: "item/reasoning/summaryTextDelta", ThreadID: threadID, TurnID: turnID, ItemID: item, Delta: update.Delta, Payload: payload})
	case "thinking_end":
		if item == "" {
			return
		}
		var summary []string
		if strings.TrimSpace(update.Content) != "" {
			summary = []string{update.Content}
		}
		s.emit(ompReasoningItem("item/completed", threadID, turnID, item, summary))
	}
}

func ompReasoningItem(kind, threadID, turnID, id string, summary []string) NativeEvent {
	if summary == nil {
		summary = []string{}
	}
	payload, _ := json.Marshal(map[string]any{"threadId": threadID, "turnId": turnID, "item": map[string]any{"id": id, "type": "reasoning", "summary": summary, "content": []string{}}})
	return NativeEvent{Type: kind, ThreadID: threadID, TurnID: turnID, ItemID: id, Payload: payload}
}

// messageEnd records usage for every assistant message and keeps the final
// text for messages that did not stream deltas.
func (s *OMPNativeSession) messageEnd(raw json.RawMessage) {
	var message map[string]any
	if json.Unmarshal(raw, &message) != nil || message["role"] != "assistant" {
		return
	}
	usage := ompUsage(nestedMap(message, "usage"))
	s.mu.Lock()
	turn := s.turn
	threadID := s.threadID
	turnID := ""
	if turn != nil {
		turnID = turn.id
		if !turn.streamed {
			if text := ompMessageText(message); text != "" {
				if turn.output.Len() > 0 {
					turn.output.WriteString("\n\n")
				}
				turn.output.WriteString(text)
			}
		}
		turn.stopError = ""
		if message["stopReason"] == "error" {
			turn.stopError = firstNonEmpty(firstString(message, "errorMessage"), "provider error")
		}
	}
	s.total.InputTokens += usage.InputTokens
	s.total.OutputTokens += usage.OutputTokens
	s.total.CacheReadTokens += usage.CacheReadTokens
	s.total.CacheWriteTokens += usage.CacheWriteTokens
	s.total.ThinkingTokens += usage.ThinkingTokens
	s.total.TotalTokens += usage.TotalTokens
	total, window := s.total, s.window
	s.mu.Unlock()
	if usage == (TokenUsage{}) {
		return
	}
	breakdown := func(u TokenUsage) map[string]int64 {
		return map[string]int64{"inputTokens": u.InputTokens, "outputTokens": u.OutputTokens, "cachedInputTokens": u.CacheReadTokens, "cacheWriteInputTokens": u.CacheWriteTokens, "reasoningOutputTokens": u.ThinkingTokens, "totalTokens": u.TotalTokens}
	}
	tokenUsage := map[string]any{"last": breakdown(usage), "total": breakdown(total)}
	if window > 0 {
		tokenUsage["modelContextWindow"] = window
	}
	payload, _ := json.Marshal(map[string]any{"threadId": threadID, "turnId": turnID, "tokenUsage": tokenUsage})
	s.emit(NativeEvent{Type: "thread/tokenUsage/updated", ThreadID: threadID, TurnID: turnID, Payload: payload, Usage: nativeUsage(payload)})
}

// toolEvent renders omp tool executions as the item kinds the chat displays:
// bash as a command, edits/writes as file changes, everything else as a tool.
func (s *OMPNativeSession) toolEvent(wire ompWire) {
	threadID, turnID, turn := s.turnIDs()
	if turn == nil || wire.ToolCallID == "" {
		return
	}
	s.mu.Lock()
	if len(wire.Args) > 0 {
		turn.toolArgs[wire.ToolCallID] = wire.Args
	} else {
		wire.Args = turn.toolArgs[wire.ToolCallID]
	}
	s.mu.Unlock()
	var args map[string]any
	_ = json.Unmarshal(wire.Args, &args)
	completed := wire.Type == "tool_execution_end"
	status := "inProgress"
	output := ""
	if completed {
		status = "completed"
		if wire.IsError {
			status = "failed"
		}
		var result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if json.Unmarshal(wire.Result, &result) == nil {
			var parts []string
			for _, part := range result.Content {
				if part.Type == "text" && part.Text != "" {
					parts = append(parts, part.Text)
				}
			}
			output = strings.Join(parts, "\n")
		}
		if len(output) > 64*1024 {
			output = output[:64*1024] + "\n[output truncated]"
		}
	}
	item := map[string]any{"id": wire.ToolCallID, "status": status}
	switch wire.ToolName {
	case "bash":
		item["type"] = "commandExecution"
		item["command"] = firstString(args, "command")
		item["cwd"] = firstString(args, "cwd")
		if completed {
			item["aggregatedOutput"] = output
		}
	case "edit", "write":
		path := firstString(args, "path", "file_path")
		changeKind := "update"
		if wire.ToolName == "write" {
			changeKind = "add"
		}
		item["type"] = "fileChange"
		item["changes"] = []map[string]any{{"path": path, "kind": map[string]string{"type": changeKind}}}
	default:
		item["type"] = "mcpToolCall"
		item["server"] = "omp"
		item["tool"] = wire.ToolName
		item["arguments"] = args
		if completed {
			item["result"] = output
		}
	}
	kind := "item/started"
	if completed {
		kind = "item/completed"
	}
	payload, _ := json.Marshal(map[string]any{"threadId": threadID, "turnId": turnID, "item": item})
	s.emit(NativeEvent{Type: kind, ThreadID: threadID, TurnID: turnID, ItemID: wire.ToolCallID, Payload: payload})
}

// dialog turns omp's blocking extension UI dialogs into server requests.
// Fire-and-forget UI methods (setWidget, notify, setStatus, ...) are ignored.
func (s *OMPNativeSession) dialog(wire ompWire, _ []byte) {
	if wire.ID == "" {
		return
	}
	var message string
	_ = json.Unmarshal(wire.Message, &message)
	options := make([]string, 0, len(wire.Options))
	for _, raw := range wire.Options {
		var label string
		if json.Unmarshal(raw, &label) != nil {
			var object struct {
				Label string `json:"label"`
				Value string `json:"value"`
			}
			_ = json.Unmarshal(raw, &object)
			label = firstNonEmpty(object.Value, object.Label)
		}
		if label != "" {
			options = append(options, label)
		}
	}
	pending := ompPendingRequest{dialog: wire.Method}
	var params map[string]any
	prompt := strings.TrimSpace(strings.TrimSpace(wire.Title) + "\n" + message)
	switch wire.Method {
	case "select":
		for _, option := range options {
			switch strings.ToLower(option) {
			case "approve", "allow", "yes":
				pending.approve = option
			case "deny", "reject", "no":
				pending.deny = option
			}
		}
		if pending.approve != "" && pending.deny != "" {
			pending.method = "item/commandExecution/requestApproval"
			params = map[string]any{"command": prompt, "reason": wire.Title, "options": options}
			break
		}
		questionOptions := make([]map[string]string, 0, len(options))
		for _, option := range options {
			questionOptions = append(questionOptions, map[string]string{"label": option})
		}
		pending.method = "item/tool/requestUserInput"
		params = map[string]any{"questions": []map[string]any{{"id": "answer", "header": wire.Title, "question": prompt, "options": questionOptions}}}
	case "confirm":
		pending.method = "item/commandExecution/requestApproval"
		params = map[string]any{"command": prompt, "reason": wire.Title}
	case "input", "editor":
		pending.method = "item/tool/requestUserInput"
		params = map[string]any{"questions": []map[string]any{{"id": "answer", "header": wire.Title, "question": firstNonEmpty(prompt, wire.Placeholder)}}}
	default:
		return
	}
	s.mu.Lock()
	turn := s.turn
	threadID := s.threadID
	if turn != nil {
		pending.turnID = turn.id
		params["threadId"], params["turnId"] = threadID, turn.id
		s.requests[wire.ID] = pending
	}
	s.mu.Unlock()
	if turn == nil {
		// Dialogs outside an Orchestra turn cannot be answered by a person.
		_ = s.write(map[string]any{"type": "extension_ui_response", "id": wire.ID, "cancelled": true})
		return
	}
	payload, _ := json.Marshal(map[string]any{"method": pending.method, "params": params})
	s.emit(NativeEvent{Type: "server_request", ThreadID: threadID, TurnID: turn.id, ItemID: wire.ID, RequestID: wire.ID, Payload: payload})
}

func (s *OMPNativeSession) promptResult(wire ompWire) {
	s.mu.Lock()
	turn := s.turn
	if turn == nil || wire.ID != turn.promptID {
		s.mu.Unlock()
		return
	}
	threadID := s.threadID
	info := s.info
	text := turn.output.String()
	stopError := turn.stopError
	s.mu.Unlock()
	status := "failed"
	switch wire.Status {
	case "completed":
		status = "completed"
		if stopError != "" {
			status = "failed"
		}
	case "aborted":
		status = "interrupted"
	}
	if status == "failed" && stopError == "" {
		s.mu.Lock()
		turn.stopError = firstNonEmpty(wire.Error, "prompt status "+wire.Status)
		stopError = turn.stopError
		s.mu.Unlock()
	}
	turnPayload := map[string]any{"id": turn.id, "status": status}
	if status == "failed" {
		turnPayload["error"] = map[string]string{"message": stopError}
	}
	payload, _ := json.Marshal(map[string]any{"threadId": threadID, "turn": turnPayload})
	s.emit(NativeEvent{Type: "turn/completed", ThreadID: threadID, TurnID: turn.id, Payload: payload})
	select {
	case turn.resultCh <- NativeTurnResult{TurnID: turn.id, Status: status, Text: text, Model: info.Model, ReasoningEffort: info.ReasoningEffort}:
	default:
	}
}

// boundedTail keeps the last bytes of a diagnostic stream.
type boundedTail struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (b *boundedTail) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = b.data[len(b.data)-b.limit:]
	}
	return len(p), nil
}

func (b *boundedTail) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}

func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" && !strings.HasPrefix(line, "Run `omp") {
			return line
		}
	}
	return ""
}
