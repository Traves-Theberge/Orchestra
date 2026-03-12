package telemetry

import (
	"encoding/json"
	"testing"
)

func TestExtractTokens(t *testing.T) {
	tests := []struct {
		name          string
		json          string
		expectedInput  int
		expectedOutput int
	}{
		{
			name: "New Claude Format (Usage in Message)",
			json: `{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50}},"timestamp":"2026-01-12T21:06:22.729Z"}`,
			expectedInput:  100,
			expectedOutput: 50,
		},
		{
			name: "Codex Format (Last Token Usage)",
			json: `{"type":"event_msg","payload":{"info":{"last_token_usage":{"input_tokens":3356,"output_tokens":33}}},"timestamp":"2025-11-30T06:11:05.391Z"}`,
			expectedInput:  3356,
			expectedOutput: 33,
		},
		{
			name: "Old Format (Direct Tokens)",
			json: `{"type":"assistant","tokens":{"input":10,"output":5},"timestamp":"2024-01-12T21:06:22.729Z"}`,
			expectedInput:  10,
			expectedOutput: 5,
		},
		{
			name: "No Tokens",
			json: `{"type":"user","message":"hello"}`,
			expectedInput:  0,
			expectedOutput: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var raw map[string]interface{}
			if err := json.Unmarshal([]byte(tt.json), &raw); err != nil {
				t.Fatalf("failed to unmarshal test JSON: %v", err)
			}
			input, output := extractTokens(raw)
			if input != tt.expectedInput || output != tt.expectedOutput {
				t.Errorf("extractTokens() = (%v, %v), want (%v, %v)", input, output, tt.expectedInput, tt.expectedOutput)
			}
		})
	}
}
