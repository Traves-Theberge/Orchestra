package agents

type GeminiRunner struct {
	*CommandRunner
}

func NewGeminiRunner(command string) *GeminiRunner {
	return &GeminiRunner{
		CommandRunner: NewCommandRunner(ProviderGemini, command),
	}
}
