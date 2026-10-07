package agents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"log"

	"github.com/acarl005/stripansi"
	"github.com/orchestra/orchestra/apps/backend/internal/shellcommand"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
)

// CommandRunner executes agent turns by spawning a shell command and parsing
// its stdout/stderr streams for structured events (SSE, JSON, or plain text).
// It supports both one-shot subprocess execution and persistent PTY sessions
// when a terminal.Manager is attached.
type CommandRunner struct {
	provider    Provider
	command     string
	termManager *terminal.Manager
}

// NewCommandRunner creates a CommandRunner for the given provider and shell command.
func NewCommandRunner(provider Provider, command string) *CommandRunner {
	return &CommandRunner{provider: provider, command: strings.TrimSpace(command)}
}

// WithTerminalManager attaches a terminal.Manager to enable PTY-based session
// execution. Returns the receiver for method chaining.
func (r *CommandRunner) WithTerminalManager(tm *terminal.Manager) *CommandRunner {
	r.termManager = tm
	return r
}

const (
	// MaxOutputSize is the maximum number of bytes of raw output collected per turn (5 MB).
	MaxOutputSize = 5 * 1024 * 1024 // 5MB cap on raw output
	// MaxEventCount is the maximum number of events processed per turn before
	// further events are silently dropped.
	MaxEventCount = 2000 // 2000 events max per turn
)

// RunTurn executes a single agent turn by spawning the configured command as a
// subprocess (or sending to a PTY if a terminal manager is set). It streams
// stdout and stderr, parses events, enforces output size and event count limits,
// and returns the aggregated result.
func (r *CommandRunner) RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	if err := validateTurnWorkspace(request); err != nil {
		if request.ProjectRootWorkspace {
			return TurnResult{}, fmt.Errorf("invalid project workspace path: %w", err)
		}
		log.Printf("WARN: workspace path validation: %v (proceeding anyway)", err)
	}

	sessionID := request.SessionID
	if sessionID == "" {
		sessionID = fmt.Sprintf("%s-%d", request.IssueIdentifier, time.Now().UnixNano())
	}

	commandLine := strings.TrimSpace(r.command)
	if strings.TrimSpace(request.CommandOverride) != "" {
		commandLine = strings.TrimSpace(request.CommandOverride)
	}
	if commandLine == "" {
		return TurnResult{}, fmt.Errorf("agent command missing for provider %s", r.provider)
	}
	if request.StreamReasoning {
		commandLine = withReasoningStream(r.provider, commandLine)
	}
	// Agent, model, effort, skills and Orchestra MCP servers are applied per
	// run; every temp file the adapter creates is removed when the turn ends.
	plan, err := planCommandAgent(r.provider, commandLine, request)
	if err != nil {
		return TurnResult{}, fmt.Errorf("apply agent profile: %w", err)
	}
	defer plan.cleanup()
	commandLine = plan.commandLine
	// Claude reads thread-scoped instructions from a file; a file also keeps
	// long instructions off the length-limited Windows command line.
	if request.DeveloperInstructions != "" && r.provider == ProviderClaude && !strings.Contains(commandLine, "system-prompt") {
		file, err := writePromptFile(request.DeveloperInstructions)
		if err != nil {
			return TurnResult{}, err
		}
		defer os.Remove(file)
		commandLine += " --append-system-prompt-file " + shellQuote(filepath.ToSlash(file))
	}

	// Inject ToolSpecs and ResourceSpecs into .orchestra/ subdirectory so they
	// don't pollute the project's git history when agents run `git add -A`.
	if len(request.ToolSpecs) > 0 || len(request.ResourceSpecs) > 0 {
		orchDir := filepath.Join(request.Workspace, ".orchestra")
		_ = os.MkdirAll(orchDir, 0o755)
		if len(request.ToolSpecs) > 0 {
			toolsData, _ := json.MarshalIndent(request.ToolSpecs, "", "  ")
			_ = os.WriteFile(filepath.Join(orchDir, "tools.json"), toolsData, 0o644)
		}
		if len(request.ResourceSpecs) > 0 {
			resData, _ := json.MarshalIndent(request.ResourceSpecs, "", "  ")
			_ = os.WriteFile(filepath.Join(orchDir, "resources.json"), resData, 0o644)
		}
		// Ensure .orchestra/ is gitignored in the worktree
		gitignorePath := filepath.Join(request.Workspace, ".gitignore")
		ensureGitignoreEntry(gitignorePath, ".orchestra/")
	}

	finalPrompt := plan.promptPrefix + strings.TrimSpace(request.Prompt)
	promptArg := shellQuote(finalPrompt)
	if runtime.GOOS == "windows" && strings.Contains(commandLine, "{{prompt}}") {
		// The shell receives its script as one Windows command-line argument,
		// which is truncated near 8K and leaves the quoted prompt unterminated.
		// Expand the prompt from a file inside the shell instead.
		file, err := writePromptFile(finalPrompt)
		if err != nil {
			return TurnResult{}, err
		}
		defer os.Remove(file)
		promptArg = `"$(cat ` + shellQuote(filepath.ToSlash(file)) + `)"`
	}
	resolvedCommand := strings.ReplaceAll(commandLine, "{{prompt}}", promptArg)
	commandContainsPrompt := strings.Contains(commandLine, "{{prompt}}")
	processEnv := append(accountSubprocessEnv(sessionID, r.provider, request.CredentialHome), plan.env...)
	stampReceipt := func(result TurnResult) TurnResult {
		if request.Agent != nil {
			result.EffectiveAgentID = request.Agent.ID
			result.AgentObservation = plan.receipt.observation()
		}
		return result
	}

	// Shell input and terminal logs can echo commands. Never send API keys or
	// access tokens through a shared PTY; run those turns as sanitized subprocesses.
	if r.termManager != nil && runtime.GOOS != "windows" && !containsPTYSecret(processEnv) {
		result, err := r.runInPTY(ctx, request, sessionID, resolvedCommand, finalPrompt, commandContainsPrompt, processEnv, onEvent)
		return stampReceipt(result), err
	}

	cmdCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	if request.Timeout > 0 {
		var timeoutCancel context.CancelFunc
		cmdCtx, timeoutCancel = context.WithTimeout(cmdCtx, request.Timeout)
		defer timeoutCancel()
	}

	cmd, err := shellcommand.CommandContext(cmdCtx, resolvedCommand)
	if err != nil {
		return TurnResult{}, err
	}
	cmd.Env = processEnv
	cmd.Dir = request.Workspace

	// Copying subprocess output must not wait for event callbacks: WaitDelay
	// bounds inherited OS handles, not parser/callback scheduling. Buffer the
	// handoff within the shared output quota and parse concurrently.
	outputBudget := &commandOutputBudget{cancel: cancel}
	stdout := newCommandOutputStream(outputBudget)
	stderr := newCommandOutputStream(outputBudget)
	defer stdout.abort()
	defer stderr.abort()
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.WaitDelay = time.Second

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return TurnResult{}, fmt.Errorf("stdin pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		if contextErr := commandContextError(ctx, cmdCtx); contextErr != nil {
			return TurnResult{}, contextErr
		}
		return TurnResult{}, fmt.Errorf("start command: %w", err)
	}
	stopClosingStreams := context.AfterFunc(cmdCtx, func() {
		stdout.abort()
		stderr.abort()
	})
	defer stopClosingStreams()

	if !commandContainsPrompt {
		_, _ = io.WriteString(stdin, finalPrompt+"\n")
	}
	_ = stdin.Close()

	collector := &outputCollector{}
	var streamErr error
	var streamErrMu sync.Mutex
	var eventCount int
	var eventCountMu sync.Mutex

	setStreamErr := func(err error) {
		if err == nil {
			return
		}
		streamErrMu.Lock()
		defer streamErrMu.Unlock()
		if streamErr == nil {
			streamErr = err
			cancel()
		}
	}

	var wg sync.WaitGroup
	parseStream := func(reader io.Reader, source string) {
		defer wg.Done()
		scanner := bufio.NewScanner(reader)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		currentSSEEvent := ""
		sseDataLines := make([]string, 0)
		flushSSEData := func() {
			if len(sseDataLines) == 0 {
				return
			}

			eventCountMu.Lock()
			if eventCount >= MaxEventCount {
				eventCountMu.Unlock()
				return
			}
			eventCount++
			eventCountMu.Unlock()

			payload := strings.Join(sseDataLines, "\n")
			event := parseLineToEvent(r.provider, source, payload)
			event.SessionID = sessionID
			if currentSSEEvent != "" && event.Kind == source {
				event.Kind = currentSSEEvent
			}
			if onEvent != nil {
				onEvent(event)
			}
			collector.mergeUsage(event.Usage)
			if reason, blocked := detectBlockingEvent(event); blocked {
				setStreamErr(fmt.Errorf("%s", reason))
			}
			sseDataLines = sseDataLines[:0]
		}
		for scanner.Scan() {
			line := scanner.Text()
			if !collector.append(line) {
				setStreamErr(fmt.Errorf("agent exceeded maximum output size (%d bytes)", MaxOutputSize))
				return
			}

			trimmed := strings.TrimSpace(line)

			if strings.HasPrefix(trimmed, "event:") {
				flushSSEData()
				currentSSEEvent = strings.TrimSpace(strings.TrimPrefix(trimmed, "event:"))
				if currentSSEEvent == "" {
					currentSSEEvent = source
				}

				eventCountMu.Lock()
				if eventCount >= MaxEventCount {
					eventCountMu.Unlock()
					continue
				}
				eventCount++
				eventCountMu.Unlock()

				event := Event{Provider: r.provider, SessionID: sessionID, Kind: currentSSEEvent, Timestamp: time.Now().UTC()}
				if onEvent != nil {
					onEvent(event)
				}
				if reason, blocked := detectBlockingEvent(event); blocked {
					setStreamErr(fmt.Errorf("%s", reason))
				}
				continue
			}

			if strings.HasPrefix(trimmed, "id:") || strings.HasPrefix(trimmed, "retry:") {
				continue
			}
			if strings.HasPrefix(trimmed, ":") {
				continue
			}
			if strings.HasPrefix(trimmed, "data:") {
				chunk := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
				if chunk == "[DONE]" || chunk == "[done]" {
					flushSSEData()
					currentSSEEvent = ""
					continue
				}
				sseDataLines = append(sseDataLines, chunk)
				continue
			}

			if trimmed == "" {
				flushSSEData()
				currentSSEEvent = ""
				continue
			}

			eventCountMu.Lock()
			if eventCount >= MaxEventCount {
				eventCountMu.Unlock()
				continue
			}
			eventCount++
			eventCountMu.Unlock()

			event := parseLineToEvent(r.provider, source, line)
			event.SessionID = sessionID
			if currentSSEEvent != "" && event.Kind == source {
				event.Kind = currentSSEEvent
			}
			if onEvent != nil {
				onEvent(event)
			}
			collector.mergeUsage(event.Usage)
			if reason, blocked := detectBlockingEvent(event); blocked {
				setStreamErr(fmt.Errorf("%s", reason))
			}
		}
		flushSSEData()
		if scanErr := scanner.Err(); scanErr != nil {
			if shouldIgnoreScannerError(scanErr, cmdCtx.Err()) {
				return
			}
			setStreamErr(fmt.Errorf("stream read failed (%s): %w", source, scanErr))
		}
	}

	wg.Add(2)
	go parseStream(stdout, "stdout")
	go parseStream(stderr, "stderr")

	waitErr := cmd.Wait()
	stdout.finish()
	stderr.finish()
	wg.Wait()

	exitCode := 0
	if waitErr != nil {
		if exitErr, ok := waitErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	result := TurnResult{
		Provider:  r.provider,
		SessionID: sessionID,
		ExitCode:  exitCode,
		Output:    collector.output(),
		Usage:     collector.usage(),
	}
	result = stampReceipt(result)

	streamErrMu.Lock()
	deferredErr := streamErr
	streamErrMu.Unlock()
	if deferredErr != nil {
		return result, deferredErr
	}
	if outputErr := outputBudget.err(); outputErr != nil {
		return result, outputErr
	}
	if contextErr := commandContextError(ctx, cmdCtx); contextErr != nil {
		return result, contextErr
	}

	if waitErr != nil {
		if _, ok := waitErr.(*exec.ExitError); !ok {
			return result, fmt.Errorf("wait command: %w", waitErr)
		}
		return result, fmt.Errorf("agent command exited with %d", exitCode)
	}

	return result, nil
}

// A deadline may expire before Start or while the process is running. Both
// phases have the same turn timeout contract; parent cancellation remains
// distinguishable from a deadline and from internal stream cancellation.
func commandContextError(parent, command context.Context) error {
	switch command.Err() {
	case context.DeadlineExceeded:
		return fmt.Errorf("agent command timed out")
	case context.Canceled:
		return parent.Err()
	default:
		return nil
	}
}

// The quota counts accepted raw bytes across both streams, including bytes
// already consumed by the parser. This bounds delayed callbacks without
// allowing a long-running producer to refill an unbounded queue.
type commandOutputBudget struct {
	mu       sync.Mutex
	accepted int
	failure  error
	cancel   context.CancelFunc
}

func (budget *commandOutputBudget) err() error {
	budget.mu.Lock()
	defer budget.mu.Unlock()
	return budget.failure
}

type commandOutputStream struct {
	mu     sync.Mutex
	ready  *sync.Cond
	buffer bytes.Buffer
	closed bool
	budget *commandOutputBudget
}

func newCommandOutputStream(budget *commandOutputBudget) *commandOutputStream {
	stream := &commandOutputStream{budget: budget}
	stream.ready = sync.NewCond(&stream.mu)
	return stream
}

func (stream *commandOutputStream) Write(data []byte) (int, error) {
	stream.budget.mu.Lock()
	stream.mu.Lock()
	if stream.closed {
		stream.mu.Unlock()
		stream.budget.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	accepted := len(data)
	remaining := MaxOutputSize - stream.budget.accepted
	if accepted > remaining {
		accepted = remaining
		stream.budget.failure = fmt.Errorf("agent exceeded maximum output size (%d bytes)", MaxOutputSize)
	}
	_, _ = stream.buffer.Write(data[:accepted])
	stream.budget.accepted += accepted
	stream.ready.Broadcast()
	failure := stream.budget.failure
	stream.mu.Unlock()
	stream.budget.mu.Unlock()
	if failure != nil {
		stream.budget.cancel()
	}
	return accepted, failure
}

func (stream *commandOutputStream) Read(data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	for stream.buffer.Len() == 0 && !stream.closed {
		stream.ready.Wait()
	}
	if stream.buffer.Len() == 0 {
		return 0, io.EOF
	}
	return stream.buffer.Read(data)
}

func (stream *commandOutputStream) finish() {
	stream.mu.Lock()
	stream.closed = true
	stream.ready.Broadcast()
	stream.mu.Unlock()
}

func (stream *commandOutputStream) abort() {
	stream.mu.Lock()
	stream.closed = true
	stream.buffer.Reset()
	stream.ready.Broadcast()
	stream.mu.Unlock()
}

func (r *CommandRunner) runInPTY(
	ctx context.Context,
	request TurnRequest,
	sessionID string,
	resolvedCommand string,
	finalPrompt string,
	commandContainsPrompt bool,
	processEnv []string,
	onEvent EventHandler,
) (TurnResult, error) {
	// Create or attach to a persistent PTY session for this issue/project
	terminalID := fmt.Sprintf("issue-%s", request.IssueIdentifier)
	session, err := r.termManager.GetOrCreateSession(terminalID, request.Workspace)
	if err != nil {
		return TurnResult{}, fmt.Errorf("failed to create terminal session: %w", err)
	}

	collector := &outputCollector{}

	// We want to capture the output from now on
	// Note: Existing data in the log buffer will be replayed when we add the handler,
	// but for an active turn, we only care about the new output triggered by our prompt.
	// However, parsing logic expects full SSE streams.

	// Buffered: handler may signal completion multiple times (multiple match
	// patterns can fire for the same logical end-of-turn). The select-default
	// at the send site already drops extras; the buffer guarantees the first
	// signal never blocks even if no reader has parked yet.
	done := make(chan bool, 1)
	var streamErr error
	var streamErrMu sync.Mutex

	setStreamErr := func(err error) {
		if err == nil {
			return
		}
		streamErrMu.Lock()
		defer streamErrMu.Unlock()
		if streamErr == nil {
			streamErr = err
		}
	}

	// Add a handler to parse events from the PTY stream
	// We strip ANSI because PTY includes colors/control chars that break JSON parsing
	handlerID := session.AddHandler(func(data []byte) {
		cleanData := stripansi.Strip(string(data))
		lines := strings.Split(cleanData, "\n")
		for _, line := range lines {
			if strings.TrimSpace(line) == "" {
				continue
			}
			if !collector.append(line) {
				setStreamErr(fmt.Errorf("agent exceeded maximum output size"))
				return
			}

			event := parseLineToEvent(r.provider, "pty", line)
			event.SessionID = sessionID

			if onEvent != nil {
				onEvent(event)
			}

			collector.mergeUsage(event.Usage)

			if _, blocked := detectBlockingEvent(event); blocked {
				// In PTY mode, we don't necessarily want to kill the process on blocking events
				// as the user might want to interject.
			}

			// Detect completion event to stop waiting.
			// JSON events: turn.completed, result, result/*
			// PTY fallback: detect shell prompt return after agent exits,
			// or Claude's exit markers in verbose output.
			isComplete := event.Kind == "turn.completed" || event.Kind == "result" || strings.Contains(event.Kind, "result/")
			if !isComplete && event.Kind == "stdout" {
				msg := strings.TrimSpace(event.Message)
				// Detect common agent exit patterns in PTY output
				if strings.HasPrefix(msg, "$ ") || // shell prompt returned
					strings.Contains(msg, "cost_usd") || // Claude verbose final summary
					strings.Contains(msg, "\"session_id\"") || // Claude JSON result
					strings.Contains(msg, "result\": {") { // generic result JSON
					isComplete = true
				}
			}
			if isComplete {
				select {
				case done <- true:
				default:
				}
			}
		}
	})
	defer session.RemoveHandler(handlerID)

	// If this is a non-persistent session, close it when we're done
	// Actually, let's keep it open for HITL until explicitly closed by UI.

	// Ensure the PTY is in the correct workspace directory before sending commands
	if request.Workspace != "" {
		session.Write([]byte(fmt.Sprintf("cd %s\n", shellQuote(request.Workspace))))
		time.Sleep(100 * time.Millisecond) // Brief pause for cd to complete
	}

	// Send the agent command and prompt to the PTY.
	// For interactive agents (no {{prompt}} in command), launch the agent CLI first,
	// wait for it to boot, then send the prompt as the first user message.
	// For headless agents ({{prompt}} baked in), send the resolved command directly.
	ptyCommand := scopedPTYCommand(resolvedCommand, processEnv)
	if commandContainsPrompt {
		session.Write([]byte(ptyCommand + "\n"))
	} else {
		// Launch the interactive agent CLI
		session.Write([]byte(ptyCommand + "\n"))
		// Give the agent time to boot — some CLIs show confirmation prompts
		// (e.g. Claude's "Bypass Permissions" warning). Send Enter to dismiss,
		// then wait for the TUI to fully initialize before sending the prompt.
		time.Sleep(3 * time.Second)
		session.Write([]byte("\n")) // Dismiss any confirmation prompt
		time.Sleep(2 * time.Second)
		// Send the prompt as the first user message
		session.Write([]byte(finalPrompt + "\n"))
	}

	// Wait for completion or timeout
	timeout := request.Timeout
	if timeout == 0 {
		timeout = 10 * time.Minute // Default long timeout for PTY sessions
	}

	select {
	case <-done:
		// Success
	case <-time.After(timeout):
		setStreamErr(fmt.Errorf("agent turn timed out in PTY"))
	case <-ctx.Done():
		setStreamErr(ctx.Err())
	}

	streamErrMu.Lock()
	err = streamErr
	streamErrMu.Unlock()

	return TurnResult{
		Provider:  r.provider,
		SessionID: sessionID,
		ExitCode:  0, // Exit codes are harder to get from persistent PTYs without closing them
		Output:    collector.output(),
		Usage:     collector.usage(),
	}, err
}

func detectBlockingEvent(event Event) (string, bool) {
	payload := event.Raw
	method := strings.TrimSpace(firstString(payload, "method"))
	if method == "" {
		method = strings.TrimSpace(event.Kind)
	}
	if method == "" {
		return "", false
	}

	if isApprovalMethod(method) {
		return fmt.Sprintf("approval required: %s", method), true
	}
	if needsInputMethod(method, payload) || hasNeedsInputField(payload) {
		return fmt.Sprintf("input required: %s", method), true
	}

	return "", false
}

type outputCollector struct {
	mu        sync.Mutex
	lines     []string
	used      TokenUsage
	totalSize int
}

func (c *outputCollector) append(line string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.totalSize+len(line) > MaxOutputSize {
		return false
	}
	c.lines = append(c.lines, line)
	c.totalSize += len(line)
	return true
}

func (c *outputCollector) mergeUsage(usage TokenUsage) {
	if usage.InputTokens == 0 && usage.OutputTokens == 0 && usage.TotalTokens == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.used = mergeTokenUsage(c.used, usage)
}

func (c *outputCollector) output() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.Join(c.lines, "\n")
}

func (c *outputCollector) usage() TokenUsage {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.used
}

func parseLineToEvent(provider Provider, source string, line string) Event {
	now := time.Now().UTC()
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return Event{Provider: provider, Kind: source, Timestamp: now, RawLine: line}
	}

	if strings.HasPrefix(trimmed, "event:") {
		eventName := strings.TrimSpace(strings.TrimPrefix(trimmed, "event:"))
		if eventName == "" {
			eventName = source
		}
		return Event{Provider: provider, Kind: eventName, Timestamp: now, RawLine: line}
	}
	if strings.HasPrefix(trimmed, "id:") || strings.HasPrefix(trimmed, "retry:") {
		return Event{Provider: provider, Kind: source, Timestamp: now, RawLine: line}
	}

	rawLineForEvent := line
	if strings.HasPrefix(trimmed, "data:") {
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		usage := extractUsage(payload)
		kind := extractKind(provider, source, payload)
		msg := ExtractMessage(payload)
		return Event{Provider: provider, Kind: kind, Message: msg, Raw: payload, Usage: usage, Timestamp: now, RawLine: rawLineForEvent}
	}

	var payloadList []any
	if err := json.Unmarshal([]byte(trimmed), &payloadList); err == nil {
		usage := TokenUsage{}
		kind := source
		msg := ""
		var raw map[string]any
		for _, item := range payloadList {
			if node, ok := item.(map[string]any); ok {
				event := Event{
					Provider:  provider,
					Kind:      extractKind(provider, source, node),
					Message:   ExtractMessage(node),
					Raw:       node,
					Usage:     extractUsage(node),
					Timestamp: now,
				}
				if _, blocked := detectBlockingEvent(event); blocked {
					event.RawLine = rawLineForEvent
					return event
				}
				usage = mergeTokenUsage(usage, event.Usage)
				if raw == nil {
					raw = node
				}
				if kind == source && strings.TrimSpace(event.Kind) != "" && event.Kind != source {
					kind = event.Kind
				}
				if msg == "" && strings.TrimSpace(event.Message) != "" {
					msg = event.Message
				}
			}
		}
		if raw != nil {
			return Event{Provider: provider, Kind: kind, Message: msg, Raw: raw, Usage: usage, Timestamp: now, RawLine: rawLineForEvent}
		}
	}

	return Event{Provider: provider, Kind: source, Message: trimmed, Timestamp: now, RawLine: rawLineForEvent}
}

func mergeTokenUsage(current TokenUsage, update TokenUsage) TokenUsage {
	if update.InputTokens > 0 {
		current.InputTokens = update.InputTokens
	}
	if update.OutputTokens > 0 {
		current.OutputTokens = update.OutputTokens
	}
	partialDerivedTotal := false
	if update.TotalTokens > 0 {
		if update.InputTokens == 0 && update.OutputTokens > 0 && update.TotalTokens == update.OutputTokens && current.InputTokens > 0 {
			partialDerivedTotal = true
		} else if update.OutputTokens == 0 && update.InputTokens > 0 && update.TotalTokens == update.InputTokens && current.OutputTokens > 0 {
			partialDerivedTotal = true
		} else {
			current.TotalTokens = update.TotalTokens
		}
	} else if current.InputTokens > 0 || current.OutputTokens > 0 {
		current.TotalTokens = current.InputTokens + current.OutputTokens
	}
	if partialDerivedTotal {
		current.TotalTokens = current.InputTokens + current.OutputTokens
	}
	// Merge extended token fields
	if update.CacheReadTokens > 0 {
		current.CacheReadTokens = update.CacheReadTokens
	}
	if update.CacheWriteTokens > 0 {
		current.CacheWriteTokens = update.CacheWriteTokens
	}
	if update.ThinkingTokens > 0 {
		current.ThinkingTokens = update.ThinkingTokens
	}
	if update.ToolTokens > 0 {
		current.ToolTokens = update.ToolTokens
	}
	return current
}

func extractKind(provider Provider, source string, payload map[string]any) string {
	kind := firstString(payload, "event", "type", "kind", "method")
	if kind == "" {
		kind = source
	}

	if provider == ProviderClaude {
		if eventType := firstString(payload, "type"); eventType != "" {
			switch eventType {
			case "message_start", "message_delta", "message_stop", "content_block_start", "content_block_delta", "content_block_stop":
				return eventType
			case "result":
				if stopReason := firstString(payload, "stop_reason", "stopReason"); stopReason != "" {
					return "result/" + stopReason
				}
				return eventType
			}
		}
	}

	if provider == ProviderOpenCode {
		if eventName := firstString(payload, "event"); eventName != "" {
			return eventName
		}
		if op := firstString(payload, "op", "operation"); op != "" {
			return op
		}
	}

	if provider == ProviderGemini {
		if eventType := firstString(payload, "type", "event"); eventType != "" {
			return eventType
		}
	}

	if provider == Provider8gent {
		if eventType := firstString(payload, "type"); eventType != "" {
			switch eventType {
			case "session_start", "assistant", "tool_use", "tool_result":
				return eventType
			case "result", "error":
				if subtype := firstString(payload, "subtype"); subtype != "" {
					return eventType + "/" + subtype
				}
				return eventType
			}
		}
	}

	return kind
}

// ExtractMessage extracts human-readable text from a parsed JSON event payload.
func ExtractMessage(payload map[string]any) string {
	msg := firstString(payload, "message", "content", "text")
	if msg != "" {
		return msg
	}

	// Codex item.completed events: { "item": { "type": "agent_message", "text": "..." } }
	if item := nestedMap(payload, "item"); item != nil {
		if text := firstString(item, "text", "aggregated_output"); text != "" {
			return text
		}
	}

	if delta := nestedMap(payload, "delta"); delta != nil {
		if text := firstString(delta, "text", "message", "content"); text != "" {
			return text
		}
	}

	if message := nestedMap(payload, "message"); message != nil {
		if text := firstString(message, "text"); text != "" {
			return text
		}
		// Claude stream-json: message.content is an array of {type, text} objects
		if msgContent, ok := message["content"].([]any); ok {
			for _, item := range msgContent {
				if node, ok := item.(map[string]any); ok {
					if text := firstString(node, "text"); text != "" {
						return text
					}
				}
			}
		}
	}

	// Also check top-level "result" field (Claude final result)
	if result := firstString(payload, "result"); result != "" {
		return result
	}

	if content, ok := payload["content"].([]any); ok {
		for _, item := range content {
			if node, ok := item.(map[string]any); ok {
				if text := firstString(node, "text", "content", "message"); text != "" {
					return text
				}
			}
		}
	}

	return ""
}

func extractUsage(payload map[string]any) TokenUsage {
	usage := TokenUsage{}

	nodes := []map[string]any{
		payload,
		nestedMap(payload, "usage"),
		nestedMap(payload, "tokens"),
		nestedMap(payload, "tokenUsage"),
		nestedMap(payload, "params"),
		nestedMap(nestedMap(payload, "params"), "usage"),
		nestedMap(nestedMap(payload, "params"), "tokenUsage"),
		nestedMap(payload, "result"),
		nestedMap(nestedMap(payload, "result"), "usage"),
		nestedMap(payload, "message"),
		nestedMap(nestedMap(payload, "message"), "usage"),
		nestedMap(payload, "meta"),
		nestedMap(nestedMap(payload, "meta"), "usage"),
	}

	for _, node := range nodes {
		if node == nil {
			continue
		}
		usage.InputTokens = firstInt64(node, "input_tokens", "inputTokens", "prompt_tokens")
		usage.OutputTokens = firstInt64(node, "output_tokens", "outputTokens", "completion_tokens")
		usage.TotalTokens = firstInt64(node, "total_tokens", "totalTokens")
		if usage.TotalTokens == 0 && (usage.InputTokens > 0 || usage.OutputTokens > 0) {
			usage.TotalTokens = usage.InputTokens + usage.OutputTokens
		}
		if usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.TotalTokens > 0 {
			break
		}
	}

	// Extract cache, thinking, and tool tokens from all candidate nodes.
	// Different providers use different field names, so we check all of them.
	for _, node := range nodes {
		if node == nil {
			continue
		}
		// Cache read tokens: Anthropic (cache_read_input_tokens), OpenAI (cached_input_tokens, cached_tokens), Gemini (cached)
		if usage.CacheReadTokens == 0 {
			usage.CacheReadTokens = firstInt64(node, "cache_read_input_tokens", "cached_input_tokens", "cached_tokens", "cached")
		}
		// Cache write tokens: Anthropic (cache_creation_input_tokens)
		if usage.CacheWriteTokens == 0 {
			usage.CacheWriteTokens = firstInt64(node, "cache_creation_input_tokens")
		}
		// Thinking/reasoning tokens: OpenAI (reasoning_tokens), Gemini (thoughts, thoughtsTokenCount)
		if usage.ThinkingTokens == 0 {
			usage.ThinkingTokens = firstInt64(node, "reasoning_tokens", "thoughts", "thoughtsTokenCount")
			// OpenAI nests reasoning_tokens under completion_tokens_details
			if usage.ThinkingTokens == 0 {
				if details := nestedMap(node, "completion_tokens_details"); details != nil {
					usage.ThinkingTokens = firstInt64(details, "reasoning_tokens")
				}
			}
		}
		// Tool tokens: Gemini (tool, toolUsePromptTokenCount)
		if usage.ToolTokens == 0 {
			usage.ToolTokens = firstInt64(node, "tool", "toolUsePromptTokenCount")
		}
	}

	return usage
}

func nestedMap(payload map[string]any, key string) map[string]any {
	value, ok := payload[key]
	if !ok {
		return nil
	}
	asMap, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return asMap
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			switch typed := value.(type) {
			case string:
				trimmed := strings.TrimSpace(typed)
				if trimmed != "" {
					return trimmed
				}
			}
		}
	}
	return ""
}

func firstInt64(payload map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case string:
			parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

// safeSubprocessEnv returns a whitelist of environment variables for agent
// subprocesses, avoiding leaking secrets from the parent process.
func safeSubprocessEnv(sessionID string, provider Provider) []string {
	allowed := []string{
		"PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM", "COLORTERM",
		"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
		"TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
		"ORCHESTRA_WORKSPACE_ROOT", "ORCHESTRA_SERVER_HOST", "ORCHESTRA_SERVER_PORT",
	}
	env := make([]string, 0, len(allowed)+1)
	for _, key := range allowed {
		if val, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+val)
		}
	}
	// Keep provider credentials consistent between read-only setup probes and
	// agent runs without passing another provider's keys to this process.
	var providerKeys []string
	switch NormalizeProvider(string(provider)) {
	case ProviderCodex:
		providerKeys = []string{"CODEX_HOME", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"}
	case ProviderClaude:
		providerKeys = []string{"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"}
	}
	for _, key := range providerKeys {
		if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
			env = append(env, key+"="+val)
		}
	}
	env = append(env, "ORCHESTRA_SESSION_ID="+sessionID)
	env = append(env, "ORCHESTRA_PROVIDER="+string(NormalizeProvider(string(provider))))
	return env
}

func accountSubprocessEnv(sessionID string, provider Provider, home string) []string {
	env := safeSubprocessEnv(sessionID, provider)
	if home == "" {
		return env
	}
	filtered := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if strings.HasPrefix(entry, "CODEX_HOME=") || strings.HasPrefix(entry, "OPENAI_API_KEY=") || strings.HasPrefix(entry, "CODEX_ACCESS_TOKEN=") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, "CODEX_HOME="+home)
}

// A shared issue terminal can be opened before an agent starts. Scope the
// launched command rather than the persistent shell so both entry points can
// attach to the same PTY without inheriting unrelated provider credentials.
func scopedPTYCommand(command string, env []string) string {
	parts := make([]string, 0, len(env)+5)
	parts = append(parts, "env", "-i")
	for _, entry := range env {
		if isPTYSecret(entry) {
			continue
		}
		parts = append(parts, shellQuote(entry))
	}
	parts = append(parts, "/bin/bash", "-c", shellQuote(command))
	return strings.Join(parts, " ")
}

func containsPTYSecret(env []string) bool {
	for _, entry := range env {
		if isPTYSecret(entry) {
			return true
		}
	}
	return false
}

func isPTYSecret(entry string) bool {
	for _, key := range []string{"OPENAI_API_KEY=", "CODEX_ACCESS_TOKEN=", "CLAUDE_CODE_OAUTH_TOKEN=", "ANTHROPIC_API_KEY=", "ANTHROPIC_AUTH_TOKEN="} {
		if strings.HasPrefix(entry, key) {
			return true
		}
	}
	return false
}

// withReasoningStream adds Claude Code's partial-message stream and thinking
// summaries to a stream-json command. Newer models omit thinking text unless
// summaries are requested. Flags the user already set are left alone.
func withReasoningStream(provider Provider, commandLine string) string {
	if provider != ProviderClaude || !strings.Contains(commandLine, "stream-json") {
		return commandLine
	}
	if !strings.Contains(commandLine, "--include-partial-messages") {
		commandLine += " --include-partial-messages"
	}
	if !strings.Contains(commandLine, "--settings") {
		commandLine += " --settings " + shellQuote(`{"showThinkingSummaries":true}`)
	}
	return commandLine
}

func writePromptFile(prompt string) (string, error) {
	f, err := os.CreateTemp("", "orchestra-prompt-*.txt")
	if err != nil {
		return "", fmt.Errorf("write prompt file: %w", err)
	}
	if _, err = f.WriteString(prompt); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("write prompt file: %w", err)
	}
	if err = f.Close(); err != nil {
		os.Remove(f.Name())
		return "", fmt.Errorf("write prompt file: %w", err)
	}
	return f.Name(), nil
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

// ensureGitignoreEntry appends entry to the .gitignore file if not already present.
func ensureGitignoreEntry(gitignorePath, entry string) {
	data, _ := os.ReadFile(gitignorePath)
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == entry {
			return
		}
	}
	f, err := os.OpenFile(gitignorePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	if len(data) > 0 && !strings.HasSuffix(string(data), "\n") {
		_, _ = f.WriteString("\n")
	}
	_, _ = f.WriteString(entry + "\n")
}

func shouldIgnoreScannerError(scanErr error, cmdErr error) bool {
	if scanErr == nil {
		return true
	}
	if errors.Is(scanErr, os.ErrClosed) {
		return true
	}
	normalized := strings.ToLower(strings.TrimSpace(scanErr.Error()))
	if strings.Contains(normalized, "file already closed") || strings.Contains(normalized, "use of closed file") {
		return true
	}
	if cmdErr == context.Canceled || cmdErr == context.DeadlineExceeded {
		if strings.Contains(normalized, "closed") || strings.Contains(normalized, "broken pipe") {
			return true
		}
	}
	return false
}
