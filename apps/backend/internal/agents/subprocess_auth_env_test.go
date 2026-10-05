package agents

import (
	"slices"
	"testing"
)

func TestSafeSubprocessEnvScopesProviderCredentialHomes(t *testing.T) {
	t.Setenv("CODEX_HOME", "/codex-private")
	t.Setenv("CLAUDE_CONFIG_DIR", "/claude-private")
	t.Setenv("GH_TOKEN", "synthetic-github-token")
	t.Setenv("GITHUB_TOKEN", "synthetic-github-token-alias")
	t.Setenv("ORCHESTRA_API_TOKEN", "synthetic-backend-token")
	for _, test := range []struct {
		provider Provider
		want     string
		deny     string
	}{
		{ProviderCodex, "CODEX_HOME=/codex-private", "CLAUDE_CONFIG_DIR=/claude-private"},
		{ProviderClaude, "CLAUDE_CONFIG_DIR=/claude-private", "CODEX_HOME=/codex-private"},
		{ProviderAntigravity, "", "CODEX_HOME=/codex-private"},
	} {
		env := safeSubprocessEnv("session-1", test.provider)
		if !slices.Contains(env, "ORCHESTRA_PROVIDER="+string(test.provider)) {
			t.Errorf("%s subprocess missing provider identity", test.provider)
		}
		if test.want != "" && !slices.Contains(env, test.want) {
			t.Errorf("%s subprocess missing its credential home: %v", test.provider, env)
		}
		if slices.Contains(env, test.deny) {
			t.Errorf("%s subprocess inherited another provider's credential home", test.provider)
		}
		for _, forbidden := range []string{"GH_TOKEN=synthetic-github-token", "GITHUB_TOKEN=synthetic-github-token-alias", "ORCHESTRA_API_TOKEN=synthetic-backend-token"} {
			if slices.Contains(env, forbidden) {
				t.Errorf("%s subprocess inherited an unrelated service credential", test.provider)
			}
		}
	}
}
