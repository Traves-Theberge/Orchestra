package agents

import (
	"errors"
	"testing"
)

func TestOpenCodeAgentSelectionFailsClosedUntilVersionAndCanaryAreVerified(t *testing.T) {
	registry := NewRegistry(map[string]string{"OPENCODE": "opencode -p {{prompt}} -f json"})
	request := TurnRequest{
		RuntimeTarget:             RuntimeLocal,
		RequestedAgentID:          "team/reviewer",
		RequestedAgentScope:       "project",
		RequestedAgentContentHash: "sha256:0123456789abcdef",
		RequestedAgentFormat:      "opencode-v1",
	}
	err := registry.ValidateTurnOptions(ProviderOpenCode, request)
	if !errors.Is(err, ErrOpenCodeAgentSelectionUnverified) {
		t.Fatalf("selection should fail closed until canary evidence exists; got %v", err)
	}
}

func TestProviderDefaultDoesNotRequireAgentCapability(t *testing.T) {
	registry := NewRegistry(map[string]string{"OPENCODE": "opencode -p {{prompt}} -f json"})
	if err := registry.ValidateTurnOptions(ProviderOpenCode, TurnRequest{RuntimeTarget: RuntimeLocal}); err != nil {
		t.Fatalf("provider-default turn should remain compatible: %v", err)
	}
}
