package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// agentRunPlan is what an adapter adds to one CommandRunner invocation.
type agentRunPlan struct {
	commandLine string
	env         []string
	// promptPrefix is prepended to the prompt (harnesses without instructions files).
	promptPrefix string
	receipt      *agentReceipt
	cleanups     []func()
	// tempPaths are per-run files/directories, removed by cleanup.
	tempPaths []string
}

func (p *agentRunPlan) cleanup() {
	if p == nil {
		return
	}
	for i := len(p.cleanups) - 1; i >= 0; i-- {
		p.cleanups[i]()
	}
	p.cleanups = nil
}

func (p *agentRunPlan) addTemp(path string) {
	p.tempPaths = append(p.tempPaths, path)
	p.cleanups = append(p.cleanups, func() { _ = os.RemoveAll(path) })
}

func (p *agentRunPlan) arg(flag string, values ...string) {
	p.commandLine += " " + flag
	for _, v := range values {
		p.commandLine += " " + shellQuote(v)
	}
}

// hasFlag reports whether a user-configured command already sets a flag, in
// which case the adapter leaves the user's choice alone.
func hasFlag(commandLine string, flags ...string) bool {
	for _, f := range flags {
		if regexp.MustCompile(`(^|\s)` + regexp.QuoteMeta(f) + `(\s|=|$)`).MatchString(commandLine) {
			return true
		}
	}
	return false
}

func writeTempFile(pattern string, data []byte) (string, error) {
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	if _, err = f.Write(data); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err = f.Close(); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

// stageSkills copies selected skill directories into root/<name>.
func stageSkills(root string, skills []ResolvedSkill) error {
	for _, s := range skills {
		if !agentNamePattern.MatchString(s.Name) || strings.Contains(s.Name, "/") {
			return fmt.Errorf("skill name %q is not supported", s.Name)
		}
		if info, err := os.Stat(s.Path); err == nil && !info.IsDir() {
			// Single-file skills are staged as <name>/SKILL.md.
			data, readErr := os.ReadFile(s.Path)
			if readErr == nil {
				readErr = os.MkdirAll(filepath.Join(root, s.Name), 0o755)
			}
			if readErr == nil {
				readErr = os.WriteFile(filepath.Join(root, s.Name, "SKILL.md"), data, 0o644)
			}
			if readErr != nil {
				return fmt.Errorf("stage skill %s: %w", s.Name, readErr)
			}
			continue
		}
		if err := copyTree(s.Path, filepath.Join(root, s.Name)); err != nil {
			return fmt.Errorf("stage skill %s: %w", s.Name, err)
		}
	}
	return nil
}

// planCommandAgent prepares agent/MCP/skills application for a one-shot
// command harness. Every temp file it creates is removed by plan.cleanup().
func planCommandAgent(provider Provider, commandLine string, request TurnRequest) (plan *agentRunPlan, err error) {
	plan = &agentRunPlan{commandLine: commandLine}
	if request.Agent != nil {
		plan.receipt = &agentReceipt{agent: request.Agent}
	}
	defer func() {
		if err != nil {
			plan.cleanup()
			plan = nil
		}
	}()
	switch NormalizeProvider(string(provider)) {
	case ProviderClaude:
		err = planClaude(plan, request)
	case ProviderCodex:
		err = planCodexExec(plan, request)
	case ProviderOpenCode:
		err = planOpenCode(plan, request)
	case ProviderAntigravity:
		err = planAntigravityBatch(plan, request)
	case Provider8gent:
		err = planEightgent(plan, request)
	default:
		if request.Agent != nil {
			err = fmt.Errorf("provider %s has no agent adapter", provider)
		}
	}
	return plan, err
}

func claudeMCPConfig(servers []MCPServerSpec) map[string]any {
	out := map[string]any{}
	for _, s := range servers {
		if s.Remote() {
			entry := map[string]any{"type": "http", "url": s.URL}
			if len(s.Headers) > 0 {
				entry["headers"] = s.Headers
			}
			out[s.Name] = entry
			continue
		}
		entry := map[string]any{"type": "stdio", "command": s.Command, "args": nonNilArgs(s.Args)}
		if len(s.Env) > 0 {
			entry["env"] = s.Env
		}
		out[s.Name] = entry
	}
	return map[string]any{"mcpServers": out}
}

func nonNilArgs(args []string) []string {
	if args == nil {
		return []string{}
	}
	return args
}

func planClaude(plan *agentRunPlan, request TurnRequest) error {
	agent := request.Agent
	if agent != nil && !hasFlag(plan.commandLine, "--agent") {
		if agent.IsOrchestra() {
			def := map[string]any{"description": firstNonEmpty(agent.Description, "Orchestra agent "+agent.Name), "prompt": agent.Prompt}
			raw, _ := json.MarshalIndent(map[string]any{agent.Name: def}, "", "  ")
			file, err := writeTempFile("orchestra-agents-*.json", raw)
			if err != nil {
				return err
			}
			plan.addTemp(file)
			plan.arg("--agents", filepath.ToSlash(file))
		}
		plan.arg("--agent", agent.Name)
	}
	if model := effectiveModel(request); model != "" && !hasFlag(plan.commandLine, "--model") {
		plan.arg("--model", model)
	}
	if effort := effectiveEffort(request); effort != "" && !hasFlag(plan.commandLine, "--effort") {
		plan.arg("--effort", effort)
	}
	if servers := mcpForRun(request); len(servers) > 0 {
		raw, _ := json.MarshalIndent(claudeMCPConfig(servers), "", "  ")
		file, err := writeTempFile("orchestra-mcp-*.json", raw)
		if err != nil {
			return err
		}
		plan.addTemp(file)
		plan.arg("--mcp-config", filepath.ToSlash(file))
	}
	if skills := nonNativeSkills(agent); len(skills) > 0 {
		dir, err := os.MkdirTemp("", "orchestra-skills-plugin-*")
		if err != nil {
			return err
		}
		plan.addTemp(dir)
		manifest, _ := json.MarshalIndent(map[string]any{"name": "orchestra-skills", "version": "0.0.0", "description": "Skills selected by the Orchestra agent " + agent.Name}, "", "  ")
		if err = os.MkdirAll(filepath.Join(dir, ".claude-plugin"), 0o755); err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(dir, ".claude-plugin", "plugin.json"), manifest, 0o644); err != nil {
			return err
		}
		if err = stageSkills(filepath.Join(dir, "skills"), skills); err != nil {
			return err
		}
		plan.arg("--plugin-dir", filepath.ToSlash(dir))
	}
	if agent != nil && agent.Permissions.Restrictive() {
		denied := []string{}
		if agent.Permissions.Edit == "deny" {
			denied = append(denied, "Edit", "Write", "NotebookEdit")
		}
		if agent.Permissions.Bash == "deny" {
			denied = append(denied, "Bash")
		}
		if agent.Permissions.WebFetch == "deny" {
			denied = append(denied, "WebFetch")
		}
		if len(denied) > 0 && !hasFlag(plan.commandLine, "--disallowedTools", "--disallowed-tools") {
			plan.arg("--disallowedTools", strings.Join(denied, ","))
		}
		if agent.Permissions.Edit == "ask" || agent.Permissions.Bash == "ask" || agent.Permissions.WebFetch == "ask" {
			plan.receipt.skip("permissions")
		}
	}
	return nil
}

func codexMCPOverrides(servers []MCPServerSpec) []string {
	out := []string{}
	for _, s := range servers {
		key := "mcp_servers." + s.Name
		if s.Remote() {
			out = append(out, key+".url="+tomlString(s.URL))
			if len(s.Headers) > 0 {
				out = append(out, key+".http_headers="+tomlInlineTable(s.Headers))
			}
			continue
		}
		out = append(out, key+".command="+tomlString(s.Command))
		out = append(out, key+".args="+tomlStringArray(nonNilArgs(s.Args)))
		if len(s.Env) > 0 {
			out = append(out, key+".env="+tomlInlineTable(s.Env))
		}
	}
	return out
}

func planCodexExec(plan *agentRunPlan, request TurnRequest) error {
	agent := request.Agent
	if agent != nil && strings.TrimSpace(agent.Prompt) != "" {
		// The value is a TOML string read by the shell from a file, which keeps
		// long instructions off the length-limited Windows command line.
		file, err := writeTempFile("orchestra-codex-instructions-*.toml", []byte(tomlString(combineInstructions(request.DeveloperInstructions, agent))))
		if err != nil {
			return err
		}
		plan.addTemp(file)
		plan.commandLine += ` -c "developer_instructions=$(cat ` + shellQuote(filepath.ToSlash(file)) + `)"`
	}
	if model := effectiveModel(request); model != "" && !hasFlag(plan.commandLine, "--model", "-m") && !strings.Contains(plan.commandLine, "model=") {
		plan.arg("-c", "model="+tomlString(model))
	}
	if effort := effectiveEffort(request); effort != "" && !strings.Contains(plan.commandLine, "model_reasoning_effort") {
		plan.arg("-c", "model_reasoning_effort="+tomlString(effort))
	}
	for _, override := range codexMCPOverrides(mcpForRun(request)) {
		plan.arg("-c", override)
	}
	if len(nonNativeSkills(agent)) > 0 {
		plan.receipt.skip("skills")
	}
	if agent != nil && agent.Permissions.Restrictive() {
		plan.receipt.skip("permissions")
	}
	return nil
}

func openCodePermission(p AgentPermissions) map[string]any {
	out := map[string]any{}
	if p.Edit != "" {
		out["edit"] = p.Edit
	}
	if p.Bash != "" {
		out["bash"] = p.Bash
	}
	if p.WebFetch != "" {
		out["webfetch"] = p.WebFetch
	}
	return out
}

func openCodeMCP(servers []MCPServerSpec) map[string]any {
	out := map[string]any{}
	for _, s := range servers {
		if s.Remote() {
			entry := map[string]any{"type": "remote", "url": s.URL, "enabled": true}
			if len(s.Headers) > 0 {
				entry["headers"] = s.Headers
			}
			out[s.Name] = entry
			continue
		}
		entry := map[string]any{"type": "local", "command": append([]string{s.Command}, s.Args...), "enabled": true}
		if len(s.Env) > 0 {
			entry["environment"] = s.Env
		}
		out[s.Name] = entry
	}
	return out
}

// planOpenCode writes one OPENCODE_CONFIG temp file. OpenCode merges it over
// the user's own config, so harness-native agents and servers still load.
func planOpenCode(plan *agentRunPlan, request TurnRequest) error {
	agent := request.Agent
	config := map[string]any{"$schema": "https://opencode.ai/config.json"}
	if agent != nil && !hasFlag(plan.commandLine, "--agent") {
		if agent.IsOrchestra() {
			def := map[string]any{"description": firstNonEmpty(agent.Description, "Orchestra agent "+agent.Name), "mode": "primary", "prompt": agent.Prompt}
			if perm := openCodePermission(agent.Permissions); len(perm) > 0 {
				def["permission"] = perm
			}
			config["agent"] = map[string]any{agent.Name: def}
		} else if agent.Permissions.Restrictive() {
			plan.receipt.skip("permissions")
		}
		plan.arg("--agent", agent.Name)
	}
	if model := effectiveModel(request); model != "" && !hasFlag(plan.commandLine, "-m", "--model") {
		if strings.Contains(model, "/") {
			plan.arg("-m", model)
		} else if plan.receipt != nil {
			plan.receipt.skip("model")
		}
	}
	if effort := effectiveEffort(request); effort != "" && !hasFlag(plan.commandLine, "--variant") {
		plan.arg("--variant", effort)
	}
	if servers := mcpForRun(request); len(servers) > 0 {
		config["mcp"] = openCodeMCP(servers)
	}
	if skills := nonNativeSkills(agent); len(skills) > 0 {
		dir, err := os.MkdirTemp("", "orchestra-opencode-skills-*")
		if err != nil {
			return err
		}
		plan.addTemp(dir)
		if err = stageSkills(dir, skills); err != nil {
			return err
		}
		config["skills"] = map[string]any{"paths": []string{filepath.ToSlash(dir)}}
	}
	if strings.TrimSpace(request.DeveloperInstructions) != "" {
		file, err := writeTempFile("orchestra-instructions-*.md", []byte(request.DeveloperInstructions))
		if err != nil {
			return err
		}
		plan.addTemp(file)
		config["instructions"] = []string{filepath.ToSlash(file)}
	}
	if len(config) == 1 {
		return nil
	}
	raw, _ := json.MarshalIndent(config, "", "  ")
	file, err := writeTempFile("orchestra-opencode-*.json", raw)
	if err != nil {
		return err
	}
	plan.addTemp(file)
	plan.env = append(plan.env, "OPENCODE_CONFIG="+file)
	return nil
}

// antigravityAgentMarkdown renders an agy agent file for an Orchestra agent.
func antigravityAgentMarkdown(name string, agent *ResolvedAgent) []byte {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("name: " + tomlString(name) + "\n")
	b.WriteString("description: " + tomlString(firstNonEmpty(agent.Description, "Orchestra agent "+agent.Name)) + "\n")
	b.WriteString("---\n")
	b.WriteString(strings.TrimSpace(agent.Prompt) + "\n")
	return []byte(b.String())
}

func antigravityMCP(servers []MCPServerSpec) map[string]any {
	out := map[string]any{}
	for _, s := range servers {
		if s.Remote() {
			entry := map[string]any{"serverUrl": s.URL}
			if len(s.Headers) > 0 {
				entry["headers"] = s.Headers
			}
			out[s.Name] = entry
			continue
		}
		entry := map[string]any{"command": s.Command, "args": nonNilArgs(s.Args)}
		if len(s.Env) > 0 {
			entry["env"] = s.Env
		}
		out[s.Name] = entry
	}
	return out
}

// antigravityApplied is the result of writing agy's per-run workspace files.
type antigravityApplied struct {
	overlay   *workspaceOverlay
	agentName string
	receipt   *agentReceipt
}

// applyAntigravityWorkspace writes the agent, rules, skills and MCP files agy
// discovers from its cwd. Callers must release the overlay after the run.
func applyAntigravityWorkspace(workspace string, request TurnRequest) (*antigravityApplied, error) {
	agent := request.Agent
	out := &antigravityApplied{}
	if agent != nil {
		out.receipt = &agentReceipt{agent: agent}
		out.agentName = agent.Name
	}
	servers := mcpForRun(request)
	skills := nonNativeSkills(agent)
	if !agent.IsOrchestra() && len(servers) == 0 && len(skills) == 0 {
		return out, nil
	}
	overlay, err := newWorkspaceOverlay(workspace)
	if err != nil {
		return nil, err
	}
	out.overlay = overlay
	fail := func(err error) (*antigravityApplied, error) {
		overlay.release()
		return nil, err
	}
	if agent.IsOrchestra() {
		written := false
		for _, name := range []string{agent.Name, "orchestra-" + agent.Name} {
			err := overlay.create(filepath.Join(".agents", "agents", name, "agent.md"), antigravityAgentMarkdown(name, agent))
			if err == nil {
				out.agentName, written = name, true
				break
			}
			if !errors.Is(err, errOverlayConflict) {
				return fail(err)
			}
		}
		if !written {
			return fail(fmt.Errorf("an Antigravity agent named %q already exists in the workspace", agent.Name))
		}
		if instructions := strings.TrimSpace(request.DeveloperInstructions); instructions != "" {
			if err := overlay.create(filepath.Join(".agents", "rules", "orchestra.md"), []byte(instructions+"\n")); err != nil && !errors.Is(err, errOverlayConflict) {
				return fail(err)
			}
		}
	}
	for _, skill := range skills {
		if err := overlay.copyDir(skill.Path, filepath.Join(".agents", "skills", skill.Name)); err != nil {
			if errors.Is(err, errOverlayConflict) {
				out.receipt.skip("skills")
				continue
			}
			return fail(err)
		}
	}
	if len(servers) > 0 {
		additions := map[string]any{}
		for name, entry := range antigravityMCP(servers) {
			additions[name] = entry
		}
		added, err := overlay.mergeJSONObject(filepath.Join(".agents", "mcp_config.json"), "mcpServers", additions)
		if err != nil {
			return fail(err)
		}
		if len(added) < len(servers) && out.receipt != nil {
			out.receipt.skip("mcp")
		}
	}
	return out, nil
}

func planAntigravityBatch(plan *agentRunPlan, request TurnRequest) error {
	applied, err := applyAntigravityWorkspace(request.Workspace, request)
	if err != nil {
		return err
	}
	if applied.overlay != nil {
		plan.cleanups = append(plan.cleanups, applied.overlay.release)
	}
	if applied.receipt != nil {
		plan.receipt = applied.receipt
	}
	if applied.agentName != "" && !hasFlag(plan.commandLine, "--agent") {
		plan.arg("--agent", applied.agentName)
	}
	if model := effectiveModel(request); model != "" && !hasFlag(plan.commandLine, "--model") {
		plan.arg("--model", model)
	}
	if effort := effectiveEffort(request); effort != "" && !hasFlag(plan.commandLine, "--effort") {
		plan.arg("--effort", effort)
	}
	if request.Agent != nil && request.Agent.Permissions.Restrictive() {
		plan.receipt.skip("permissions")
	}
	return nil
}

func planEightgent(plan *agentRunPlan, request TurnRequest) error {
	agent := request.Agent
	if agent != nil {
		if strings.TrimSpace(agent.Prompt) != "" {
			plan.promptPrefix = "<agent_instructions name=\"" + agent.Name + "\">\n" + strings.TrimSpace(agent.Prompt) + "\n</agent_instructions>\n\n"
		}
		if len(nonNativeSkills(agent)) > 0 {
			plan.receipt.skip("skills")
		}
		if len(request.MCPServers) > 0 {
			plan.receipt.skip("mcp")
		}
		if effectiveEffort(request) != "" {
			plan.receipt.skip("effort")
		}
		if agent.Permissions.Restrictive() {
			plan.receipt.skip("permissions")
		}
	}
	if model := effectiveModel(request); model != "" && !hasFlag(plan.commandLine, "--model") {
		plan.arg("--model", model)
	}
	return nil
}

// ValidateAgentSelection is a real capability check: the agent must have been
// resolved and this harness's adapter must be able to apply its kind.
func (r *CommandRunner) ValidateAgentSelection(_ context.Context, request TurnRequest) error {
	if request.Agent == nil {
		return errors.New("requested agent was not resolved to a profile")
	}
	return CanApplyAgent(r.provider, request.Agent)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
