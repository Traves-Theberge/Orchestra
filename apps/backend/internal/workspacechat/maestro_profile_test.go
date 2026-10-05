package workspacechat

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaestroProfileRetainsLocalInstructionsAndSkills(t *testing.T) {
	root := t.TempDir()
	if err := provisionMaestroProfile(root); err != nil {
		t.Fatal(err)
	}
	skill := filepath.Join(root, ".agents", "skills", "orchestra-cli", "SKILL.md")
	if _, err := os.Stat(skill); err != nil {
		t.Fatal(err)
	}
	custom := "# My Maestro instructions\nKeep my local customization.\n"
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte(custom), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skill, []byte("custom skill"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := provisionMaestroProfile(root); err != nil {
		t.Fatal(err)
	}
	instructions, err := maestroInstructions(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(instructions, custom) || !strings.Contains(instructions, "agent name is Maestro") || !strings.Contains(instructions, "custom skill") {
		t.Fatal("local instructions or identity lost")
	}
	content, err := os.ReadFile(skill)
	if err != nil || string(content) != "custom skill" {
		t.Fatal("local skill overwritten")
	}
}

func TestMaestroBundledSkillMatchesExecutableCLISkill(t *testing.T) {
	for _, name := range []string{"SKILL.md", "references/task-system.md", "agents/openai.yaml"} {
		bundled, err := maestroDefaults.ReadFile("maestro/orchestra-cli/" + name)
		if err != nil {
			t.Fatal(err)
		}
		source, err := os.ReadFile(filepath.Join("..", "..", "..", "..", ".codex", "skills", "orchestra-cli", filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(bundled, source) {
			t.Fatalf("bundled CLI skill differs: %s", name)
		}
	}
}

func TestMaestroProfileRejectsRedirectedSkillDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, ".agents")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := provisionMaestroProfile(root); err == nil {
		t.Fatal("redirected skill directory accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, "skills")); !os.IsNotExist(err) {
		t.Fatal("wrote outside profile")
	}
}
