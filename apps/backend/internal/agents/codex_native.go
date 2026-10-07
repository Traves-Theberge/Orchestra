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
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/shellcommand"
)

type nativeRPC struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  json.RawMessage `json:"error,omitempty"`
}
type nativePendingRequest struct {
	id     json.RawMessage
	method string
	turn   string
	params json.RawMessage
}
type codexNativeSession struct {
	ctx              context.Context
	cancel           context.CancelFunc
	cmd              *exec.Cmd
	stdin            io.WriteCloser
	writeMu          sync.Mutex
	mu               sync.Mutex
	thread           string
	info             NativeModelInfo
	activeTurn       string
	starting         bool
	closed           bool
	failure          error
	nextID           int
	responses        map[string]chan nativeRPC
	requests         map[string]nativePendingRequest
	events           chan nativeRPC
	turnEvents       chan nativeRPC
	turnReady        chan struct{}
	knownTurns       map[string]bool
	knownTurnOrder   []string
	callbackEvents   chan NativeEvent
	callbackBarriers chan chan struct{}
	callbacksDone    chan struct{}
	pumpDone         chan struct{}
	done             chan struct{}
	onEvent          NativeEventHandler
	toolExecutor     ToolExecutor
	toolNames        map[string]bool
	toolContext      context.Context
	receipt          *agentReceipt
	cleanups         []func()
	cleanupOnce      sync.Once
}

// applyAgent maps the resolved agent and Orchestra MCP servers onto app-server
// thread parameters: config overrides (mcp_servers, model_reasoning_effort)
// and process-scoped skill roots. Instructions and model are set by the caller.
func (s *codexNativeSession) applyAgent(ctx context.Context, request TurnRequest) (map[string]any, error) {
	params := map[string]any{}
	config := map[string]any{}
	agent := request.Agent
	if agent != nil {
		s.receipt = &agentReceipt{agent: agent}
		if agent.Permissions.Restrictive() {
			s.receipt.skip("permissions")
		}
	}
	if agent != nil && agent.Effort != "" {
		if err := validateNativeReasoningEffort(agent.Effort); err != nil {
			return nil, fmt.Errorf("agent effort: %w", err)
		}
		config["model_reasoning_effort"] = agent.Effort
	}
	if servers := mcpForRun(request); len(servers) > 0 {
		mcpServers := map[string]any{}
		for _, srv := range servers {
			if srv.Remote() {
				entry := map[string]any{"url": srv.URL}
				if len(srv.Headers) > 0 {
					entry["http_headers"] = srv.Headers
				}
				mcpServers[srv.Name] = entry
				continue
			}
			entry := map[string]any{"command": srv.Command, "args": nonNilArgs(srv.Args)}
			if len(srv.Env) > 0 {
				entry["env"] = srv.Env
			}
			mcpServers[srv.Name] = entry
		}
		config["mcp_servers"] = mcpServers
	}
	if skills := nonNativeSkills(agent); len(skills) > 0 {
		dir, err := os.MkdirTemp("", "orchestra-codex-skills-*")
		if err != nil {
			return nil, err
		}
		s.cleanups = append(s.cleanups, func() { _ = os.RemoveAll(dir) })
		if err = stageSkills(dir, skills); err != nil {
			return nil, err
		}
		if _, err = s.rpc(ctx, "skills/extraRoots/set", map[string]any{"extraRoots": []string{dir}}); err != nil {
			return nil, fmt.Errorf("apply agent skills: %w", err)
		}
	}
	if len(config) > 0 {
		params["config"] = config
	}
	return params, nil
}

func (s *codexNativeSession) runCleanups() {
	s.cleanupOnce.Do(func() {
		for i := len(s.cleanups) - 1; i >= 0; i-- {
			s.cleanups[i]()
		}
	})
}

// startCodexNativeProcess only initializes the protocol, without creating a thread.
func startCodexNativeProcess(ctx context.Context, command string, request TurnRequest, onEvent NativeEventHandler) (*codexNativeSession, error) {
	if err := validateTurnWorkspace(request); err != nil {
		return nil, err
	}
	if strings.TrimSpace(command) == "" {
		return nil, errors.New("codex app-server command is empty")
	}
	childCtx, cancel := context.WithCancel(ctx)
	cmd, err := shellcommand.CommandContext(childCtx, command)
	if err != nil {
		cancel()
		return nil, err
	}
	cmd.Dir = request.Workspace
	if request.CredentialHome != "" {
		cmd.Env = accountSubprocessEnv(request.SessionID, ProviderCodex, request.CredentialHome)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	// Stderr is drained by os/exec, never mixed into the JSON protocol or exposed as credentials.
	cmd.Stderr = io.Discard
	s := &codexNativeSession{ctx: childCtx, cancel: cancel, cmd: cmd, stdin: stdin, responses: map[string]chan nativeRPC{}, requests: map[string]nativePendingRequest{}, events: make(chan nativeRPC, 256), done: make(chan struct{}), onEvent: onEvent}
	if err = cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start native Codex: %w", err)
	}
	go func() {
		s.read(stdout)
		err := cmd.Wait()
		s.mu.Lock()
		if s.failure == nil {
			if err != nil {
				s.failure = fmt.Errorf("native Codex exited: %w", err)
			} else {
				s.failure = io.EOF
			}
		}
		s.mu.Unlock()
		close(s.done)
	}()
	readyCtx, readyCancel := context.WithTimeout(ctx, 20*time.Second)
	defer readyCancel()
	fail := func(err error) (*codexNativeSession, error) { _ = s.Close(); return nil, err }
	_, err = s.rpc(readyCtx, "initialize", map[string]any{"clientInfo": map[string]string{"name": "orchestra", "title": "Orchestra", "version": "0.1.0"}, "capabilities": map[string]bool{"experimentalApi": true}})
	if err != nil {
		return fail(err)
	}
	if err = s.write(map[string]any{"method": "initialized", "params": map[string]any{}}); err != nil {
		return fail(err)
	}
	return s, nil
}

// NewCodexNativeSession owns one app-server process and one persistent provider thread.
// The caller must Close the session; neither interrupted turns nor idle periods reset it.
func NewCodexNativeSession(ctx context.Context, command string, request TurnRequest, threadID string, onEvent NativeEventHandler) (NativeSession, error) {
	s, err := startCodexNativeProcess(ctx, command, request, onEvent)
	if err != nil {
		return nil, err
	}
	readyCtx, readyCancel := context.WithTimeout(ctx, 20*time.Second)
	defer readyCancel()
	fail := func(err error) (NativeSession, error) { _ = s.Close(); return nil, err }
	method := "thread/start"
	params := map[string]any{"cwd": request.Workspace}
	applied, err := s.applyAgent(readyCtx, request)
	if err != nil {
		return fail(err)
	}
	for key, value := range applied {
		params[key] = value
	}
	if instructions := combineInstructions(request.DeveloperInstructions, request.Agent); instructions != "" {
		params["developerInstructions"] = instructions
	}
	// Dynamic tools are stored with the provider thread at creation. Resume reuses
	// those declarations; ThreadResumeParams does not accept dynamicTools.
	if threadID == "" && len(request.ToolSpecs) > 0 {
		params["dynamicTools"] = request.ToolSpecs
	}
	s.toolExecutor = request.ToolExecutor
	s.toolNames = map[string]bool{}
	for _, spec := range request.ToolSpecs {
		if name, ok := spec["name"].(string); ok {
			s.toolNames[name] = true
		}
	}
	if threadID != "" {
		method = "thread/resume"
		params["threadId"] = threadID
	}
	if model := effectiveModel(request); model != "" {
		params["model"] = model
	}
	// Native chat deliberately inherits provider sandbox/approval settings; never auto-approve.
	result, err := s.rpc(readyCtx, method, params)
	if err != nil {
		return fail(err)
	}
	var res struct {
		Thread struct {
			ID    string `json:"id"`
			Turns []struct {
				ID string `json:"id"`
			} `json:"turns"`
		} `json:"thread"`
		Model           string          `json:"model"`
		ReasoningEffort string          `json:"reasoningEffort"`
		ApprovalPolicy  json.RawMessage `json:"approvalPolicy"`
		Sandbox         struct {
			Type string `json:"type"`
		} `json:"sandbox"`
	}
	if err = json.Unmarshal(result, &res); err != nil || res.Thread.ID == "" {
		return fail(errors.New("native Codex returned no thread identity"))
	}
	if threadID != "" && res.Thread.ID != threadID {
		return fail(errors.New("native Codex resumed a different thread"))
	}
	var policy string
	_ = json.Unmarshal(res.ApprovalPolicy, &policy)
	s.mu.Lock()
	s.thread = res.Thread.ID
	s.info = NativeModelInfo{Model: res.Model, ApprovalPolicy: policy, SandboxMode: res.Sandbox.Type, ReasoningEffort: res.ReasoningEffort}
	if request.Agent != nil {
		s.info.AgentID = request.Agent.ID
		s.info.AgentObservation = s.receipt.observation()
	}
	s.knownTurns = map[string]bool{}
	for i, turn := range res.Thread.Turns {
		if i < len(res.Thread.Turns)-256 || turn.ID == "" {
			continue
		}
		s.knownTurns[turn.ID] = true
		s.knownTurnOrder = append(s.knownTurnOrder, turn.ID)
	}
	s.callbackEvents = make(chan NativeEvent, 4096)
	s.callbackBarriers = make(chan chan struct{})
	s.callbacksDone = make(chan struct{})
	s.pumpDone = make(chan struct{})
	s.mu.Unlock()
	go s.dispatchCallbacks()
	go s.pumpEvents()
	return s, nil
}

func (s *codexNativeSession) ThreadID() string { s.mu.Lock(); defer s.mu.Unlock(); return s.thread }
func (s *codexNativeSession) ModelInfo() NativeModelInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}
func (s *codexNativeSession) write(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write(append(b, '\n'))
	return err
}
func (s *codexNativeSession) rpc(ctx context.Context, method string, params any) (json.RawMessage, error) {
	// Response waits remain bounded even when invoked by an observer callback.
	// The protocol reader stays independent of the serialized observer dispatcher.
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, errors.New("native session closed")
	}
	s.nextID++
	id := s.nextID
	key := fmt.Sprint(id)
	ch := make(chan nativeRPC, 1)
	s.responses[key] = ch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.responses, key); s.mu.Unlock() }()
	if err := s.write(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	select {
	case msg := <-ch:
		if len(msg.Error) > 0 {
			return nil, fmt.Errorf("native Codex rejected %s: %s", method, msg.Error)
		}
		return msg.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.done:
		return nil, s.err()
	case <-s.ctx.Done():
		return nil, s.err()
	}
}
func (s *codexNativeSession) err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failure != nil {
		return s.failure
	}
	return errors.New("native session disconnected")
}
func (s *codexNativeSession) read(r io.Reader) {
	scan := bufio.NewScanner(r)
	scan.Buffer(make([]byte, 65536), 4<<20)
	for scan.Scan() {
		var msg nativeRPC
		if json.Unmarshal(scan.Bytes(), &msg) != nil {
			s.fail(errors.New("invalid native Codex JSON"))
			return
		}
		if msg.Method == "" {
			s.mu.Lock()
			ch := s.responses[string(msg.ID)]
			s.mu.Unlock()
			if ch != nil {
				select {
				case ch <- msg:
				default:
				}
			}
			continue
		}
		select {
		case s.events <- msg:
		case <-s.ctx.Done():
			return
		}
	}
	if err := scan.Err(); err != nil {
		s.fail(fmt.Errorf("native protocol read: %w", err))
	} else {
		s.fail(io.EOF)
	}
}
func (s *codexNativeSession) fail(err error) {
	s.mu.Lock()
	if s.failure == nil {
		s.failure = err
	}
	s.mu.Unlock()
	s.cancel()
}
func (s *codexNativeSession) emit(e NativeEvent) {
	s.callbackEvents <- e
}

// Callback dispatch is independent of provider protocol and turn completion.
// A callback may issue RPCs or await a later turn without stopping the reader.
func (s *codexNativeSession) dispatchCallbacks() {
	defer close(s.callbacksDone)
	invoke := func(e NativeEvent) {
		if s.onEvent != nil {
			s.onEvent(e)
		}
	}
	for {
		select {
		case e, ok := <-s.callbackEvents:
			if !ok {
				return
			}
			invoke(e)
		case ack := <-s.callbackBarriers:
		drain:
			for {
				select {
				case e, ok := <-s.callbackEvents:
					if !ok {
						close(ack)
						return
					}
					invoke(e)
				default:
					break drain
				}
			}
			close(ack)
		}
	}
}

// DrainEvents is an optional observation barrier for service shutdown/tests.
// It must be called outside the callback itself.
func (s *codexNativeSession) DrainEvents(ctx context.Context) error {
	if s.callbacksDone == nil {
		return nil
	}
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		select {
		case <-s.callbacksDone:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	ack := make(chan struct{})
	select {
	case s.callbackBarriers <- ack:
	case <-s.callbacksDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-ack:
		return nil
	case <-s.callbacksDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *codexNativeSession) pumpEvents() {
	defer close(s.pumpDone)
	defer close(s.callbackEvents)
	process := func(msg nativeRPC, closing bool) {
		var p struct {
			ThreadID  string              `json:"threadId"`
			TurnID    string              `json:"turnId"`
			ItemID    string              `json:"itemId"`
			Delta     string              `json:"delta"`
			Turn      struct{ ID string } `json:"turn"`
			Item      struct{ ID string } `json:"item"`
			RequestID json.RawMessage     `json:"requestId"`
		}
		if json.Unmarshal(msg.Params, &p) != nil {
			return
		}
		if p.TurnID == "" {
			p.TurnID = p.Turn.ID
		}
		s.mu.Lock()
		thread := s.thread
		starting := s.starting
		ready := s.turnReady
		s.mu.Unlock()
		if p.ThreadID != thread {
			if len(msg.ID) > 0 && !closing {
				s.serverRequest(msg)
			}
			return
		}
		if !closing && starting && p.TurnID != "" {
			select {
			case <-ready:
			case <-s.ctx.Done():
				return
			}
		}
		s.mu.Lock()
		known := p.TurnID == "" || s.knownTurns[p.TurnID]
		active := s.activeTurn
		turnEvents := s.turnEvents
		s.mu.Unlock()
		if !known {
			if len(msg.ID) > 0 && !closing {
				s.serverRequest(msg)
			}
			return
		}
		if len(msg.ID) > 0 {
			if !closing {
				s.serverRequest(msg)
			}
			return
		}
		if msg.Method == "serverRequest/resolved" {
			s.mu.Lock()
			delete(s.requests, string(p.RequestID))
			s.mu.Unlock()
		}
		if p.ItemID == "" {
			p.ItemID = p.Item.ID
		}
		e := NativeEvent{Type: msg.Method, ThreadID: p.ThreadID, TurnID: p.TurnID, ItemID: p.ItemID, Delta: p.Delta, Payload: msg.Params}
		if msg.Method == "thread/tokenUsage/updated" {
			e.Usage = nativeUsage(msg.Params)
		}
		s.emit(e)
		if !closing && p.TurnID == active && active != "" && turnEvents != nil {
			select {
			case turnEvents <- msg:
			case <-s.ctx.Done():
				return
			}
		}
	}
	for {
		select {
		case msg := <-s.events:
			process(msg, false)
		case <-s.ctx.Done():
			// Wait until the reader has stopped producing, then deliver every frame
			// already read before closing the callback queue. Unread OS-pipe bytes
			// cannot be acknowledged after forcibly interrupting the process.
			<-s.done
			for {
				select {
				case msg := <-s.events:
					process(msg, true)
				default:
					return
				}
			}
		}
	}
}
func (s *codexNativeSession) serverRequest(msg nativeRPC) {
	var p struct {
		ThreadID string `json:"threadId"`
		TurnID   string `json:"turnId"`
		ItemID   string `json:"itemId"`
	}
	_ = json.Unmarshal(msg.Params, &p)
	s.mu.Lock()
	valid := p.ThreadID == s.thread && p.TurnID != "" && (p.TurnID == s.activeTurn || s.starting)
	key := string(msg.ID)
	if valid {
		s.requests[key] = nativePendingRequest{id: msg.ID, method: msg.Method, turn: p.TurnID, params: msg.Params}
	}
	s.mu.Unlock()
	if !valid {
		_ = s.write(map[string]any{"id": msg.ID, "error": map[string]any{"code": -32600, "message": "Request outside active Orchestra turn"}})
		return
	}
	if msg.Method == "item/tool/call" {
		s.executeDynamicTool(msg)
		return
	}
	if msg.Method != "item/commandExecution/requestApproval" && msg.Method != "item/fileChange/requestApproval" && msg.Method != "item/tool/requestUserInput" {
		_ = s.write(map[string]any{"id": msg.ID, "error": map[string]any{"code": -32601, "message": "Native request unsupported by Orchestra"}})
		s.fail(fmt.Errorf("unsupported native request %s", msg.Method))
		return
	}
	payload, _ := json.Marshal(map[string]any{"method": msg.Method, "params": msg.Params})
	s.emit(NativeEvent{Type: "server_request", ThreadID: p.ThreadID, TurnID: p.TurnID, ItemID: p.ItemID, RequestID: key, Payload: payload})
}

// The reader remains independent while a bounded tool call executes. Only tools
// declared for this thread and requests belonging to its active turn may run.
func (s *codexNativeSession) executeDynamicTool(msg nativeRPC) {
	var p struct {
		ThreadID  string         `json:"threadId"`
		TurnID    string         `json:"turnId"`
		CallID    string         `json:"callId"`
		Namespace string         `json:"namespace"`
		Tool      string         `json:"tool"`
		Arguments map[string]any `json:"arguments"`
	}
	err := json.Unmarshal(msg.Params, &p)
	s.mu.Lock()
	executor, ctx := s.toolExecutor, s.toolContext
	allowed := s.toolNames[p.Tool] && executor != nil && ctx != nil && p.TurnID == s.activeTurn
	s.mu.Unlock()
	result := map[string]any{"success": false, "error": "Tool unavailable or outside active turn"}
	if err == nil && allowed && p.CallID != "" && p.Namespace == "" && p.Arguments != nil {
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if callCtx.Err() == nil {
			s.emit(NativeEvent{Type: "orchestra/tool/started", ThreadID: p.ThreadID, TurnID: p.TurnID, ItemID: p.CallID, Payload: msg.Params})
			result = executor(callCtx, p.Tool, p.Arguments)
		}
		cancel()
	}
	text, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		text = []byte(`{"success":false,"error":"Tool result encoding failed; inspect before repeating"}`)
	}
	success, _ := result["success"].(bool)
	if marshalErr != nil {
		success = false
	}
	response := map[string]any{"success": success, "contentItems": []map[string]string{{"type": "inputText", "text": string(text)}}}
	if err := s.write(map[string]any{"id": msg.ID, "result": response}); err != nil {
		s.fail(fmt.Errorf("native tool response outcome unknown: %w", err))
	}
	s.mu.Lock()
	delete(s.requests, string(msg.ID))
	s.mu.Unlock()
	s.emit(NativeEvent{Type: "orchestra/tool/completed", ThreadID: p.ThreadID, TurnID: p.TurnID, ItemID: p.CallID, Payload: json.RawMessage(text)})
}

func (s *codexNativeSession) SendTurn(ctx context.Context, text, model string) (NativeTurnResult, error) {
	return s.SendTurnWithOptions(ctx, text, NativeTurnOptions{Model: model})
}
func (s *codexNativeSession) SendTurnWithOptions(ctx context.Context, text string, options NativeTurnOptions) (NativeTurnResult, error) {
	if err := validateNativeReasoningEffort(options.ReasoningEffort); err != nil {
		return NativeTurnResult{}, err
	}
	model := options.Model
	if strings.TrimSpace(text) == "" {
		return NativeTurnResult{}, errors.New("native turn text is empty")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return NativeTurnResult{}, errors.New("native session closed")
	}
	if s.starting || s.activeTurn != "" {
		s.mu.Unlock()
		return NativeTurnResult{}, errors.New("native turn already active")
	}
	s.starting = true
	s.toolContext = ctx
	s.turnReady = make(chan struct{})
	s.turnEvents = make(chan nativeRPC, 256)
	turnEvents := s.turnEvents
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.starting = false
		s.activeTurn = ""
		s.toolContext = nil
		s.requests = map[string]nativePendingRequest{}
		s.mu.Unlock()
	}()
	params := map[string]any{"threadId": s.ThreadID(), "input": []map[string]string{{"type": "text", "text": text}}}
	// Model catalogs can default reasoning summaries to "none", leaving reasoning
	// items empty. The override is per turn and also applies to resumed threads.
	params["summary"] = "detailed"
	if model != "" {
		params["model"] = model
		s.mu.Lock()
		if model != s.info.Model {
			s.info.Model = ""
			s.info.ReasoningEffort = ""
		}
		s.mu.Unlock()
	}
	if options.ReasoningEffort != "" {
		params["effort"] = options.ReasoningEffort
		s.mu.Lock()
		if options.ReasoningEffort != s.info.ReasoningEffort {
			s.info.ReasoningEffort = ""
		}
		s.mu.Unlock()
	}
	result, err := s.rpc(ctx, "turn/start", params)
	if err != nil {
		s.fail(fmt.Errorf("turn dispatch outcome unknown: %w", err))
		_ = s.Close()
		return NativeTurnResult{}, err
	}
	var started struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if json.Unmarshal(result, &started) != nil || started.Turn.ID == "" {
		s.fail(errors.New("missing turn identity"))
		_ = s.Close()
		return NativeTurnResult{}, errors.New("native Codex returned no turn identity")
	}
	turnID := started.Turn.ID
	s.mu.Lock()
	s.activeTurn = turnID
	s.knownTurns[turnID] = true
	s.knownTurnOrder = append(s.knownTurnOrder, turnID)
	if len(s.knownTurnOrder) > 256 {
		delete(s.knownTurns, s.knownTurnOrder[0])
		s.knownTurnOrder = s.knownTurnOrder[1:]
	}
	s.starting = false
	close(s.turnReady)
	s.mu.Unlock()
	output := strings.Builder{}
	streamedItems := map[string]bool{}
	for {
		select {
		case msg := <-turnEvents:
			var p struct {
				ThreadID string `json:"threadId"`
				TurnID   string `json:"turnId"`
				ItemID   string `json:"itemId"`
				Delta    string `json:"delta"`
				Turn     struct {
					ID, Status string
					Error      json.RawMessage
				} `json:"turn"`
				Item      struct{ ID, Type, Text string } `json:"item"`
				RequestID json.RawMessage                 `json:"requestId"`
			}
			if json.Unmarshal(msg.Params, &p) != nil {
				continue
			}
			if p.TurnID == "" {
				p.TurnID = p.Turn.ID
			}
			if p.ThreadID != s.ThreadID() || (p.TurnID != "" && p.TurnID != turnID) {
				continue
			}
			if msg.Method == "serverRequest/resolved" {
				s.mu.Lock()
				delete(s.requests, string(p.RequestID))
				s.mu.Unlock()
			}
			if msg.Method == "item/agentMessage/delta" {
				output.WriteString(p.Delta)
				streamedItems[p.ItemID] = true
			}
			if msg.Method == "item/completed" && p.Item.Type == "agentMessage" && !streamedItems[p.Item.ID] {
				output.WriteString(p.Item.Text)
			}
			if p.ItemID == "" {
				p.ItemID = p.Item.ID
			}
			if msg.Method == "turn/completed" {
				info := s.ModelInfo()
				res := NativeTurnResult{TurnID: turnID, Status: p.Turn.Status, Text: output.String(), Model: info.Model, ReasoningEffort: info.ReasoningEffort}
				if p.Turn.Status == "failed" {
					return res, fmt.Errorf("native turn failed: %s", p.Turn.Error)
				}
				if p.Turn.Status != "completed" && p.Turn.Status != "interrupted" {
					return res, fmt.Errorf("unknown native terminal status %q", p.Turn.Status)
				}
				return res, nil
			}
		case <-ctx.Done():
			interruptCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = s.Interrupt(interruptCtx)
			cancel()
			s.fail(fmt.Errorf("turn interrupted after caller cancellation: %w", ctx.Err()))
			_ = s.Close()
			return NativeTurnResult{}, ctx.Err()
		case <-s.ctx.Done():
			_ = s.Close()
			return NativeTurnResult{}, s.err()
		case <-s.done:
			_ = s.Close()
			return NativeTurnResult{}, s.err()
		}
	}
}

// The installed protocol uses advertised non-empty strings, not a closed enum.
// Semantic support is checked against model/list by the service; this boundary
// rejects malformed identifiers before any turn RPC or process state change.
func validateNativeReasoningEffort(effort string) error {
	if effort == "" {
		return nil
	}
	if len(effort) > 32 {
		return errors.New("reasoning effort is too long")
	}
	for i, c := range effort {
		if c >= 'a' && c <= 'z' {
			continue
		}
		if i > 0 && (c >= '0' && c <= '9' || c == '_' || c == '-') {
			continue
		}
		return errors.New("reasoning effort must be a bounded lowercase identifier")
	}
	return nil
}
func (s *codexNativeSession) ListModels(ctx context.Context) (json.RawMessage, error) {
	return s.rpc(ctx, "model/list", map[string]any{"limit": 100})
}
func nativeUsage(raw json.RawMessage) *NativeUsage {
	type breakdown struct {
		Input      int64 `json:"inputTokens"`
		Output     int64 `json:"outputTokens"`
		Total      int64 `json:"totalTokens"`
		CacheRead  int64 `json:"cachedInputTokens"`
		CacheWrite int64 `json:"cacheWriteInputTokens"`
		Reasoning  int64 `json:"reasoningOutputTokens"`
	}
	var p struct {
		TokenUsage struct {
			Last   breakdown `json:"last"`
			Total  breakdown `json:"total"`
			Window *int64    `json:"modelContextWindow"`
		} `json:"tokenUsage"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return nil
	}
	convert := func(b breakdown) TokenUsage {
		return TokenUsage{InputTokens: b.Input, OutputTokens: b.Output, TotalTokens: b.Total, CacheReadTokens: b.CacheRead, CacheWriteTokens: b.CacheWrite, ThinkingTokens: b.Reasoning}
	}
	return &NativeUsage{Last: convert(p.TokenUsage.Last), Total: convert(p.TokenUsage.Total), ModelContextWindow: p.TokenUsage.Window}
}
func (s *codexNativeSession) Interrupt(ctx context.Context) error {
	s.mu.Lock()
	turn := s.activeTurn
	s.mu.Unlock()
	if turn == "" {
		return errors.New("no active native turn")
	}
	_, err := s.rpc(ctx, "turn/interrupt", map[string]string{"threadId": s.ThreadID(), "turnId": turn})
	return err
}
func (s *codexNativeSession) RespondRequest(ctx context.Context, id string, answer json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	pending, ok := s.requests[id]
	if !ok || pending.turn != s.activeTurn && !s.starting {
		s.mu.Unlock()
		return errors.New("native request is no longer pending")
	}
	s.mu.Unlock()
	if err := validateNativeAnswer(pending, answer); err != nil {
		return err
	}
	s.mu.Lock()
	if _, ok = s.requests[id]; !ok {
		s.mu.Unlock()
		return errors.New("native request already answered")
	}
	delete(s.requests, id)
	s.mu.Unlock()
	if err := s.write(map[string]any{"id": pending.id, "result": answer}); err != nil {
		s.fail(fmt.Errorf("request response delivery unknown: %w", err))
		return err
	}
	return nil
}
func validateNativeAnswer(p nativePendingRequest, answer json.RawMessage) error {
	var value map[string]json.RawMessage
	if json.Unmarshal(answer, &value) != nil || value == nil {
		return errors.New("request response must be an object")
	}
	switch p.method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		var decision string
		if json.Unmarshal(value["decision"], &decision) != nil {
			return errors.New("approval decision must be a string")
		}
		if decision != "accept" && decision != "acceptForSession" && decision != "decline" && decision != "cancel" {
			return errors.New("unsupported approval decision")
		}
	case "item/tool/requestUserInput":
		var answers map[string]struct {
			Answers []string `json:"answers"`
		}
		if json.Unmarshal(value["answers"], &answers) != nil || len(answers) == 0 {
			return errors.New("question answers are required")
		}
		var params struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		}
		_ = json.Unmarshal(p.params, &params)
		if len(answers) != len(params.Questions) {
			return errors.New("answers must match pending questions")
		}
		for _, q := range params.Questions {
			if a, ok := answers[q.ID]; !ok || len(a.Answers) == 0 {
				return errors.New("missing question answer")
			}
		}
	default:
		return fmt.Errorf("unsupported native request %s", p.method)
	}
	return nil
}
func (s *codexNativeSession) Close() error {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	s.cancel()
	_ = s.stdin.Close()
	<-s.done
	s.runCleanups()
	return nil
}
