package agents

import "strings"

type GeminiRunner struct {
	*CommandRunner
}

func NewGeminiRunner(command string) *GeminiRunner {
	if strings.TrimSpace(command) == "" {
		command = "gemini --output-format stream-json {{prompt}}"
	}
	return &GeminiRunner{
		CommandRunner: NewCommandRunner(ProviderGemini, command),
	}
}
