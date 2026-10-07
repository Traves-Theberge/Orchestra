package agents

import (
	"errors"
	"regexp"
)

// ClaudeRunner wraps CommandRunner with Claude-specific provider identification.
type ClaudeRunner struct {
	*CommandRunner
}

// NewClaudeRunner creates a Runner that executes turns using the Anthropic
// Claude CLI with the given command template.
func NewClaudeRunner(command string) *ClaudeRunner {
	return &ClaudeRunner{CommandRunner: NewCommandRunner(ProviderClaude, command)}
}

// Model ids and aliases ("sonnet", "claude-sonnet-5-5", "claude-opus-5-5[1m]").
var claudeModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:\-\[\]]{0,127}$`)

// ValidateRequestedModel accepts any well-formed id; the CLI is the authority
// on which models the signed-in account can use and reports unknown ones.
func (r *ClaudeRunner) ValidateRequestedModel(model string) error {
	if !claudeModelPattern.MatchString(model) {
		return errors.New("model must be a Claude model id or alias")
	}
	return nil
}
