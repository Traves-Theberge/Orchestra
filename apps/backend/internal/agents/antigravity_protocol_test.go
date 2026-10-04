package agents

import (
	"encoding/json"
	"strings"
	"testing"
)

const antigravityInitFixture = `{"event":"init","conversation_id":"conversation-a","init":{"cwd":"C:/isolated/project","tools":["run_command"],"permission_mode":"request-review"}}`

func agyFixtureResult(turn int64, input, output, cached int64) string {
	line, _ := json.Marshal(map[string]any{"event": "result", "result": map[string]any{
		"conversation_id": "conversation-a", "status": "SUCCESS", "response": "hello", "num_turns": turn,
		"usage": TokenUsage{InputTokens: input, OutputTokens: output, CacheReadTokens: cached, TotalTokens: input + output},
	}})
	return string(line)
}

func newAGYFixture(t *testing.T) *AntigravityProtocol {
	t.Helper()
	p, err := NewAntigravityProtocol("", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.BeginTurn("request-1"); err != nil {
		t.Fatal(err)
	}
	consumeAGY(t, p, antigravityInitFixture)
	return p
}

func consumeAGY(t *testing.T, p *AntigravityProtocol, line string) AntigravityObservation {
	t.Helper()
	observation, err := p.ConsumeLine([]byte(line))
	if err != nil {
		t.Fatal(err)
	}
	return observation
}

func TestAntigravityProtocolSessionUsageAndRequestFence(t *testing.T) {
	p := newAGYFixture(t)
	if err := p.BeginTurn("overlap"); err == nil {
		t.Fatal("allowed overlapping submission")
	}
	step := consumeAGY(t, p, `{"event":"step_update","step_update":{"conversation_id":"conversation-a","step_index":0,"state":"ACTIVE","step_type":"agent_response","text_delta":"hel","usage":{"input_tokens":10}}}`)
	if step.RequestID != "request-1" || step.Step.TextDelta != "hel" {
		t.Fatalf("wrong step: %+v", step)
	}
	first := consumeAGY(t, p, agyFixtureResult(1, 100, 5, 20))
	if !first.TurnUsageKnown || first.TurnUsage.InputTokens != 100 || first.Outcome != AntigravityCompletedUnverified {
		t.Fatalf("wrong first receipt: %+v", first)
	}
	if err := p.BeginTurn("request-1"); err == nil {
		t.Fatal("allowed reused request identity")
	}
	if err := p.BeginTurn("request-2"); err != nil {
		t.Fatal(err)
	}
	// Per-step usage must not be added to the cumulative result a second time.
	consumeAGY(t, p, `{"event":"step_update","step_update":{"conversation_id":"conversation-a","step_index":3,"state":"DONE","step_type":"checkpoint","usage":{"input_tokens":15,"output_tokens":3}}}`)
	second := consumeAGY(t, p, agyFixtureResult(2, 115, 8, 50))
	if !second.TurnUsageKnown || second.TurnUsage.InputTokens != 15 || second.TurnUsage.OutputTokens != 3 || second.TurnUsage.CacheReadTokens != 30 || second.RequestID != "request-2" {
		t.Fatalf("wrong delta/fence: %+v", second)
	}
	if p.Finish(0) != AntigravityCompletedUnverified {
		t.Fatal("wrong successful-process classification")
	}
	if p.Finish(1) != AntigravityProcessFailed {
		t.Fatal("ignored process failure after result")
	}
}

func TestAntigravityProtocolResumedUsage(t *testing.T) {
	for _, withBaseline := range []bool{false, true} {
		t.Run(map[bool]string{false: "unknown baseline", true: "known baseline"}[withBaseline], func(t *testing.T) {
			var prior *AntigravityUsageSnapshot
			if withBaseline {
				prior = &AntigravityUsageSnapshot{"conversation-a", 4, TokenUsage{InputTokens: 100, OutputTokens: 5, TotalTokens: 105}}
			}
			p, err := NewAntigravityProtocol("conversation-a", prior)
			if err != nil {
				t.Fatal(err)
			}
			if prior != nil {
				prior.Usage.InputTokens = 999
			} // Constructor owns a copy.
			if err := p.BeginTurn("resume-5"); err != nil {
				t.Fatal(err)
			}
			init := consumeAGY(t, p, antigravityInitFixture)
			if init.Init.Model != "" {
				t.Fatal("invented effective model")
			}
			result := consumeAGY(t, p, agyFixtureResult(5, 120, 8, 0))
			if result.TurnUsageKnown != withBaseline {
				t.Fatalf("wrong baseline confidence: %+v", result)
			}
			if withBaseline && result.TurnUsage.InputTokens != 20 {
				t.Fatal("resumed total charged as turn")
			}
			if err := p.BeginTurn("resume-6"); err != nil {
				t.Fatal(err)
			}
			next := consumeAGY(t, p, agyFixtureResult(6, 130, 9, 0))
			if !next.TurnUsageKnown || next.TurnUsage.InputTokens != 10 {
				t.Fatal("failed to establish subsequent baseline")
			}
		})
	}
	if _, err := NewAntigravityProtocol("another-conversation", &AntigravityUsageSnapshot{"conversation-a", 4, TokenUsage{}}); err == nil {
		t.Fatal("accepted cross-conversation usage baseline")
	}
}

func TestAntigravityProtocolFailClosed(t *testing.T) {
	cases := map[string]string{
		"malformed":          `{`,
		"missing event":      `{"result":{}}`,
		"unknown event":      `{"event":"future_event","result":{}}`,
		"wrong identity":     `{"event":"step_update","step_update":{"conversation_id":"conversation-b","step_index":0,"state":"DONE","step_type":"agent_response"}}`,
		"missing index":      `{"event":"step_update","step_update":{"conversation_id":"conversation-a","state":"DONE","step_type":"agent_response"}}`,
		"unsupported state":  `{"event":"step_update","step_update":{"conversation_id":"conversation-a","step_index":0,"state":"WAITING","step_type":"agent_response"}}`,
		"unsupported type":   `{"event":"step_update","step_update":{"conversation_id":"conversation-a","step_index":0,"state":"DONE","step_type":"future_step"}}`,
		"negative usage":     `{"event":"result","result":{"conversation_id":"conversation-a","status":"SUCCESS","num_turns":1,"usage":{"input_tokens":-1}}}`,
		"unsupported result": `{"event":"result","result":{"conversation_id":"conversation-a","status":"MAYBE","num_turns":1}}`,
		"null result":        `{"event":"result","result":null}`,
		"ambiguous payload":  `{"event":"result","init":{},"result":{}}`,
		"duplicate init":     antigravityInitFixture,
		"oversized":          strings.Repeat("x", 4*1024*1024+1),
	}
	for name, line := range cases {
		t.Run(name, func(t *testing.T) {
			p := newAGYFixture(t)
			if _, err := p.ConsumeLine([]byte(line)); err == nil {
				t.Fatal("accepted invalid event")
			}
			if _, err := p.ConsumeLine([]byte(agyFixtureResult(1, 1, 1, 0))); err == nil {
				t.Fatal("later success concealed bad stream")
			}
			if p.Finish(0) != AntigravityProtocolFailed {
				t.Fatal("bad stream became successful")
			}
		})
	}
}

func TestAntigravityProtocolIncompleteAndEarlyError(t *testing.T) {
	p := newAGYFixture(t)
	if p.Finish(0) != AntigravityIncomplete {
		t.Fatal("exit 0 without result accepted")
	}
	if p.Finish(2) != AntigravityProcessFailed {
		t.Fatal("missing-result exit 2 accepted")
	}
	p, _ = NewAntigravityProtocol("conversation-a", nil)
	if err := p.BeginTurn("bad-model"); err != nil {
		t.Fatal(err)
	}
	result := consumeAGY(t, p, `{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model","num_turns":0,"usage":{"input_tokens":0}}}`)
	if result.Outcome != AntigravityProviderFailed || p.Finish(1) != AntigravityProviderFailed || result.TurnUsageKnown || result.ConversationID != "" {
		t.Fatalf("wrong early-error classification: %+v", result)
	}
	p, _ = NewAntigravityProtocol("", nil)
	if err := p.BeginTurn("uninitialized-success"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.ConsumeLine([]byte(agyFixtureResult(1, 1, 1, 0))); err == nil {
		t.Fatal("success without init accepted")
	}
}

func TestAntigravityProtocolInitAndResultIdentityFence(t *testing.T) {
	p, _ := NewAntigravityProtocol("conversation-b", nil)
	if _, err := p.ConsumeLine([]byte(antigravityInitFixture)); err == nil {
		t.Fatal("bound init to a different resume conversation")
	}
	p = newAGYFixture(t)
	line := strings.ReplaceAll(agyFixtureResult(1, 1, 1, 0), "conversation-a", "conversation-b")
	if _, err := p.ConsumeLine([]byte(line)); err == nil {
		t.Fatal("accepted another conversation's terminal result")
	}
}

func TestAntigravityProtocolDuplicatesAndCounterRegression(t *testing.T) {
	for _, scenario := range []string{"duplicate result", "stale turn", "skipped turn", "usage regression", "missing usage stale turn"} {
		t.Run(scenario, func(t *testing.T) {
			p := newAGYFixture(t)
			consumeAGY(t, p, agyFixtureResult(1, 100, 5, 10))
			line := agyFixtureResult(1, 100, 5, 10)
			if scenario != "duplicate result" {
				if err := p.BeginTurn("second"); err != nil {
					t.Fatal(err)
				}
			}
			switch scenario {
			case "skipped turn":
				line = agyFixtureResult(3, 100, 5, 10)
			case "usage regression":
				line = agyFixtureResult(2, 99, 5, 10)
			case "missing usage stale turn":
				consumeAGY(t, p, `{"event":"result","result":{"conversation_id":"conversation-a","status":"SUCCESS","num_turns":2}}`)
				if err := p.BeginTurn("third"); err != nil {
					t.Fatal(err)
				}
				line = agyFixtureResult(2, 100, 5, 10)
			}
			if _, err := p.ConsumeLine([]byte(line)); err == nil {
				t.Fatal("accepted duplicate/regression")
			}
		})
	}
}

func TestAntigravityProtocolToolErrorDoesNotCertifyDelivery(t *testing.T) {
	p := newAGYFixture(t)
	step := consumeAGY(t, p, `{"event":"step_update","step_update":{"conversation_id":"conversation-a","step_index":1,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo fixture"},"output":"","error":{"type":"permission_denied","message":"fixture denial"}}}}`)
	if step.Step.ToolInfo.Error.Type != "permission_denied" {
		t.Fatal("lost tool failure")
	}
	result := consumeAGY(t, p, agyFixtureResult(1, 1, 1, 0))
	if !result.HadToolError || result.Outcome != AntigravityCompletedUnverified {
		t.Fatal("tool error hidden or delivery certified")
	}
}
