package harnessaccounts

import (
	"slices"
	"testing"
)

func TestCodexProcessEnvExcludesHostAndOtherProviderSecrets(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "host-key")
	t.Setenv("ANTHROPIC_API_KEY", "other-key")
	t.Setenv("ORCHESTRA_API_TOKEN", "server-token")
	t.Setenv("CODEX_HOME", "host-home")
	env := CodexProcessEnv("managed-home")
	if !slices.Contains(env, "CODEX_HOME=managed-home") || slices.Contains(env, "CODEX_HOME=host-home") || slices.Contains(env, "OPENAI_API_KEY=host-key") || slices.Contains(env, "ANTHROPIC_API_KEY=other-key") || slices.Contains(env, "ORCHESTRA_API_TOKEN=server-token") {
		t.Fatalf("unsafe managed Codex environment: %v", env)
	}
}
