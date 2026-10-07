package agents

import (
	"errors"
	"regexp"
)

// OpenCodeRunner wraps CommandRunner with OpenCode-specific provider identification.
// Agent selection is validated by the embedded CommandRunner capability check
// and applied through an OPENCODE_CONFIG temp file plus --agent.
type OpenCodeRunner struct {
	*CommandRunner
}

// NewOpenCodeRunner creates a Runner that executes turns using the OpenCode
// CLI with the given command template.
func NewOpenCodeRunner(command string) *OpenCodeRunner {
	return &OpenCodeRunner{CommandRunner: NewCommandRunner(ProviderOpenCode, command)}
}

// OpenCode addresses models as "provider/model", e.g. "anthropic/claude-sonnet-5-5".
var openCodeModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,159}$`)

// ValidateRequestedModel accepts well-formed provider/model ids; OpenCode itself
// reports models the account cannot use. The adapter passes it as -m.
func (r *OpenCodeRunner) ValidateRequestedModel(model string) error {
	if !openCodeModelPattern.MatchString(model) {
		return errors.New("model must be an OpenCode provider/model id")
	}
	return nil
}
