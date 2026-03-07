package agents

type OpenCodeRunner struct {
	*CommandRunner
}

func NewOpenCodeRunner(command string) *OpenCodeRunner {
	return &OpenCodeRunner{CommandRunner: NewCommandRunner(ProviderOpenCode, command)}
}
