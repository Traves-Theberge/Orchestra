package agents

import (
	"context"
	"errors"
)

var ErrOpenCodeAgentSelectionUnverified = errors.New("OpenCode primary-agent selection is disabled until the installed CLI version and effective selection are verified by a canary")

// OpenCodeRunner wraps CommandRunner with OpenCode-specific provider identification.
type OpenCodeRunner struct {
	*CommandRunner
}

// NewOpenCodeRunner creates a Runner that executes turns using the OpenCode
// CLI with the given command template.
func NewOpenCodeRunner(command string) *OpenCodeRunner {
	return &OpenCodeRunner{CommandRunner: NewCommandRunner(ProviderOpenCode, command)}
}

// ValidateAgentSelection intentionally fails closed. Current upstream CLI
// documentation exposes --agent, but this runner has no installed-version,
// effective-agent observation, or canary contract to prove that the flag is
// honored by the configured command.
func (r *OpenCodeRunner) ValidateAgentSelection(_ context.Context, request TurnRequest) error {
	if request.RequestedAgentID == "" || request.RequestedAgentScope != "project" && request.RequestedAgentScope != "global" || request.RequestedAgentContentHash == "" {
		return errors.New("requested OpenCode agent identity is incomplete")
	}
	return ErrOpenCodeAgentSelectionUnverified
}
