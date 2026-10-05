package agents

import (
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestSafeSubprocessEnvScopesProviderCredentialHomes(t *testing.T) {
	t.Setenv("CODEX_HOME", "/codex-private")
	t.Setenv("CLAUDE_CONFIG_DIR", "/claude-private")
	t.Setenv("OPENAI_API_KEY", "codex-only-key")
	t.Setenv("CODEX_ACCESS_TOKEN", "codex-plan-token")
	t.Setenv("ANTHROPIC_API_KEY", "claude-only-key")
	t.Setenv("GH_TOKEN", "synthetic-github-token")
	t.Setenv("GITHUB_TOKEN", "synthetic-github-token-alias")
	t.Setenv("ORCHESTRA_API_TOKEN", "synthetic-backend-token")
	for _, test := range []struct {
		provider Provider
		want     string
		deny     string
	}{
		{ProviderCodex, "OPENAI_API_KEY=codex-only-key", "ANTHROPIC_API_KEY=claude-only-key"},
		{ProviderClaude, "ANTHROPIC_API_KEY=claude-only-key", "OPENAI_API_KEY=codex-only-key"},
		{ProviderAntigravity, "", "OPENAI_API_KEY=codex-only-key"},
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
		if test.provider == ProviderCodex && !slices.Contains(env, "CODEX_HOME=/codex-private") {
			t.Error("Codex credential home was omitted")
		}
		if test.provider == ProviderCodex && !slices.Contains(env, "CODEX_ACCESS_TOKEN=codex-plan-token") {
			t.Error("Codex plan token was omitted")
		}
		if test.provider != ProviderCodex && slices.Contains(env, "CODEX_ACCESS_TOKEN=codex-plan-token") {
			t.Errorf("%s subprocess inherited a Codex plan token", test.provider)
		}
		if test.provider == ProviderClaude && !slices.Contains(env, "CLAUDE_CONFIG_DIR=/claude-private") {
			t.Error("Claude credential home was omitted")
		}
		for _, forbidden := range []string{"GH_TOKEN=synthetic-github-token", "GITHUB_TOKEN=synthetic-github-token-alias", "ORCHESTRA_API_TOKEN=synthetic-backend-token"} {
			if slices.Contains(env, forbidden) {
				t.Errorf("%s subprocess inherited an unrelated service credential", test.provider)
			}
		}
	}
}

func TestScopedPTYCommandDoesNotInheritShellCredentials(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY shell commands require bash")
	}
	t.Setenv("CODEX_HOME", "/accounts/codex's-home")
	t.Setenv("CLAUDE_CONFIG_DIR", "/accounts/claude")
	t.Setenv("GH_TOKEN", "unrelated-secret")
	command := scopedPTYCommand("printf '%s|%s|%s|%s' \"$CODEX_HOME\" \"$CLAUDE_CONFIG_DIR\" \"$GH_TOKEN\" \"$ORCHESTRA_PROVIDER\"", safeSubprocessEnv("session-1", ProviderCodex))
	output, err := exec.Command("/bin/bash", "-c", command).CombinedOutput()
	if err != nil {
		t.Fatalf("scoped command: %v: %s", err, output)
	}
	if got := strings.TrimSpace(string(output)); got != "/accounts/codex's-home|||CODEX" {
		t.Fatalf("scoped command environment = %q", got)
	}
}

func TestScopedPTYCommandNeverWritesSecretsIntoTerminal(t *testing.T) {
	env := []string{"PATH=/bin", "OPENAI_API_KEY=secret-one", "CODEX_ACCESS_TOKEN=secret-two", "ORCHESTRA_PROVIDER=CODEX"}
	if !containsPTYSecret(env) {
		t.Fatal("secret-bearing environment was not routed away from the PTY")
	}
	command := scopedPTYCommand("codex exec", env)
	if strings.Contains(command, "secret-one") || strings.Contains(command, "secret-two") {
		t.Fatal("PTY command includes a credential value")
	}
}
