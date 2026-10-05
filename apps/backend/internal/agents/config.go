package agents

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ConfigScope indicates whether a configuration file is user-global or project-local.
type ConfigScope string

const (
	// ScopeGlobal marks a configuration that applies across all projects (e.g. ~/.claude/settings.json).
	ScopeGlobal ConfigScope = "GLOBAL"
	// ScopeProject marks a configuration scoped to a single project directory.
	ScopeProject ConfigScope = "PROJECT"
)

// AgentConfig represents a single agent configuration file discovered on disk,
// including its content, filesystem path, category (core vs. skill), and scope.
type AgentConfig struct {
	Name         string      `json:"name"`                    // e.g. "claude", "codex", "workspace.json"
	Content      string      `json:"content"`                 // File content
	Path         string      `json:"path"`                    // Full absolute path
	Category     string      `json:"category"`                // "CORE" or "SKILL"
	Scope        ConfigScope `json:"scope"`                   // "GLOBAL" or "PROJECT"
	Provider     string      `json:"provider,omitempty"`      // e.g. "codex", "claude"
	ResourceType string      `json:"resource_type,omitempty"` // e.g. "config", "instructions", "context"
	Variant      string      `json:"variant,omitempty"`       // e.g. "override", "stack"
	Priority     int         `json:"priority,omitempty"`      // Lower renders earlier in UI
	Origin       string      `json:"origin,omitempty"`        // e.g. "global", "project", "workspace"
	Depth        int         `json:"depth,omitempty"`         // Relative directory depth from the base root
}

// AgentMeta defines the filesystem layout for each supported agent, mapping agent
// names to their global config paths, project-local config paths, config format,
// and skill/sub-agent discovery directories.
var AgentMeta = map[string]struct {
	GlobalPaths      []string
	LocalPaths       []string
	Format           string // "json" or "toml"
	GlobalSkillPaths []string
	LocalSkillPaths  []string
}{
	"claude": {
		GlobalPaths:      []string{".claude/settings.json", ".claude.json"},
		LocalPaths:       []string{".claude/settings.json", ".claude/settings.local.json"},
		Format:           "json",
		GlobalSkillPaths: []string{".claude/agents"},
		LocalSkillPaths:  []string{".claude/agents"},
	},
	"codex": {
		GlobalPaths:      []string{".codex/config.toml", ".codex/AGENTS.md", ".codex/AGENTS.override.md"},
		LocalPaths:       []string{".codex/config.toml", "AGENTS.md", "AGENTS.override.md"},
		Format:           "toml",
		GlobalSkillPaths: []string{".codex/agents", ".agents/skills"},
		LocalSkillPaths:  []string{".codex/agents", ".agents/skills"},
	},
	"opencode": {
		GlobalPaths:      []string{".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"},
		LocalPaths:       []string{".opencode/opencode.json", ".opencode/opencode.jsonc", "opencode.json", "opencode.jsonc"},
		Format:           "json",
		GlobalSkillPaths: []string{".config/opencode/agents", ".config/opencode/skills", ".config/opencode/command", ".config/opencode/commands"},
		LocalSkillPaths:  []string{".opencode/agents", ".opencode/skills", ".opencode/command", ".opencode/commands"},
	},
	"8gent": {
		GlobalPaths:      []string{".8gent/config.json"},
		LocalPaths:       []string{".8gent/config.json"},
		Format:           "json",
		GlobalSkillPaths: []string{".8gent/skills", ".8gent/agents", ".8gent/memory"},
		LocalSkillPaths:  []string{".8gent/skills", ".8gent/agents", ".8gent/memory"},
	},
}

// GetHomeDir returns the current user's home directory, or an empty string if
// it cannot be determined.
func GetHomeDir() string {
	home, _ := os.UserHomeDir()
	return home
}

func resolvePath(p string) string {
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(GetHomeDir(), p[2:])
	}
	return p
}

// ListAgentConfigs discovers all agent configuration files for the given workspace
// and optional project root. It scans Orchestra's internal config directory, each
// agent's global and project-local paths, and skill/sub-agent directories, returning
// a consolidated list of AgentConfig entries.
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

	orchFiles := []string{".claude", ".opencode", ".codex", "workspace.json"}
	for _, name := range orchFiles {
		path := filepath.Join(orchAgentsDir, name)
		content := readOrCreate(path)
		configs = append(configs, AgentConfig{
			Name:         "Orchestra: " + name,
			Content:      content,
			Path:         path,
			Category:     "CORE",
			Scope:        ScopeGlobal,
			Provider:     "orchestra",
			ResourceType: "config",
			Priority:     100,
			Origin:       "workspace",
			Depth:        classifyResourceDepth(workspaceRoot, path),
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
							Name:         fmt.Sprintf("%s (Global)", agentName),
							Content:      string(content),
							Path:         fullPath,
							Category:     "CORE",
							Scope:        ScopeGlobal,
							Provider:     agentName,
							ResourceType: classifyCoreResourceType(agentName, fullPath),
							Variant:      classifyResourceVariant(agentName, fullPath),
							Priority:     classifyResourcePriority(agentName, fullPath, ScopeGlobal),
							Origin:       classifyResourceOrigin(ScopeGlobal),
							Depth:        classifyResourceDepth(home, fullPath),
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
						Name:         fmt.Sprintf("%s (Global)", agentName),
						Content:      string(content),
						Path:         path,
						Category:     "CORE",
						Scope:        ScopeGlobal,
						Provider:     agentName,
						ResourceType: classifyCoreResourceType(agentName, path),
						Variant:      classifyResourceVariant(agentName, path),
						Priority:     classifyResourcePriority(agentName, path, ScopeGlobal),
						Origin:       classifyResourceOrigin(ScopeGlobal),
						Depth:        classifyResourceDepth(home, path),
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
						Name:         fmt.Sprintf("%s (Project)", agentName),
						Content:      string(content),
						Path:         path,
						Category:     "CORE",
						Scope:        ScopeProject,
						Provider:     agentName,
						ResourceType: classifyCoreResourceType(agentName, path),
						Variant:      classifyResourceVariant(agentName, path),
						Priority:     classifyResourcePriority(agentName, path, ScopeProject),
						Origin:       classifyResourceOrigin(ScopeProject),
						Depth:        classifyResourceDepth(projectRoot, path),
					})
				}
			}
		}

		// Deep Discovery (Skills/Agents/Tools)
		for _, relSubDir := range meta.GlobalSkillPaths {
			globalSubDir := filepath.Join(home, relSubDir)
			configs = append(configs, discoverFilesInDir(globalSubDir, home, agentName, "SKILL", ScopeGlobal, classifySubdirResourceType(agentName, relSubDir), "global")...)
		}

		for _, relSubDir := range meta.LocalSkillPaths {
			if projectRoot != "" {
				projectSubDir := filepath.Join(projectRoot, relSubDir)
				configs = append(configs, discoverFilesInDir(projectSubDir, projectRoot, agentName, "SKILL", ScopeProject, classifySubdirResourceType(agentName, relSubDir), "project")...)
			}
		}
	}

	// 3. Skills in .codex/skills (Legacy/Internal)
	configs = append(configs, discoverFilesInDir(filepath.Join(workspaceRoot, ".codex", "skills"), workspaceRoot, "Orchestra", "SKILL", ScopeGlobal, "skills", "workspace")...)

	return configs, nil
}

func discoverFilesInDir(dir string, baseRoot string, prefix string, category string, scope ConfigScope, resourceType string, origin string) []AgentConfig {
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
				Name:         fmt.Sprintf("%s: %s", prefix, rel),
				Content:      string(bytes),
				Path:         path,
				Category:     category,
				Scope:        scope,
				Provider:     strings.ToLower(prefix),
				ResourceType: resourceType,
				Variant:      classifyResourceVariant(strings.ToLower(prefix), path),
				Priority:     classifyResourcePriority(strings.ToLower(prefix), path, scope),
				Origin:       origin,
				Depth:        classifyResourceDepth(baseRoot, path),
			})
		}
		return nil
	})
	return configs
}

func classifyCoreResourceType(provider string, path string) string {
	lowerPath := strings.ToLower(path)
	base := filepath.Base(lowerPath)
	switch provider {
	case "codex":
		if base == "config.toml" {
			return "config"
		}
		if base == "agents.md" || base == "agents.override.md" {
			return "instructions"
		}
	case "gemini":
		if base == "settings.json" {
			return "settings"
		}
		if base == "gemini.md" {
			return "context"
		}
	case "opencode":
		if base == "opencode.json" || base == "opencode.jsonc" {
			return "config"
		}
	case "claude":
		if base == "settings.json" || base == ".claude.json" {
			return "settings"
		}
	}
	return "config"
}

func classifySubdirResourceType(provider string, relSubDir string) string {
	lower := strings.ToLower(relSubDir)
	switch provider {
	case "codex":
		if strings.Contains(lower, "/agents") {
			return "agents"
		}
		if strings.Contains(lower, "/skills") {
			return "skills"
		}
	case "gemini":
		if strings.Contains(lower, "/commands") {
			return "commands"
		}
	case "opencode":
		if strings.Contains(lower, "/agents") {
			return "agents"
		}
		if strings.Contains(lower, "/skills") {
			return "skills"
		}
		if strings.Contains(lower, "/command") {
			return "commands"
		}
	}
	return "skills"
}

func classifyResourceVariant(provider string, path string) string {
	lowerPath := strings.ToLower(path)
	base := filepath.Base(lowerPath)
	switch provider {
	case "codex":
		if base == "agents.override.md" {
			return "override"
		}
		if base == "agents.md" {
			return "stack"
		}
	case "gemini":
		if base == "gemini.md" {
			return "context"
		}
	}
	return ""
}

func classifyResourcePriority(provider string, path string, scope ConfigScope) int {
	lowerPath := strings.ToLower(path)
	base := filepath.Base(lowerPath)
	isGlobal := scope == ScopeGlobal
	switch provider {
	case "codex":
		switch base {
		case "config.toml":
			if isGlobal {
				return 5
			}
			return 15
		case "agents.md":
			if isGlobal {
				return 20
			}
			return 30
		case "agents.override.md":
			if isGlobal {
				return 40
			}
			return 50
		}
	case "gemini":
		switch base {
		case "settings.json":
			if isGlobal {
				return 5
			}
			return 15
		case "gemini.md":
			if isGlobal {
				return 20
			}
			return 30
		}
	}
	if isGlobal {
		return 80
	}
	return 90
}

func classifyResourceOrigin(scope ConfigScope) string {
	if scope == ScopeGlobal {
		return "global"
	}
	return "project"
}

func classifyResourceDepth(baseRoot string, path string) int {
	if baseRoot == "" {
		return 0
	}
	rel, err := filepath.Rel(baseRoot, path)
	if err != nil {
		return 0
	}
	dir := filepath.Dir(rel)
	if dir == "." || dir == "" {
		return 0
	}
	return strings.Count(filepath.ToSlash(dir), "/") + 1
}

// UpdateConfigByPath writes content to the given absolute path, creating any
// intermediate directories as needed.
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

	name := filepath.Base(path)
	content := ""
	switch name {
	case ".claude", ".claude.json":
		content = "{\n  \"message\": \"Runtime configuration for Claude Code\",\n  \"custom_instructions\": \"You are an autonomous coding agent...\",\n  \"preferred_tools\": []\n}"
	case ".gemini", ".gemini.json":
		content = "{\n  \"message\": \"Runtime configuration for Gemini\",\n  \"model\": \"gemini-2.0-flash-thinking-exp\",\n  \"temperature\": 0.7\n}"
	case ".opencode", "opencode.json":
		content = "{\n  \"message\": \"Runtime configuration for OpenCode\",\n  \"capabilities\": {\n    \"browsing\": true,\n    \"shell\": true\n  }\n}"
	case ".codex":
		content = "[agent]\nname = \"Codex\"\nversion = \"1.0.0\"\n\n[runtime]\nmax_turns = 50\ntimeout = \"10m\"\n"
	case "workspace.json":
		content = "{\n  \"pointers\": {},\n  \"settings\": {\n    \"theme\": \"dark\"\n  }\n}"
	}

	_ = os.WriteFile(path, []byte(content), 0o644)
	return content
}

// UpdateGlobalAgentConfig writes content to the named file inside the workspace's
// .orchestra/agents directory.
func UpdateGlobalAgentConfig(workspaceRoot string, name string, content string) error {
	return UpdateConfigByPath(filepath.Join(workspaceRoot, ".orchestra", "agents", name), content)
}

// GetGlobalConfigMap reads the named JSON configuration file from the workspace's
// .orchestra/agents directory and returns its contents as a generic map.
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

// LoadGlobalWorkspaceDefaults loads and returns the workspace.json defaults from
// the workspace's .orchestra/agents directory.
func LoadGlobalWorkspaceDefaults(workspaceRoot string) (map[string]any, error) {
	return GetGlobalConfigMap(workspaceRoot, "workspace.json")
}
