package agents

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListAgentConfigsClassifiesProviderResources(t *testing.T) {
	home := t.TempDir()
	projectRoot := t.TempDir()
	workspaceRoot := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	mustWriteFile(t, filepath.Join(home, ".codex", "config.toml"), "model = \"gpt-5.3-codex\"\n")
	mustWriteFile(t, filepath.Join(projectRoot, "AGENTS.md"), "# Project instructions\n")
	mustWriteFile(t, filepath.Join(projectRoot, "AGENTS.override.md"), "# Project override\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".codex", "agents", "reviewer.toml"), "name = \"reviewer\"\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".agents", "skills", "triage", "SKILL.md"), "# Triage\n")

	mustWriteFile(t, filepath.Join(home, ".gemini", "settings.json"), "{\n  \"model\": \"gemini-2.5-pro\"\n}\n")
	mustWriteFile(t, filepath.Join(projectRoot, "GEMINI.md"), "# Workspace context\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".gemini", "commands", "summarize.toml"), "description = \"Summarize\"\n")

	mustWriteFile(t, filepath.Join(home, ".config", "opencode", "opencode.json"), "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".opencode", "agents", "planner.md"), "---\nmode: subagent\n---\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".opencode", "commands", "ship.md"), "---\nagent: build\n---\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".opencode", "skills", "release", "SKILL.md"), "# Release\n")

	configs, err := ListAgentConfigs(workspaceRoot, projectRoot)
	if err != nil {
		t.Fatalf("ListAgentConfigs: %v", err)
	}

	assertConfigMatch(t, configs, filepath.Join(home, ".codex", "config.toml"), func(cfg AgentConfig) {
		if cfg.Provider != "codex" {
			t.Fatalf("expected codex provider, got %q", cfg.Provider)
		}
		if cfg.ResourceType != "config" {
			t.Fatalf("expected codex config resource_type, got %q", cfg.ResourceType)
		}
		if cfg.Scope != ScopeGlobal || cfg.Origin != "global" {
			t.Fatalf("expected global codex config, got scope=%q origin=%q", cfg.Scope, cfg.Origin)
		}
		if cfg.Priority != 5 {
			t.Fatalf("expected codex config priority 5, got %d", cfg.Priority)
		}
		if cfg.Depth != 1 {
			t.Fatalf("expected codex config depth 1, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, "AGENTS.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "instructions" || cfg.Variant != "stack" {
			t.Fatalf("expected codex stack instructions, got resource_type=%q variant=%q", cfg.ResourceType, cfg.Variant)
		}
		if cfg.Scope != ScopeProject || cfg.Origin != "project" {
			t.Fatalf("expected project codex instructions, got scope=%q origin=%q", cfg.Scope, cfg.Origin)
		}
		if cfg.Priority != 30 {
			t.Fatalf("expected codex instructions priority 30, got %d", cfg.Priority)
		}
		if cfg.Depth != 0 {
			t.Fatalf("expected project AGENTS depth 0, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, "AGENTS.override.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "instructions" || cfg.Variant != "override" {
			t.Fatalf("expected codex override instructions, got resource_type=%q variant=%q", cfg.ResourceType, cfg.Variant)
		}
		if cfg.Priority != 50 {
			t.Fatalf("expected codex override priority 50, got %d", cfg.Priority)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".codex", "agents", "reviewer.toml"), func(cfg AgentConfig) {
		if cfg.ResourceType != "agents" {
			t.Fatalf("expected codex sub-agent resource, got %q", cfg.ResourceType)
		}
		if cfg.Scope != ScopeProject || cfg.Origin != "project" {
			t.Fatalf("expected project codex sub-agent, got scope=%q origin=%q", cfg.Scope, cfg.Origin)
		}
		if cfg.Depth != 2 {
			t.Fatalf("expected codex sub-agent depth 2, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".agents", "skills", "triage", "SKILL.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "skills" {
			t.Fatalf("expected codex skill resource, got %q", cfg.ResourceType)
		}
		if cfg.Depth != 3 {
			t.Fatalf("expected codex skill depth 3, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(home, ".gemini", "settings.json"), func(cfg AgentConfig) {
		if cfg.Provider != "gemini" || cfg.ResourceType != "settings" {
			t.Fatalf("expected gemini settings resource, got provider=%q resource_type=%q", cfg.Provider, cfg.ResourceType)
		}
		if cfg.Scope != ScopeGlobal || cfg.Origin != "global" {
			t.Fatalf("expected global gemini settings, got scope=%q origin=%q", cfg.Scope, cfg.Origin)
		}
		if cfg.Priority != 5 {
			t.Fatalf("expected gemini settings priority 5, got %d", cfg.Priority)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, "GEMINI.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "context" || cfg.Variant != "context" {
			t.Fatalf("expected gemini context resource, got resource_type=%q variant=%q", cfg.ResourceType, cfg.Variant)
		}
		if cfg.Priority != 30 {
			t.Fatalf("expected gemini context priority 30, got %d", cfg.Priority)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".gemini", "commands", "summarize.toml"), func(cfg AgentConfig) {
		if cfg.ResourceType != "commands" {
			t.Fatalf("expected gemini command resource, got %q", cfg.ResourceType)
		}
		if cfg.Depth != 2 {
			t.Fatalf("expected gemini command depth 2, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(home, ".config", "opencode", "opencode.json"), func(cfg AgentConfig) {
		if cfg.Provider != "opencode" || cfg.ResourceType != "config" {
			t.Fatalf("expected opencode config resource, got provider=%q resource_type=%q", cfg.Provider, cfg.ResourceType)
		}
		if cfg.Scope != ScopeGlobal || cfg.Origin != "global" {
			t.Fatalf("expected global opencode config, got scope=%q origin=%q", cfg.Scope, cfg.Origin)
		}
		if cfg.Depth != 2 {
			t.Fatalf("expected opencode global config depth 2, got %d", cfg.Depth)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".opencode", "agents", "planner.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "agents" {
			t.Fatalf("expected opencode agent resource, got %q", cfg.ResourceType)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".opencode", "commands", "ship.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "commands" {
			t.Fatalf("expected opencode command resource, got %q", cfg.ResourceType)
		}
	})

	assertConfigMatch(t, configs, filepath.Join(projectRoot, ".opencode", "skills", "release", "SKILL.md"), func(cfg AgentConfig) {
		if cfg.ResourceType != "skills" {
			t.Fatalf("expected opencode skill resource, got %q", cfg.ResourceType)
		}
	})
}

func assertConfigMatch(t *testing.T, configs []AgentConfig, path string, check func(AgentConfig)) {
	t.Helper()
	for _, cfg := range configs {
		if cfg.Path == path {
			check(cfg)
			return
		}
	}
	t.Fatalf("expected config for %s", path)
}

func mustWriteFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
