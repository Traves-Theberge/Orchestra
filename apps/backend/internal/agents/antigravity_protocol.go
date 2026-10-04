package agents

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// AntigravityProtocol is an unwired, single-owner decoder for CLI stream-json.
// It does not dispatch prompts, persist receipts, or certify task effects.
type AntigravityProtocol struct {
	conversationID string
	initialized    bool
	pending        bool
	requestID      string
	requests       map[string]bool
	previous       *AntigravityUsageSnapshot
	previousTurns  *int64
	last           *AntigravityObservation
	failure        error
	toolError      bool
}

type AntigravityInit struct {
	CWD            string   `json:"cwd"`
	Tools          []string `json:"tools"`
	PermissionMode string   `json:"permission_mode"`
	Model          string   `json:"model,omitempty"`
	Agent          string   `json:"agent,omitempty"`
}

type AntigravityToolError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type AntigravityToolInfo struct {
	Name       string                `json:"name"`
	Parameters json.RawMessage       `json:"parameters,omitempty"`
	Output     json.RawMessage       `json:"output,omitempty"`
	Error      *AntigravityToolError `json:"error,omitempty"`
}

type AntigravityStep struct {
	ConversationID string               `json:"conversation_id"`
	StepIndex      *int                 `json:"step_index"`
	State          string               `json:"state"`
	StepType       string               `json:"step_type"`
	TextDelta      string               `json:"text_delta,omitempty"`
	ToolName       string               `json:"tool_name,omitempty"`
	ToolInfo       *AntigravityToolInfo `json:"tool_info,omitempty"`
	SubagentInfo   json.RawMessage      `json:"subagent_info,omitempty"`
	Usage          *TokenUsage          `json:"usage,omitempty"`
}

type AntigravityResult struct {
	ConversationID   string          `json:"conversation_id"`
	Status           string          `json:"status"`
	Response         string          `json:"response"`
	Error            string          `json:"error,omitempty"`
	NumTurns         *int64          `json:"num_turns"`
	Usage            *TokenUsage     `json:"usage,omitempty"`
	StructuredOutput json.RawMessage `json:"structured_output,omitempty"`
}

// AntigravityUsageSnapshot must belong to the same persisted conversation.
// Without a prior snapshot, resumed cumulative usage cannot be billed as a turn.
type AntigravityUsageSnapshot struct {
	ConversationID string
	NumTurns       int64
	Usage          TokenUsage
}

type AntigravityOutcome string

const (
	AntigravityCompletedUnverified AntigravityOutcome = "completed_unverified"
	AntigravityProviderFailed      AntigravityOutcome = "provider_failed"
	AntigravityProcessFailed       AntigravityOutcome = "process_failed"
	AntigravityIncomplete          AntigravityOutcome = "incomplete"
	AntigravityProtocolFailed      AntigravityOutcome = "protocol_failed"
)

// AntigravityObservation carries a local request fence separately from provider
// conversation identity. A result says the turn settled, never that a task shipped.
type AntigravityObservation struct {
	Kind           string
	RequestID      string
	ConversationID string
	Init           *AntigravityInit
	Step           *AntigravityStep
	Result         *AntigravityResult
	Outcome        AntigravityOutcome
	TurnUsage      TokenUsage
	TurnUsageKnown bool
	HadToolError   bool
}

func NewAntigravityProtocol(conversationID string, previous *AntigravityUsageSnapshot) (*AntigravityProtocol, error) {
	p := &AntigravityProtocol{conversationID: conversationID, requests: make(map[string]bool)}
	if previous != nil {
		if conversationID == "" || previous.ConversationID != conversationID || previous.NumTurns < 0 || !validAntigravityUsage(previous.Usage) {
			return nil, errors.New("invalid Antigravity conversation usage baseline")
		}
		copy := *previous
		p.previous = &copy
		p.previousTurns = &copy.NumTurns
	}
	return p, nil
}

// BeginTurn reserves an app request before writing to stdin. An interrupted
// write remains uncertain: callers must not replay it based on this decoder.
func (p *AntigravityProtocol) BeginTurn(requestID string) error {
	if p.failure != nil {
		return p.failure
	}
	if strings.TrimSpace(requestID) == "" || p.pending || p.requests[requestID] {
		return errors.New("Antigravity turn requires a new request identity and no pending turn")
	}
	p.requests[requestID] = true
	p.requestID, p.pending, p.last, p.toolError = requestID, true, nil, false
	return nil
}

// ConsumeLine accepts one stdout NDJSON record. Never feed stderr into it.
// Unknown additive fields are retained where relevant; unknown event/state/type
// discriminators fail closed until their terminal semantics are understood.
func (p *AntigravityProtocol) ConsumeLine(line []byte) (AntigravityObservation, error) {
	if p.failure != nil {
		return AntigravityObservation{}, p.failure
	}
	fail := func(message string) (AntigravityObservation, error) {
		p.failure = errors.New(message)
		return AntigravityObservation{}, p.failure
	}
	if len(line) > 4*1024*1024 {
		return fail("Antigravity event exceeds 4 MiB limit")
	}
	var wire struct {
		Event          string             `json:"event"`
		ConversationID string             `json:"conversation_id"`
		Init           *AntigravityInit   `json:"init"`
		Step           *AntigravityStep   `json:"step_update"`
		Result         *AntigravityResult `json:"result"`
	}
	if err := json.Unmarshal(line, &wire); err != nil {
		return fail("invalid Antigravity JSON event")
	}
	count := 0
	if wire.Init != nil {
		count++
	}
	if wire.Step != nil {
		count++
	}
	if wire.Result != nil {
		count++
	}
	if count != 1 {
		return fail("Antigravity event requires exactly one payload")
	}
	observation := AntigravityObservation{Kind: wire.Event, RequestID: p.requestID}
	switch wire.Event {
	case "init":
		if wire.Init == nil || p.initialized || wire.ConversationID == "" || wire.Init.CWD == "" || wire.Init.PermissionMode == "" || wire.Init.Tools == nil {
			return fail("invalid or duplicate Antigravity init")
		}
		if p.conversationID != "" && p.conversationID != wire.ConversationID {
			return fail("Antigravity conversation identity mismatch")
		}
		p.conversationID, p.initialized = wire.ConversationID, true
		observation.Init = wire.Init
	case "step_update":
		step := wire.Step
		if step == nil || !p.initialized || !p.pending || step.ConversationID != p.conversationID || step.StepIndex == nil || *step.StepIndex < 0 {
			return fail("invalid or unscoped Antigravity step")
		}
		if step.State != "ACTIVE" && step.State != "DONE" {
			return fail("unsupported Antigravity step state")
		}
		switch step.StepType {
		case "user_input", "agent_response", "tool", "checkpoint":
		default:
			return fail("unsupported Antigravity step type")
		}
		if step.Usage != nil && !validAntigravityUsage(*step.Usage) {
			return fail("invalid Antigravity step usage")
		}
		if step.ToolInfo != nil && step.ToolInfo.Error != nil {
			p.toolError = true
		}
		observation.Step = step
	case "result":
		result := wire.Result
		if result == nil || !p.pending || result.NumTurns == nil || *result.NumTurns < 0 {
			return fail("invalid or duplicate Antigravity result")
		}
		if result.Status != "SUCCESS" && result.Status != "ERROR" {
			return fail("unsupported Antigravity result status")
		}
		// Documented launch/input errors may precede init and have no identity.
		if !p.initialized {
			if result.Status != "ERROR" || *result.NumTurns != 0 {
				return fail("Antigravity result before init")
			}
			if result.ConversationID != "" && p.conversationID != "" && result.ConversationID != p.conversationID {
				return fail("Antigravity conversation identity mismatch")
			}
		} else if result.ConversationID != p.conversationID {
			return fail("Antigravity conversation identity mismatch")
		}
		if result.Status == "SUCCESS" && *result.NumTurns == 0 {
			return fail("successful Antigravity result has no turn")
		}
		if p.previousTurns != nil && (*result.NumTurns < *p.previousTurns || (result.Status == "SUCCESS" && *result.NumTurns != *p.previousTurns+1)) {
			return fail("Antigravity cumulative turn counter is stale or skipped")
		}
		if result.Usage != nil {
			if !validAntigravityUsage(*result.Usage) {
				return fail("invalid Antigravity result usage")
			}
			if p.previous != nil {
				delta, valid := antigravityUsageDelta(*result.Usage, p.previous.Usage)
				if !valid {
					return fail("Antigravity cumulative usage regressed")
				}
				observation.TurnUsage, observation.TurnUsageKnown = delta, true
			} else if *result.NumTurns == 1 {
				observation.TurnUsage, observation.TurnUsageKnown = *result.Usage, true
			}
			if p.initialized {
				p.previous = &AntigravityUsageSnapshot{p.conversationID, *result.NumTurns, *result.Usage}
			}
		} else {
			p.previous = nil
		}
		turns := *result.NumTurns
		p.previousTurns = &turns
		observation.Result, observation.HadToolError = result, p.toolError
		observation.Outcome = AntigravityCompletedUnverified
		if result.Status == "ERROR" {
			observation.Outcome = AntigravityProviderFailed
		}
		p.pending = false
		// Keep an independent terminal receipt; callers may edit emitted values.
		copy := observation
		resultCopy := *result
		copy.Result = &resultCopy
		p.last = &copy
	default:
		return fail(fmt.Sprintf("unsupported Antigravity event %q", wire.Event))
	}
	observation.ConversationID = p.conversationID
	if observation.Result != nil {
		// A launch error with no provider identity must not manufacture acceptance
		// of the requested resume conversation.
		observation.ConversationID = observation.Result.ConversationID
	}
	return observation, nil
}

// Finish reconciles EOF with the actual process exit. Exit 0 alone is incomplete.
// Process termination does not prove cancellation of every external tool effect.
func (p *AntigravityProtocol) Finish(exitCode int) AntigravityOutcome {
	if p.failure != nil {
		return AntigravityProtocolFailed
	}
	if exitCode != 0 {
		if p.last != nil && p.last.Outcome == AntigravityProviderFailed {
			return AntigravityProviderFailed
		}
		return AntigravityProcessFailed
	}
	if p.pending || p.last == nil {
		return AntigravityIncomplete
	}
	return p.last.Outcome
}

func validAntigravityUsage(usage TokenUsage) bool {
	return usage.InputTokens >= 0 && usage.OutputTokens >= 0 && usage.ThinkingTokens >= 0 && usage.CacheReadTokens >= 0 && usage.CacheWriteTokens >= 0 && usage.TotalTokens >= 0 && usage.ToolTokens >= 0
}

func antigravityUsageDelta(current, previous TokenUsage) (TokenUsage, bool) {
	delta := TokenUsage{
		InputTokens:      current.InputTokens - previous.InputTokens,
		OutputTokens:     current.OutputTokens - previous.OutputTokens,
		TotalTokens:      current.TotalTokens - previous.TotalTokens,
		ThinkingTokens:   current.ThinkingTokens - previous.ThinkingTokens,
		CacheReadTokens:  current.CacheReadTokens - previous.CacheReadTokens,
		CacheWriteTokens: current.CacheWriteTokens - previous.CacheWriteTokens,
		ToolTokens:       current.ToolTokens - previous.ToolTokens,
	}
	return delta, validAntigravityUsage(delta)
}
