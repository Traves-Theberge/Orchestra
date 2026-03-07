package agents

type ClaudeRunner struct {
	*CommandRunner
}

func NewClaudeRunner(command string) *ClaudeRunner {
	return &ClaudeRunner{CommandRunner: NewCommandRunner(ProviderClaude, command)}
}
