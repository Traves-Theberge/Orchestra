package config

import (
	"os"
	"testing"
)

func TestLoadNativeCodexCommandIndependentFromBatch(t *testing.T) {
	for _, tc := range []struct {
		name, value, want string
		unset             bool
	}{
		{name: "default", unset: true, want: "codex app-server"},
		{name: "custom", value: "custom-codex app-server --listen stdio://", want: "custom-codex app-server --listen stdio://"},
		{name: "disabled", value: "", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ORCHESTRA_NATIVE_COMMAND_CODEX", tc.value)
			if tc.unset {
				if err := os.Unsetenv("ORCHESTRA_NATIVE_COMMAND_CODEX"); err != nil {
					t.Fatal(err)
				}
			}
			batch := "codex exec --dangerously-bypass-approvals-and-sandbox {{prompt}}"
			t.Setenv("ORCHESTRA_AGENT_COMMAND_CODEX", batch)
			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.NativeAgentCommands["CODEX"] != tc.want {
				t.Fatalf("native command %q want %q", cfg.NativeAgentCommands["CODEX"], tc.want)
			}
			if cfg.AgentCommands["CODEX"] != batch {
				t.Fatal("native selection changed batch command")
			}
			if _, ok := cfg.NativeAgentCommands["CLAUDE"]; ok {
				t.Fatal("unsupported native provider configured")
			}
		})
	}
}
