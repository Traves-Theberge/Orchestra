package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
)

type AntigravityACPCapabilities struct {
	LoadSession bool `json:"loadSession"`
	Prompt      struct {
		Image           bool `json:"image"`
		Audio           bool `json:"audio"`
		EmbeddedContext bool `json:"embeddedContext"`
	} `json:"promptCapabilities"`
	Sessions struct {
		Resume *json.RawMessage `json:"resume"`
	} `json:"sessionCapabilities"`
}

type AntigravityACPInitialize struct {
	ProtocolVersion   int                        `json:"protocolVersion"`
	AgentCapabilities AntigravityACPCapabilities `json:"agentCapabilities"`
	AuthMethods       []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"authMethods"`
}

type AntigravityACPUpdate struct {
	SessionID string `json:"sessionId"`
	Update    struct {
		Kind    string `json:"sessionUpdate"`
		Content *struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content,omitempty"`
		ToolCallID string `json:"toolCallId,omitempty"`
		Status     string `json:"status,omitempty"`
	} `json:"update"`
	Raw json.RawMessage `json:"-"`
}

type AntigravityACPPermission struct {
	SessionID string `json:"sessionId"`
	ToolCall  struct {
		ID    string `json:"toolCallId"`
		Title string `json:"title"`
	} `json:"toolCall"`
	Options []struct {
		ID   string `json:"optionId"`
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"options"`
}

func (p AntigravityACPPermission) IsQuestion() bool {
	return strings.HasPrefix(p.ToolCall.ID, "interaction_")
}

type AntigravityACPDecision struct {
	OptionID  string
	Cancelled bool
}
type AntigravityACPHandlers struct {
	OnUpdate func(AntigravityACPUpdate)
	// Permission must honor context cancellation. This fixture boundary does not
	// provide a durable desktop approval queue or detached handler supervision.
	Permission func(context.Context, AntigravityACPPermission) (AntigravityACPDecision, error)
}

type AntigravityACPPromptResult struct {
	SessionID            string
	StopReason           string
	CancelRequested      bool
	CancellationObserved bool
}

type AntigravityACPRemoteError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *AntigravityACPRemoteError) Error() string {
	return fmt.Sprintf("ACP peer error %d: %s", e.Code, e.Message)
}

// AntigravityACPClient is an unwired ACP v1 text-only, single-session transport.
// Calls serialize, while Cancel can write during Prompt. It advertises no client
// filesystem/terminal capabilities. New clients are required after transport loss.
type AntigravityACPClient struct {
	stream           io.ReadWriteCloser
	scanner          *bufio.Scanner
	callGate         chan struct{}
	writeMu          sync.Mutex
	mu               sync.Mutex
	failed           error
	nextID           int64
	initialized      bool
	capabilities     AntigravityACPCapabilities
	sessionID        string
	prompting        bool
	promptDispatched bool
	promptGeneration uint64
	cancelRequested  bool
	permissionCancel context.CancelFunc
	peerRequests     map[string]bool
	handlers         AntigravityACPHandlers
}

func NewAntigravityACPClient(stream io.ReadWriteCloser, handlers AntigravityACPHandlers) *AntigravityACPClient {
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	return &AntigravityACPClient{stream: stream, scanner: scanner, handlers: handlers, peerRequests: make(map[string]bool), callGate: make(chan struct{}, 1)}
}

func (c *AntigravityACPClient) fail(err error) error {
	c.mu.Lock()
	if c.failed == nil {
		c.failed = err
	}
	err = c.failed
	cancel := c.permissionCancel
	c.permissionCancel = nil
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	_ = c.stream.Close()
	return err
}

func (c *AntigravityACPClient) Close() error { return c.fail(errors.New("ACP connection closed")) }

func (c *AntigravityACPClient) write(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.writeLocked(value)
}

func (c *AntigravityACPClient) writeLocked(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	for len(data) > 0 {
		n, err := c.stream.Write(data)
		if err != nil {
			return c.fail(fmt.Errorf("ACP write failed; delivery may be uncertain: %w", err))
		}
		if n == 0 {
			return c.fail(io.ErrShortWrite)
		}
		data = data[n:]
	}
	return nil
}

type antigravityACPWire struct {
	Version string                     `json:"jsonrpc"`
	ID      json.RawMessage            `json:"id,omitempty"`
	Method  string                     `json:"method,omitempty"`
	Params  json.RawMessage            `json:"params,omitempty"`
	Result  json.RawMessage            `json:"result,omitempty"`
	Error   *AntigravityACPRemoteError `json:"error,omitempty"`
}

// acquireCall honors a queued caller's deadline without touching the active
// transport. Only admitted calls may register transport cancellation.
func (c *AntigravityACPClient) acquireCall(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case c.callGate <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-c.callGate
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *AntigravityACPClient) releaseCall() { <-c.callGate }

// call requires admission. Context expiry retires the connection, never replays.
func (c *AntigravityACPClient) call(ctx context.Context, method string, params any, result any) error {
	c.mu.Lock()
	if c.failed != nil {
		err := c.failed
		c.mu.Unlock()
		return err
	}
	c.nextID++
	requestID := fmt.Sprintf("orchestra-acp-%d", c.nextID)
	c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { c.fail(fmt.Errorf("ACP request interrupted; delivery may be uncertain: %w", ctx.Err())) })
	defer stop()
	if err := c.write(map[string]any{"jsonrpc": "2.0", "id": requestID, "method": method, "params": params}); err != nil {
		return err
	}
	if method == "session/prompt" {
		c.mu.Lock()
		c.promptDispatched = true
		c.mu.Unlock()
	}
	for c.scanner.Scan() {
		var wire antigravityACPWire
		if err := json.Unmarshal(c.scanner.Bytes(), &wire); err != nil || wire.Version != "2.0" {
			return c.fail(errors.New("malformed ACP JSON-RPC record"))
		}
		if wire.Method != "" {
			if wire.Result != nil || wire.Error != nil {
				return c.fail(errors.New("ambiguous ACP message"))
			}
			if err := c.handlePeer(ctx, wire); err != nil {
				return c.fail(err)
			}
			continue
		}
		var responseID string
		if json.Unmarshal(wire.ID, &responseID) != nil || responseID != requestID {
			return c.fail(errors.New("unknown, stale or duplicate ACP response identity"))
		}
		if (wire.Result == nil) == (wire.Error == nil) {
			return c.fail(errors.New("ACP response requires exactly one result or error"))
		}
		if wire.Error != nil {
			return wire.Error
		}
		if len(wire.Result) == 0 || wire.Result[0] != '{' {
			return c.fail(errors.New("ACP result must be an object"))
		}
		if err := json.Unmarshal(wire.Result, result); err != nil {
			return c.fail(errors.New("malformed ACP typed result"))
		}
		return nil
	}
	err := c.scanner.Err()
	if err == nil {
		err = io.ErrUnexpectedEOF
	}
	return c.fail(fmt.Errorf("ACP connection lost; request delivery may be uncertain: %w", err))
}

func (c *AntigravityACPClient) handlePeer(ctx context.Context, wire antigravityACPWire) error {
	c.mu.Lock()
	sessionID, prompting, cancelled := c.sessionID, c.prompting, c.cancelRequested
	c.mu.Unlock()
	if wire.ID == nil {
		if wire.Method != "session/update" {
			return fmt.Errorf("unsupported ACP notification %q", wire.Method)
		}
		var update AntigravityACPUpdate
		if json.Unmarshal(wire.Params, &update) != nil || sessionID == "" || update.SessionID != sessionID {
			return errors.New("unscoped ACP session update")
		}
		switch update.Update.Kind {
		case "agent_message_chunk", "user_message_chunk", "agent_thought_chunk":
			if update.Update.Content == nil || update.Update.Content.Type != "text" {
				return errors.New("unsupported ACP update content")
			}
		case "tool_call", "tool_call_update":
			if update.Update.ToolCallID == "" {
				return errors.New("ACP tool update has no identity")
			}
		default:
			return fmt.Errorf("unsupported ACP update %q", update.Update.Kind)
		}
		update.Raw = append(json.RawMessage(nil), wire.Params...)
		if c.handlers.OnUpdate != nil {
			c.handlers.OnUpdate(update)
		}
		return nil
	}
	var id any
	if json.Unmarshal(wire.ID, &id) != nil || id == nil {
		return errors.New("invalid ACP peer request identity")
	}
	if _, stringID := id.(string); !stringID {
		if _, numberID := id.(float64); !numberID {
			return errors.New("invalid ACP peer request identity")
		}
	}
	key := string(wire.ID)
	if c.peerRequests[key] {
		return errors.New("duplicate ACP peer request identity")
	}
	c.peerRequests[key] = true
	if wire.Method != "session/request_permission" {
		return c.write(map[string]any{"jsonrpc": "2.0", "id": wire.ID, "error": AntigravityACPRemoteError{-32601, "Unsupported client method"}})
	}
	var permission AntigravityACPPermission
	if json.Unmarshal(wire.Params, &permission) != nil || !prompting || permission.SessionID != sessionID || permission.ToolCall.ID == "" || len(permission.Options) == 0 {
		return errors.New("invalid or unscoped ACP permission request")
	}
	options := make(map[string]bool)
	for _, option := range permission.Options {
		if strings.TrimSpace(option.ID) == "" || options[option.ID] {
			return errors.New("invalid ACP permission option identity")
		}
		options[option.ID] = true
	}
	decision := AntigravityACPDecision{Cancelled: true}
	if !cancelled && c.handlers.Permission != nil {
		permissionCtx, cancel := context.WithCancel(ctx)
		c.mu.Lock()
		c.permissionCancel = cancel
		if c.cancelRequested || c.failed != nil {
			cancel()
		}
		c.mu.Unlock()
		var err error
		decision, err = c.handlers.Permission(permissionCtx, permission)
		cancel()
		c.mu.Lock()
		c.permissionCancel = nil
		cancelled = c.cancelRequested
		c.mu.Unlock()
		if cancelled {
			decision = AntigravityACPDecision{Cancelled: true}
		} else if err != nil {
			return err
		}
	}
	outcome := map[string]any{"outcome": "cancelled"}
	if !decision.Cancelled {
		if !options[decision.OptionID] {
			return errors.New("ACP decision is not an offered option")
		}
		outcome = map[string]any{"outcome": "selected", "optionId": decision.OptionID}
	}
	return c.write(map[string]any{"jsonrpc": "2.0", "id": wire.ID, "result": map[string]any{"outcome": outcome}})
}

func (c *AntigravityACPClient) Initialize(ctx context.Context) (AntigravityACPInitialize, error) {
	if err := c.acquireCall(ctx); err != nil {
		return AntigravityACPInitialize{}, err
	}
	defer c.releaseCall()
	c.mu.Lock()
	initialized := c.initialized
	c.mu.Unlock()
	if initialized {
		return AntigravityACPInitialize{}, errors.New("ACP already initialized")
	}
	var result AntigravityACPInitialize
	err := c.call(ctx, "initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}, "clientInfo": map[string]string{"name": "orchestra-protocol-fixture", "version": "0.1"}}, &result)
	if err != nil {
		return result, err
	}
	if result.ProtocolVersion != 1 {
		return result, c.fail(errors.New("unsupported ACP protocol version"))
	}
	if resume := result.AgentCapabilities.Sessions.Resume; resume != nil {
		if len(*resume) == 0 || (*resume)[0] != '{' {
			return result, c.fail(errors.New("invalid ACP resume capability"))
		}
	}
	c.mu.Lock()
	c.initialized, c.capabilities = true, result.AgentCapabilities
	c.mu.Unlock()
	return result, nil
}

// OpenSession binds exactly one session. Method is new, load, or resume. No
// implicit latest session or authentication is performed. Load may replay updates.
func (c *AntigravityACPClient) OpenSession(ctx context.Context, method, cwd, sessionID string) (string, error) {
	if err := c.acquireCall(ctx); err != nil {
		return "", err
	}
	defer c.releaseCall()
	c.mu.Lock()
	initialized, bound, capabilities := c.initialized, c.sessionID, c.capabilities
	c.mu.Unlock()
	if !initialized || bound != "" || !filepath.IsAbs(cwd) {
		return "", errors.New("ACP session needs initialization, absolute workspace and an unbound client")
	}
	if method != "new" && method != "load" && method != "resume" {
		return "", errors.New("unsupported ACP session operation")
	}
	if method == "new" && sessionID != "" {
		return "", errors.New("new ACP session cannot select an existing identity")
	}
	if method != "new" && strings.TrimSpace(sessionID) == "" {
		return "", errors.New("ACP restore requires exact session identity")
	}
	if method == "load" && !capabilities.LoadSession {
		return "", errors.New("ACP session/load unsupported by peer")
	}
	if method == "resume" && capabilities.Sessions.Resume == nil {
		return "", errors.New("ACP session/resume unsupported by peer")
	}
	params := map[string]any{"cwd": cwd, "mcpServers": []any{}}
	if method != "new" {
		params["sessionId"] = sessionID
		c.mu.Lock()
		c.sessionID = sessionID
		c.mu.Unlock()
	}
	var result struct {
		SessionID string `json:"sessionId"`
	}
	if err := c.call(ctx, "session/"+method, params, &result); err != nil {
		c.mu.Lock()
		c.sessionID = ""
		c.mu.Unlock()
		return "", err
	}
	if method == "new" {
		sessionID = result.SessionID
	} else if result.SessionID != "" && result.SessionID != sessionID {
		return "", c.fail(errors.New("ACP restore identity mismatch"))
	}
	if strings.TrimSpace(sessionID) == "" {
		return "", c.fail(errors.New("ACP new session has no identity"))
	}
	c.mu.Lock()
	c.sessionID = sessionID
	c.mu.Unlock()
	return sessionID, nil
}

func (c *AntigravityACPClient) Prompt(ctx context.Context, text string) (AntigravityACPPromptResult, error) {
	if err := c.acquireCall(ctx); err != nil {
		return AntigravityACPPromptResult{}, err
	}
	defer c.releaseCall()
	c.mu.Lock()
	if c.sessionID == "" || strings.TrimSpace(text) == "" {
		c.mu.Unlock()
		return AntigravityACPPromptResult{}, errors.New("ACP prompt requires a bound session and text")
	}
	c.prompting, c.cancelRequested, c.promptDispatched = true, false, false
	c.promptGeneration++
	sessionID := c.sessionID
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.prompting, c.promptDispatched = false, false; c.mu.Unlock() }()
	var response struct {
		StopReason string `json:"stopReason"`
	}
	err := c.call(ctx, "session/prompt", map[string]any{"sessionId": sessionID, "prompt": []any{map[string]string{"type": "text", "text": text}}}, &response)
	c.mu.Lock()
	cancelled := c.cancelRequested
	c.mu.Unlock()
	result := AntigravityACPPromptResult{sessionID, response.StopReason, cancelled, response.StopReason == "cancelled"}
	if err != nil {
		return result, err
	}
	switch response.StopReason {
	case "end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled":
	default:
		return result, c.fail(errors.New("unsupported ACP prompt stop reason"))
	}
	return result, nil
}

// Cancel sends a notification; only Prompt's cancelled stop reason confirms
// protocol settlement. The caller still owns bounded waiting and process teardown.
func (c *AntigravityACPClient) Cancel(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	if c.failed != nil {
		err := c.failed
		c.mu.Unlock()
		return err
	}
	if !c.prompting || !c.promptDispatched {
		c.mu.Unlock()
		return errors.New("no dispatched ACP prompt to cancel")
	}
	sessionID := c.sessionID
	generation := c.promptGeneration
	c.mu.Unlock()
	return c.cancelPrompt(ctx, sessionID, generation)
}

func (c *AntigravityACPClient) cancelPrompt(ctx context.Context, sessionID string, generation uint64) error {
	stop := context.AfterFunc(ctx, func() {
		c.fail(fmt.Errorf("ACP cancel write interrupted; settlement unknown: %w", ctx.Err()))
	})
	defer stop()
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.mu.Lock()
	if c.failed != nil {
		err := c.failed
		c.mu.Unlock()
		return err
	}
	// Recheck under the same write lock that orders outbound prompts. A cancel
	// captured for an earlier turn must never arrive after its replacement.
	if !c.prompting || !c.promptDispatched || c.promptGeneration != generation || c.sessionID != sessionID {
		c.mu.Unlock()
		return errors.New("ACP cancel targets a settled or replaced prompt")
	}
	c.cancelRequested = true
	if c.permissionCancel != nil {
		c.permissionCancel()
	}
	c.mu.Unlock()
	return c.writeLocked(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": sessionID}})
}
