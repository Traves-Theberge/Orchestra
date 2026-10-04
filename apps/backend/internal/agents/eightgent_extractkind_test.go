package agents

import (
	"os"
	"path/filepath"
	"testing"
)

// These tests cover the Provider8gent-specific branch of extractKind and the
// 8gent entry in AgentMeta. They are intentionally separate from the broader
// runner-lifecycle tests so they remain readable as the integration grows.

func TestExtractKind8gentMapsTopLevelTypesExplicitly(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{
			name:    "session_start stays plain",
			payload: map[string]any{"type": "session_start", "session_id": "run-x"},
			want:    "session_start",
		},
		{
			name:    "assistant stays plain (subtype is informational, not terminal)",
			payload: map[string]any{"type": "assistant", "subtype": "text"},
			want:    "assistant",
		},
		{
			name:    "tool_use stays plain",
			payload: map[string]any{"type": "tool_use", "subtype": "start"},
			want:    "tool_use",
		},
		{
			name:    "tool_result stays plain so it does not match the result/ completion prefix",
			payload: map[string]any{"type": "tool_result", "subtype": "ok"},
			want:    "tool_result",
		},
		{
			name:    "result/ok promotes subtype so completion detection still fires",
			payload: map[string]any{"type": "result", "subtype": "ok", "session_id": "run-x"},
			want:    "result/ok",
		},
		{
			name:    "result/error preserves error subtype",
			payload: map[string]any{"type": "result", "subtype": "error", "error": "boom"},
			want:    "result/error",
		},
		{
			name:    "result without subtype falls back to plain result",
			payload: map[string]any{"type": "result"},
			want:    "result",
		},
		{
			name:    "error/usage promotes subtype",
			payload: map[string]any{"type": "error", "subtype": "usage", "message": "rate limited"},
			want:    "error/usage",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractKind(Provider8gent, "stdout", tc.payload)
			if got != tc.want {
				t.Fatalf("extractKind(%v) = %q, want %q", tc.payload, got, tc.want)
			}
		})
	}
}

func TestExtractKind8gentFallsThroughForUnknownTypes(t *testing.T) {
	payload := map[string]any{"type": "custom_event", "detail": "anything"}
	if got := extractKind(Provider8gent, "stdout", payload); got != "custom_event" {
		t.Fatalf("expected fall-through to custom_event, got %q", got)
	}
}

func TestAgentMeta8gentUsesNativeSkillPaths(t *testing.T) {
	meta, ok := AgentMeta["8gent"]
	if !ok {
		t.Fatal("expected 8gent entry in AgentMeta")
	}

	for _, p := range meta.GlobalSkillPaths {
		if filepath.Dir(p) != ".8gent" && p != ".8gent" && filepath.HasPrefix(p, ".claude") {
			t.Fatalf("8gent global skill path should not point inside .claude (got %q)", p)
		}
	}
	for _, p := range meta.LocalSkillPaths {
		if filepath.HasPrefix(p, ".claude") {
			t.Fatalf("8gent local skill path should not point inside .claude (got %q)", p)
		}
	}

	wantLocal := map[string]bool{".8gent/skills": false, ".8gent/agents": false, ".8gent/memory": false}
	for _, p := range meta.LocalSkillPaths {
		if _, ok := wantLocal[p]; ok {
			wantLocal[p] = true
		}
	}
	for path, found := range wantLocal {
		if !found {
			t.Fatalf("expected 8gent local skill paths to include %q", path)
		}
	}
}

func TestListAgentConfigsClassifies8gentResources(t *testing.T) {
	home := t.TempDir()
	projectRoot := t.TempDir()
	workspaceRoot := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	mustWriteFile(t, filepath.Join(home, ".8gent", "config.json"), `{"version":1,"provider":"8gent","model":"eight-1.0-q3:14b"}`)
	mustWriteFile(t, filepath.Join(projectRoot, ".8gent", "config.json"), `{"version":1,"provider":"ollama","model":"qwen3:14b"}`)
	mustWriteFile(t, filepath.Join(projectRoot, ".8gent", "skills", "release", "SKILL.md"), "# Release runbook\n")
	mustWriteFile(t, filepath.Join(projectRoot, ".8gent", "memory", "MEMORY.md"), "# Memory index\n")

	configs, err := ListAgentConfigs(workspaceRoot, projectRoot)
	if err != nil {
		t.Fatalf("ListAgentConfigs: %v", err)
	}

	want := []string{
		filepath.Join(home, ".8gent", "config.json"),
		filepath.Join(projectRoot, ".8gent", "config.json"),
		filepath.Join(projectRoot, ".8gent", "skills", "release", "SKILL.md"),
		filepath.Join(projectRoot, ".8gent", "memory", "MEMORY.md"),
	}
	for _, path := range want {
		if !containsConfigPath(configs, path) {
			t.Fatalf("expected ListAgentConfigs to surface %s, got %d configs", path, len(configs))
		}
	}
}

func containsConfigPath(configs []AgentConfig, path string) bool {
	for _, cfg := range configs {
		if cfg.Path == path {
			return true
		}
	}
	return false
}

// guard against a future refactor that accidentally removes the 8gent entry
func TestAgentMeta8gentEntryStillPresent(t *testing.T) {
	if _, ok := AgentMeta["8gent"]; !ok {
		t.Fatal("AgentMeta lost its 8gent entry; do not remove without coordinating with the EightgentRunner contract")
	}
	if _, err := os.Stat(filepath.Join("eightgent_runner.go")); err != nil && !os.IsNotExist(err) {
		t.Fatalf("unexpected error stating eightgent_runner.go: %v", err)
	}
}
