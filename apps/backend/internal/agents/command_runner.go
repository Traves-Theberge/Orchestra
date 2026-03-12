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
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/acarl005/stripansi"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type CommandRunner struct {
	provider    Provider
	command     string
	termManager *terminal.Manager
}

func NewCommandRunner(provider Provider, command string) *CommandRunner {
	return &CommandRunner{provider: provider, command: strings.TrimSpace(command)}
}

func (r *CommandRunner) WithTerminalManager(tm *terminal.Manager) *CommandRunner {
	r.termManager = tm
	return r
}

const (
	MaxOutputSize = 5 * 1024 * 1024 // 5MB cap on raw output
	MaxEventCount = 2000           // 2000 events max per turn
)

func (r *CommandRunner) RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	if err := workspace.ValidateWorkspacePath(request.WorkspaceRoot, request.Workspace); err != nil {
		return TurnResult{}, fmt.Errorf("invalid workspace path: %w", err)
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

	// Inject ToolSpecs as a JSON file if present
	if len(request.ToolSpecs) > 0 {
		toolsPath := filepath.Join(request.Workspace, "tools.json")
		toolsData, _ := json.MarshalIndent(request.ToolSpecs, "", "  ")
		_ = os.WriteFile(toolsPath, toolsData, 0o644)
	}

	// Inject ResourceSpecs as a JSON file if present
	if len(request.ResourceSpecs) > 0 {
		resPath := filepath.Join(request.Workspace, "resources.json")
		resData, _ := json.MarshalIndent(request.ResourceSpecs, "", "  ")
		_ = os.WriteFile(resPath, resData, 0o644)
	}

	finalPrompt := strings.TrimSpace(request.Prompt)
	resolvedCommand := strings.ReplaceAll(commandLine, "{{prompt}}", shellQuote(finalPrompt))
	commandContainsPrompt := strings.Contains(commandLine, "{{prompt}}")

	// If we have a terminal manager, we can run in a persistent PTY
	if r.termManager != nil {
		return r.runInPTY(ctx, request, sessionID, resolvedCommand, finalPrompt, commandContainsPrompt, onEvent)
	}

	cmdCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	if request.Timeout > 0 {
		var timeoutCancel context.CancelFunc
		cmdCtx, timeoutCancel = context.WithTimeout(cmdCtx, request.Timeout)
		defer timeoutCancel()
	}

	cmd := exec.CommandContext(cmdCtx, "sh", "-lc", resolvedCommand)
	cmd.Env = append(os.Environ(), "ORCHESTRA_SESSION_ID=" + sessionID)
	cmd.Dir = request.Workspace

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return TurnResult{}, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return TurnResult{}, fmt.Errorf("stderr pipe: %w", err)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return TurnResult{}, fmt.Errorf("stdin pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return TurnResult{}, fmt.Errorf("start command: %w", err)
	}

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

	streamErrMu.Lock()
	deferredErr := streamErr
	streamErrMu.Unlock()
	if deferredErr != nil {
		return result, deferredErr
	}
	if cmdErr := cmdCtx.Err(); cmdErr != nil {
		if cmdErr == context.DeadlineExceeded {
			return result, fmt.Errorf("agent command timed out")
		}
		if cmdErr == context.Canceled {
			if parentErr := ctx.Err(); parentErr != nil {
				return result, parentErr
			}
		}
	}

	if waitErr != nil {
		if _, ok := waitErr.(*exec.ExitError); !ok {
			return result, fmt.Errorf("wait command: %w", waitErr)
		}
		return result, fmt.Errorf("agent command exited with %d", exitCode)
	}

	return result, nil
}

func (r *CommandRunner) runInPTY(
	ctx context.Context,
	request TurnRequest,
	sessionID string,
	resolvedCommand string,
	finalPrompt string,
	commandContainsPrompt bool,
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
	
	done := make(chan bool)
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
			
			// Detect completion event to stop waiting
			if event.Kind == "turn.completed" || event.Kind == "result" || strings.Contains(event.Kind, "result/") {
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

	// Send the command/prompt to the PTY
	if !commandContainsPrompt {
		session.Write([]byte(finalPrompt + "\n"))
	} else {
		// If the command itself was resolved with the prompt, we might need a different approach.
		// For now, assume resolvedCommand is what we want to run if it's a new session.
		// But in a persistent PTY, we usually just want to send the prompt to an existing shell.
		session.Write([]byte(resolvedCommand + "\n"))
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
		msg := extractMessage(payload)
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
					Message:   extractMessage(node),
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

	return kind
}

func extractMessage(payload map[string]any) string {
	msg := firstString(payload, "message", "content", "text")
	if msg != "" {
		return msg
	}

	if delta := nestedMap(payload, "delta"); delta != nil {
		if text := firstString(delta, "text", "message", "content"); text != "" {
			return text
		}
	}

	if message := nestedMap(payload, "message"); message != nil {
		if text := firstString(message, "text", "content"); text != "" {
			return text
		}
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

	for _, node := range []map[string]any{
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
	} {
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
			return usage
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

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
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
