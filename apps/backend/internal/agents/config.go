package agents

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type ConfigScope string

const (
	ScopeGlobal  ConfigScope = "global"
	ScopeProject ConfigScope = "project"
)

type AgentConfig struct {
	Name     string      `json:"name"`     // e.g. "claude", "gemini", "workspace.json"
	Content  string      `json:"content"`  // File content
	Path     string      `json:"path"`     // Full absolute path
	Category string      `json:"category"` // "core" or "skill"
	Scope    ConfigScope `json:"scope"`    // "global" or "project"
}

// AgentMeta defines where each agent looks for its configs
var AgentMeta = map[string]struct {
	GlobalPaths []string
	LocalPaths  []string
	Format      string // "json" or "toml"
}{
	"claude": {
		GlobalPaths: []string{".claude/settings.json", ".claude.json"},
		LocalPaths:  []string{".claude/settings.json", ".claude/settings.local.json"},
		Format:      "json",
		SkillPaths:  []string{".claude/agents"}, // Claude sub-agents
	},
	"codex": {
		GlobalPaths: []string{".codex/config.toml"},
		LocalPaths:  []string{".codex/config.toml", "AGENTS.md"},
		Format:      "toml",
		SkillPaths:  []string{".codex/skills"},
	},
	"gemini": {
		GlobalPaths: []string{".gemini/settings.json"},
		LocalPaths:  []string{".gemini/settings.json"},
		Format:      "json",
	},
	"opencode": {
		GlobalPaths: []string{".config/opencode/opencode.json"},
		LocalPaths:  []string{"opencode.json"},
		Format:      "json",
		SkillPaths:  []string{".config/opencode/agents", ".config/opencode/skills", ".config/opencode/tools"},
	},
}

func ListAgentConfigs(workspaceRoot string, projectRoot string) ([]AgentConfig, error) {
	var configs []AgentConfig
	home := GetHomeDir()
	
	// Load pointers from workspace.json
	workspaceJsonPath := filepath.Join(workspaceRoot, ".orchestra", "agents", "workspace.json")
	var workspaceConfig struct {
		Pointers map[string]map[string]string `json:"pointers"`
	}
	if bytes, err := os.ReadFile(workspaceJsonPath); err == nil {
		_ = json.Unmarshal(bytes, &workspaceConfig)
	}

	// 1. Internal Orchestra Core Configs
	orchAgentsDir := filepath.Join(workspaceRoot, ".orchestra", "agents")
	_ = os.MkdirAll(orchAgentsDir, 0o755)
	
	orchFiles := []string{".claude", ".gemini", ".opencode", ".codex", "workspace.json"}
	for _, name := range orchFiles {
		path := filepath.Join(orchAgentsDir, name)
		content := readOrCreate(path)
		configs = append(configs, AgentConfig{
			Name:     "Orchestra: " + name,
			Content:  content,
			Path:     path,
			Category: "core",
			Scope:    ScopeGlobal,
		})
	}

	// 2. Real Agent Configs (Global & Project)
	for agentName, meta := range AgentMeta {
		// Global
		foundGlobal := false
		if workspaceConfig.Pointers != nil {
			if scopes, ok := workspaceConfig.Pointers[agentName]; ok {
				if globalPath, ok := scopes["global"]; ok && globalPath != "" {
					fullPath := resolvePath(globalPath)
					if content, err := os.ReadFile(fullPath); err == nil {
						configs = append(configs, AgentConfig{
							Name:     fmt.Sprintf("%s (Global)", agentName),
							Content:  string(content),
							Path:     fullPath,
							Category: "core",
							Scope:    ScopeGlobal,
						})
						foundGlobal = true
					}
				}
			}
		}
		if !foundGlobal {
			for _, relPath := range meta.GlobalPaths {
				path := filepath.Join(home, relPath)
				if content, err := os.ReadFile(path); err == nil {
					configs = append(configs, AgentConfig{
						Name:     fmt.Sprintf("%s (Global)", agentName),
						Content:  string(content),
						Path:     path,
						Category: "core",
						Scope:    ScopeGlobal,
					})
					break
				}
			}
		}

		// Project
		if projectRoot != "" {
			for _, relPath := range meta.LocalPaths {
				path := filepath.Join(projectRoot, relPath)
				if content, err := os.ReadFile(path); err == nil {
					configs = append(configs, AgentConfig{
						Name:     fmt.Sprintf("%s (Project)", agentName),
						Content:  string(content),
						Path:     path,
						Category: "core",
						Scope:    ScopeProject,
					})
				}
			}
		}

		// Deep Discovery (Skills/Agents/Tools)
		for _, relSubDir := range meta.SkillPaths {
			// Check Global Subdir
			globalSubDir := filepath.Join(home, relSubDir)
			configs = append(configs, discoverFilesInDir(globalSubDir, agentName, "skill", ScopeGlobal)...)

			// Check Project Subdir
			if projectRoot != "" {
				projectSubDir := filepath.Join(projectRoot, relSubDir)
				configs = append(configs, discoverFilesInDir(projectSubDir, agentName, "skill", ScopeProject)...)
			}
		}
	}

	// 3. Skills in .codex/skills (Legacy/Internal)
	configs = append(configs, discoverFilesInDir(filepath.Join(workspaceRoot, ".codex", "skills"), "Orchestra", "skill", ScopeGlobal)...)

	return configs, nil
}

func discoverFilesInDir(dir string, prefix string, category string, scope ConfigScope) []AgentConfig {
	var configs []AgentConfig
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		// Only pick up meaningful files (json, toml, md, yaml)
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".json" && ext != ".toml" && ext != ".md" && ext != ".yaml" && !strings.HasPrefix(filepath.Base(path), ".") {
			return nil
		}

		bytes, err := os.ReadFile(path)
		if err == nil {
			rel, _ := filepath.Rel(dir, path)
			configs = append(configs, AgentConfig{
				Name:     fmt.Sprintf("%s: %s", prefix, rel),
				Content:  string(bytes),
				Path:     path,
				Category: category,
				Scope:    scope,
			})
		}
		return nil
	})
	return configs
}

func UpdateConfigByPath(path string, content string) error {
	cleanPath := filepath.Clean(path)
	if err := os.MkdirAll(filepath.Dir(cleanPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(cleanPath, []byte(content), 0o644)
}

func readOrCreate(path string) string {
	if _, err := os.Stat(path); err == nil {
		bytes, _ := os.ReadFile(path)
		return string(bytes)
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(""), 0o644)
	return ""
}

func UpdateGlobalAgentConfig(workspaceRoot string, name string, content string) error {
	return UpdateConfigByPath(filepath.Join(workspaceRoot, ".orchestra", "agents", name), content)
}

func GetGlobalConfigMap(workspaceRoot string, name string) (map[string]any, error) {
	path := filepath.Join(workspaceRoot, ".orchestra", "agents", name)
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data map[string]any
	if err := json.Unmarshal(bytes, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func LoadGlobalWorkspaceDefaults(workspaceRoot string) (map[string]any, error) {
	return GetGlobalConfigMap(workspaceRoot, "workspace.json")
}
