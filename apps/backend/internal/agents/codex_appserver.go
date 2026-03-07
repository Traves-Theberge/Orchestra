package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type CodexAppServerRunner struct {
	command string
}

const nonInteractiveToolInputAnswer = "This is a non-interactive session. Operator input is unavailable."

func NewCodexAppServerRunner(command string) *CodexAppServerRunner {
	return &CodexAppServerRunner{command: strings.TrimSpace(command)}
}

func (r *CodexAppServerRunner) RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	if err := workspace.ValidateWorkspacePath(request.WorkspaceRoot, request.Workspace); err != nil {
		return TurnResult{}, fmt.Errorf("invalid workspace path: %w", err)
	}

	commandLine := strings.TrimSpace(r.command)
	if strings.TrimSpace(request.CommandOverride) != "" {
		commandLine = strings.TrimSpace(request.CommandOverride)
	}
	if commandLine == "" {
		return TurnResult{}, fmt.Errorf("codex app-server command is empty")
	}

	cmdCtx := ctx
	if request.Timeout > 0 {
		var cancel context.CancelFunc
		cmdCtx, cancel = context.WithTimeout(ctx, request.Timeout)
		defer cancel()
	}

	cmd := exec.CommandContext(cmdCtx, "sh", "-lc", commandLine)
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
		return TurnResult{}, fmt.Errorf("start codex app-server: %w", err)
	}

	incoming := make(chan map[string]any, 64)
	nonJSON := &outputCollector{}
	usage := TokenUsage{}

	var wg sync.WaitGroup
	readStdout := func(reader io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(reader)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			event := parseLineToEvent(ProviderCodex, "stdout", line)
			if onEvent != nil {
				onEvent(event)
			}
			nonJSON.append(line)
			nonJSON.mergeUsage(event.Usage)

			var payload map[string]any
			if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &payload); err == nil {
				select {
				case incoming <- payload:
				case <-cmdCtx.Done():
					return
				}
			}
		}
	}

	readStderr := func(reader io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(reader)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			event := parseLineToEvent(ProviderCodex, "stderr", line)
			if onEvent != nil {
				onEvent(event)
			}
			nonJSON.append(line)
			nonJSON.mergeUsage(event.Usage)
		}
	}

	wg.Add(2)
	go readStdout(stdout)
	go readStderr(stderr)

	write := func(message map[string]any) error {
		encoded, err := json.Marshal(message)
		if err != nil {
			return err
		}
		_, err = io.WriteString(stdin, string(encoded)+"\n")
		return err
	}

	waitResult := func(requestID int, timeout time.Duration) (map[string]any, error) {
		deadline := time.NewTimer(timeout)
		defer deadline.Stop()
		for {
			select {
			case <-cmdCtx.Done():
				return nil, cmdCtx.Err()
			case <-deadline.C:
				return nil, fmt.Errorf("response timeout for request id %d", requestID)
			case payload := <-incoming:
				id, hasID := payload["id"]
				if !hasID {
					if maybe := extractUsage(payload); maybe.TotalTokens > 0 || maybe.InputTokens > 0 || maybe.OutputTokens > 0 {
						usage = maybe
					}
					continue
				}
				if intID, ok := asInt(id); ok && intID == requestID {
					if errPayload, exists := payload["error"]; exists {
						return nil, fmt.Errorf("response error for request %d: %v", requestID, errPayload)
					}
					result, _ := payload["result"].(map[string]any)
					return result, nil
				}
			}
		}
	}

	autoApprove := func(payload map[string]any) {
		if !request.AutoApprove {
			return
		}
		id, ok := asInt(payload["id"])
		if !ok {
			return
		}
		method, _ := payload["method"].(string)
		switch method {
		case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
			_ = write(map[string]any{"id": id, "result": map[string]any{"decision": "acceptForSession"}})
		case "execCommandApproval", "applyPatchApproval":
			_ = write(map[string]any{"id": id, "result": map[string]any{"decision": "approved_for_session"}})
		case "item/tool/requestUserInput":
			params, _ := payload["params"].(map[string]any)
			if answers, ok := toolRequestUserInputApprovalAnswers(params); ok {
				_ = write(map[string]any{"id": id, "result": map[string]any{"answers": answers}})
				return
			}
			if answers, ok := toolRequestUserInputUnavailableAnswers(params); ok {
				_ = write(map[string]any{"id": id, "result": map[string]any{"answers": answers}})
				return
			}
			_ = write(map[string]any{"id": id, "result": map[string]any{"answers": map[string]any{"non_interactive": map[string]any{"answers": []string{nonInteractiveToolInputAnswer}}}}})
		case "item/tool/call":
			params, _ := payload["params"].(map[string]any)
			toolName, _ := params["tool"].(string)
			arguments, _ := params["arguments"].(map[string]any)
			if arguments == nil {
				arguments = map[string]any{}
			}
			if request.ToolExecutor == nil {
				_ = write(map[string]any{"id": id, "result": map[string]any{"success": false, "error": "tool executor unavailable"}})
				return
			}
			result := request.ToolExecutor(strings.TrimSpace(toolName), arguments)
			if result == nil {
				result = map[string]any{"success": false, "error": "tool executor returned nil"}
			}
			_ = write(map[string]any{"id": id, "result": result})
		}
	}

	readTimeout := 5 * time.Second
	if request.Timeout > 0 && request.Timeout < readTimeout {
		readTimeout = request.Timeout
	}

	if err := write(map[string]any{
		"id":     1,
		"method": "initialize",
		"params": map[string]any{
			"capabilities": map[string]any{"experimentalApi": true},
			"clientInfo":   map[string]any{"name": "orchestra-orchestrator", "title": "Orchestra Orchestrator", "version": "0.1.0"},
		},
	}); err != nil {
		return TurnResult{}, fmt.Errorf("send initialize: %w", err)
	}
	if _, err := waitResult(1, readTimeout); err != nil {
		return TurnResult{}, fmt.Errorf("initialize failed: %w", err)
	}
	_ = write(map[string]any{"method": "initialized", "params": map[string]any{}})

	approvalPolicy := "never"
	if !request.AutoApprove {
		approvalPolicy = "on-request"
	}

	dynamicTools := []any{}
	for _, spec := range request.ToolSpecs {
		dynamicTools = append(dynamicTools, spec)
	}

	if err := write(map[string]any{
		"id":     2,
		"method": "thread/start",
		"params": map[string]any{
			"approvalPolicy": approvalPolicy,
			"sandbox":        "workspace-write",
			"cwd":            request.Workspace,
			"dynamicTools":   dynamicTools,
		},
	}); err != nil {
		return TurnResult{}, fmt.Errorf("send thread/start: %w", err)
	}
	threadResult, err := waitResult(2, readTimeout)
	if err != nil {
		return TurnResult{}, fmt.Errorf("thread/start failed: %w", err)
	}
	threadPayload, _ := threadResult["thread"].(map[string]any)
	threadID, _ := threadPayload["id"].(string)
	if strings.TrimSpace(threadID) == "" {
		return TurnResult{}, fmt.Errorf("thread/start returned no thread id")
	}

	if err := write(map[string]any{
		"id":     3,
		"method": "turn/start",
		"params": map[string]any{
			"threadId":       threadID,
			"input":          []map[string]any{{"type": "text", "text": request.Prompt}},
			"cwd":            request.Workspace,
			"title":          request.IssueIdentifier,
			"approvalPolicy": approvalPolicy,
		},
	}); err != nil {
		return TurnResult{}, fmt.Errorf("send turn/start: %w", err)
	}
	turnResult, err := waitResult(3, readTimeout)
	if err != nil {
		return TurnResult{}, fmt.Errorf("turn/start failed: %w", err)
	}
	turnPayload, _ := turnResult["turn"].(map[string]any)
	turnID, _ := turnPayload["id"].(string)

	for {
		select {
		case <-cmdCtx.Done():
			_ = stdin.Close()
			_ = cmd.Process.Kill()
			wg.Wait()
			return TurnResult{Provider: ProviderCodex, SessionID: fmt.Sprintf("%s-%s", threadID, turnID), ExitCode: 1, Output: nonJSON.output(), Usage: nonJSON.usage()}, cmdCtx.Err()
		case payload := <-incoming:
			method, _ := payload["method"].(string)
			if method != "" {
				if !request.AutoApprove {
					switch {
					case isApprovalMethod(method):
						_ = stdin.Close()
						_ = cmd.Process.Kill()
						wg.Wait()
						if usage.TotalTokens == 0 {
							usage = nonJSON.usage()
						}
						return TurnResult{Provider: ProviderCodex, SessionID: fmt.Sprintf("%s-%s", threadID, turnID), ExitCode: 1, Output: nonJSON.output(), Usage: usage}, fmt.Errorf("approval required: %s", method)
					case needsInputMethod(method, payload):
						_ = stdin.Close()
						_ = cmd.Process.Kill()
						wg.Wait()
						if usage.TotalTokens == 0 {
							usage = nonJSON.usage()
						}
						return TurnResult{Provider: ProviderCodex, SessionID: fmt.Sprintf("%s-%s", threadID, turnID), ExitCode: 1, Output: nonJSON.output(), Usage: usage}, fmt.Errorf("input required: %s", method)
					}
				}

				autoApprove(payload)
				if maybe := extractUsage(payload); maybe.TotalTokens > 0 || maybe.InputTokens > 0 || maybe.OutputTokens > 0 {
					usage = maybe
				}
				switch method {
				case "turn/completed":
					_ = stdin.Close()
					_ = cmd.Process.Kill()
					wg.Wait()
					if usage.TotalTokens == 0 {
						usage = nonJSON.usage()
					}
					return TurnResult{Provider: ProviderCodex, SessionID: fmt.Sprintf("%s-%s", threadID, turnID), ExitCode: 0, Output: nonJSON.output(), Usage: usage}, nil
				case "turn/failed", "turn/cancelled":
					errorMessage := "turn ended with " + method
					if params, ok := payload["params"].(map[string]any); ok && len(params) > 0 {
						errorMessage = fmt.Sprintf("%s: %v", errorMessage, params)
					}
					_ = stdin.Close()
					_ = cmd.Process.Kill()
					wg.Wait()
					if usage.TotalTokens == 0 {
						usage = nonJSON.usage()
					}
					return TurnResult{Provider: ProviderCodex, SessionID: fmt.Sprintf("%s-%s", threadID, turnID), ExitCode: 1, Output: nonJSON.output(), Usage: usage}, fmt.Errorf("%s", errorMessage)
				}
			}
		}
	}
}

func isApprovalMethod(method string) bool {
	switch strings.TrimSpace(method) {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "execCommandApproval", "applyPatchApproval", "turn/approval_required", "turn.approval_required", "approval_required", "request_approval", "requestApproval":
		return true
	default:
		return false
	}
}

func needsInputMethod(method string, payload map[string]any) bool {
	trimmed := strings.TrimSpace(method)
	if trimmed == "item/tool/requestUserInput" {
		return true
	}
	if strings.HasPrefix(trimmed, "turn/") {
		switch trimmed {
		case "turn/input_required", "turn/needs_input", "turn/need_input", "turn/request_input", "turn/request_response", "turn/provide_input", "turn/approval_required":
			return true
		}
	}
	if strings.HasPrefix(trimmed, "turn.") {
		switch trimmed {
		case "turn.input_required", "turn.needs_input", "turn.need_input", "turn.request_input", "turn.request_response", "turn.provide_input", "turn.approval_required":
			return true
		}
	}
	if trimmed == "input_required" || trimmed == "needs_input" || trimmed == "request_input" {
		return true
	}

	params, _ := payload["params"].(map[string]any)
	return hasNeedsInputField(payload) || hasNeedsInputField(params)
}

func hasNeedsInputField(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	if isTruthySignal(payload["requiresInput"]) || isTruthySignal(payload["needsInput"]) || isTruthySignal(payload["input_required"]) || isTruthySignal(payload["inputRequired"]) || isTruthySignal(payload["requires_input"]) {
		return true
	}
	if value, ok := payload["type"].(string); ok {
		trimmed := strings.TrimSpace(strings.ToLower(value))
		return trimmed == "input_required" || trimmed == "needs_input"
	}
	for _, value := range payload {
		if hasNeedsInputValue(value) {
			return true
		}
	}
	return false
}

func hasNeedsInputValue(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		return hasNeedsInputField(typed)
	case []any:
		for _, item := range typed {
			if hasNeedsInputValue(item) {
				return true
			}
		}
	}
	return false
}

func isTruthySignal(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	case int64:
		return typed != 0
	default:
		return false
	}
}

func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	default:
		return 0, false
	}
}

func toolRequestUserInputApprovalAnswers(params map[string]any) (map[string]any, bool) {
	questions, ok := params["questions"].([]any)
	if !ok || len(questions) == 0 {
		return nil, false
	}

	answers := map[string]any{}
	for _, rawQuestion := range questions {
		question, ok := rawQuestion.(map[string]any)
		if !ok {
			return nil, false
		}
		questionID, ok := toolRequestUserInputQuestionID(question)
		if !ok {
			return nil, false
		}
		label, ok := toolRequestUserInputApprovalOptionLabel(question["options"])
		if !ok {
			return nil, false
		}
		answers[questionID] = map[string]any{"answers": []string{label}}
	}

	if len(answers) == 0 {
		return nil, false
	}
	return answers, true
}

func toolRequestUserInputUnavailableAnswers(params map[string]any) (map[string]any, bool) {
	questions, ok := params["questions"].([]any)
	if !ok || len(questions) == 0 {
		return nil, false
	}

	answers := map[string]any{}
	for _, rawQuestion := range questions {
		question, ok := rawQuestion.(map[string]any)
		if !ok {
			return nil, false
		}
		questionID, ok := toolRequestUserInputQuestionID(question)
		if !ok {
			return nil, false
		}
		answers[questionID] = map[string]any{"answers": []string{nonInteractiveToolInputAnswer}}
	}

	if len(answers) == 0 {
		return nil, false
	}
	return answers, true
}

func toolRequestUserInputQuestionID(question map[string]any) (string, bool) {
	id, ok := question["id"].(string)
	trimmed := strings.TrimSpace(id)
	if !ok || trimmed == "" {
		return "", false
	}
	return trimmed, true
}

func toolRequestUserInputApprovalOptionLabel(rawOptions any) (string, bool) {
	options, ok := rawOptions.([]any)
	if !ok || len(options) == 0 {
		return "", false
	}

	labels := make([]string, 0, len(options))
	for _, rawOption := range options {
		option, ok := rawOption.(map[string]any)
		if !ok {
			continue
		}
		label, _ := option["label"].(string)
		label = strings.TrimSpace(label)
		if label != "" {
			labels = append(labels, label)
		}
	}

	for _, label := range labels {
		if label == "Approve this Session" {
			return label, true
		}
	}
	for _, label := range labels {
		if label == "Approve Once" {
			return label, true
		}
	}
	for _, label := range labels {
		normalized := strings.ToLower(strings.TrimSpace(label))
		if strings.HasPrefix(normalized, "approve") || strings.HasPrefix(normalized, "allow") {
			return label, true
		}
	}

	return "", false
}
