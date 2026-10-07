package agents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Agent sources. A harness agent is a definition file owned by one harness;
// an orchestra agent is an Orchestra-native profile any adapter can apply.
const (
	AgentSourceHarness   = "harness"
	AgentSourceOrchestra = "orchestra"
)

// Agent observations recorded as the applied receipt of a run.
const (
	AgentApplied        = "applied"
	AgentAppliedPartial = "applied_partial"
	AgentNotApplied     = "not_applied"
)

// MCPServerSpec is one MCP server passed to a harness run.
type MCPServerSpec struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"` // local | remote
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Remote reports whether the server is reached over HTTP.
func (m MCPServerSpec) Remote() bool { return m.Type == "remote" || m.URL != "" && m.Command == "" }

// ResolvedSkill is a skill directory (containing SKILL.md) an agent may use.
// Native is true when the target harness already discovers it on its own.
type ResolvedSkill struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Native bool   `json:"native,omitempty"`
}

// AgentPermissions is best-effort per harness: allow | ask | deny.
type AgentPermissions struct {
	Edit     string `json:"edit,omitempty" yaml:"edit,omitempty"`
	Bash     string `json:"bash,omitempty" yaml:"bash,omitempty"`
	WebFetch string `json:"webfetch,omitempty" yaml:"webfetch,omitempty"`
}

// Restrictive reports whether any permission is narrower than allow.
func (p AgentPermissions) Restrictive() bool {
	for _, v := range []string{p.Edit, p.Bash, p.WebFetch} {
		if v == "ask" || v == "deny" {
			return true
		}
	}
	return false
}

// ResolvedAgent is the exact agent profile applied to one run. Resolution
// happens before dispatch (catalog + Orchestra store); adapters only apply it.
type ResolvedAgent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
	Scope       string `json:"scope"`
	// Harness owns a source=harness agent ("CLAUDE", ...). Empty for orchestra.
	Harness     string           `json:"harness,omitempty"`
	Mode        string           `json:"mode,omitempty"`
	Prompt      string           `json:"prompt,omitempty"`
	Model       string           `json:"model,omitempty"`
	Effort      string           `json:"effort,omitempty"`
	Color       string           `json:"color,omitempty"`
	Skills      []ResolvedSkill  `json:"skills,omitempty"`
	MCPServers  []string         `json:"mcp_servers,omitempty"`
	Permissions AgentPermissions `json:"permissions,omitempty"`
	ContentHash string           `json:"content_hash,omitempty"`
	Path        string           `json:"path,omitempty"`
}

// IsOrchestra reports whether the agent is an Orchestra-native profile.
func (a *ResolvedAgent) IsOrchestra() bool { return a != nil && a.Source == AgentSourceOrchestra }

// Capability describes one adapter mechanism.
type Capability struct {
	Supported bool   `json:"supported"`
	Mechanism string `json:"mechanism,omitempty"`
	Note      string `json:"note,omitempty"`
}

// HarnessCapabilities is what each adapter can apply for a selected agent.
type HarnessCapabilities struct {
	Harness      string     `json:"harness"`
	AgentSelect  Capability `json:"agent_select"`
	AgentInline  Capability `json:"agent_inline"`
	Skills       Capability `json:"skills"`
	MCP          Capability `json:"mcp"`
	Instructions Capability `json:"instructions"`
	Model        Capability `json:"model"`
	Effort       Capability `json:"effort"`
	Permissions  Capability `json:"permissions"`
}

const unverifiedNote = "unverified with installed CLI"

// SelectableHarnesses lists the harnesses whose adapters can apply agents.
// Gemini is retired and intentionally absent.
func SelectableHarnesses() []Provider {
	return []Provider{ProviderClaude, ProviderCodex, ProviderOpenCode, ProviderAntigravity, Provider8gent}
}

// CapabilitiesFor returns the adapter capability matrix for a harness. The
// notes record which mechanisms were confirmed against an installed CLI.
func CapabilitiesFor(provider Provider) (HarnessCapabilities, bool) {
	c := HarnessCapabilities{Harness: string(NormalizeProvider(string(provider)))}
	switch NormalizeProvider(string(provider)) {
	case ProviderClaude:
		c.AgentSelect = Capability{true, "--agent <name>", ""}
		c.AgentInline = Capability{true, "--agents <tmpfile> + --agent <name>", "verified live (claude 2.1.292)"}
		c.Skills = Capability{true, "--plugin-dir <tmp plugin> wrapping selected skill dirs", unverifiedNote}
		c.MCP = Capability{true, "--mcp-config <tmpfile>", "verified live (claude 2.1.292); user servers still load"}
		c.Instructions = Capability{true, "--append-system-prompt-file", ""}
		c.Model = Capability{true, "--model", ""}
		c.Effort = Capability{true, "--effort", ""}
		c.Permissions = Capability{true, "--disallowedTools for deny", "ask is not enforced"}
	case ProviderCodex:
		c.AgentSelect = Capability{true, ".codex/agents/*.toml mapped to developer instructions + model/effort", ""}
		c.AgentInline = Capability{true, "developerInstructions (native) / -c developer_instructions (exec)", "exec override " + unverifiedNote}
		c.Skills = Capability{true, "app-server skills/extraRoots/set (native); exec: native .agents/skills only", "native verified live (codex 0.160.0)"}
		c.MCP = Capability{true, "thread/start config.mcp_servers (native) / -c mcp_servers.<name>.* (exec)", "native verified live (codex 0.160.0)"}
		c.Instructions = Capability{true, "developerInstructions", ""}
		c.Model = Capability{true, "thread/turn model (native) / -c model (exec)", ""}
		c.Effort = Capability{true, "config.model_reasoning_effort (native) / -c model_reasoning_effort (exec)", "native verified live (codex 0.160.0)"}
		c.Permissions = Capability{false, "", "Codex sandbox/approval come from the harness configuration"}
	case ProviderOpenCode:
		c.AgentSelect = Capability{true, "--agent <name>", unverifiedNote}
		c.AgentInline = Capability{true, "OPENCODE_CONFIG=<tmpfile> agent.<name> + --agent", unverifiedNote}
		c.Skills = Capability{true, "skills.paths in OPENCODE_CONFIG tmpfile", unverifiedNote}
		c.MCP = Capability{true, "mcp in OPENCODE_CONFIG tmpfile", unverifiedNote}
		c.Instructions = Capability{true, "instructions:[tmpfile] in OPENCODE_CONFIG", unverifiedNote}
		c.Model = Capability{true, "-m provider/model", unverifiedNote}
		c.Effort = Capability{true, "--variant", unverifiedNote}
		c.Permissions = Capability{true, "agent.<name>.permission", unverifiedNote}
	case ProviderAntigravity:
		c.AgentSelect = Capability{true, "--agent <name> (+ init confirmation)", "flag accepted live (agy 1.3.1); agy echoes any name, so selection is not proven"}
		c.AgentInline = Capability{true, ".agents/agents/<name>/agent.md in run cwd (merged, removed after run) + --agent", unverifiedNote}
		c.Skills = Capability{true, ".agents/skills in run cwd (merged, removed after run)", unverifiedNote}
		c.MCP = Capability{true, ".agents/mcp_config.json in run cwd (merged, restored after run)", unverifiedNote + "; `agy mcp list` does not show workspace servers"}
		c.Instructions = Capability{true, ".agents/rules/orchestra.md in run cwd", unverifiedNote}
		c.Model = Capability{true, "--model", ""}
		c.Effort = Capability{true, "--effort", ""}
		c.Permissions = Capability{false, "", "agy permissions come from its own policy"}
	case Provider8gent:
		// 8gent agent support is deferred; the prompt-prefix adapter code is
		// kept but not offered.
		deferred := Capability{false, "", "deferred: see follow-up issue"}
		c.AgentSelect, c.AgentInline, c.Skills, c.MCP = deferred, deferred, deferred, deferred
		c.Instructions, c.Model, c.Effort, c.Permissions = deferred, deferred, deferred, deferred
	default:
		return c, false
	}
	return c, true
}

// AllCapabilities returns the matrix for every selectable harness.
func AllCapabilities() []HarnessCapabilities {
	out := []HarnessCapabilities{}
	for _, p := range SelectableHarnesses() {
		if c, ok := CapabilitiesFor(p); ok {
			out = append(out, c)
		}
	}
	return out
}

// CanApplyAgent reports whether provider's adapter can apply agent at all.
func CanApplyAgent(provider Provider, agent *ResolvedAgent) error {
	if agent == nil {
		return fmt.Errorf("agent profile was not resolved")
	}
	p := NormalizeProvider(string(provider))
	caps, ok := CapabilitiesFor(p)
	if !ok {
		return fmt.Errorf("provider %s has no agent adapter", p)
	}
	if agent.Mode == "subagent" {
		return fmt.Errorf("subagent definitions cannot be selected as the primary agent")
	}
	switch agent.Source {
	case AgentSourceOrchestra:
		if !caps.AgentInline.Supported {
			return fmt.Errorf("provider %s cannot apply Orchestra agents", p)
		}
	case AgentSourceHarness:
		if NormalizeProvider(agent.Harness) != p {
			return fmt.Errorf("%s agent %q belongs to %s", strings.ToLower(agent.Harness), agent.Name, agent.Harness)
		}
		if !caps.AgentSelect.Supported {
			return fmt.Errorf("provider %s cannot select named agents", p)
		}
	default:
		return fmt.Errorf("unknown agent source %q", agent.Source)
	}
	if !agentNamePattern.MatchString(agent.Name) {
		return fmt.Errorf("agent name %q is not supported by harness adapters", agent.Name)
	}
	return nil
}

var agentNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`)
var mcpNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// ValidMCPServerName reports whether name is safe as a config key in every adapter.
func ValidMCPServerName(name string) bool { return mcpNamePattern.MatchString(name) }

// agentReceipt accumulates what an adapter applied for a selected agent.
type agentReceipt struct {
	agent   *ResolvedAgent
	skipped []string
}

func (r *agentReceipt) skip(what string) {
	if r == nil {
		return
	}
	for _, s := range r.skipped {
		if s == what {
			return
		}
	}
	r.skipped = append(r.skipped, what)
}

func (r *agentReceipt) observation() string {
	if r == nil || r.agent == nil {
		return ""
	}
	if len(r.skipped) == 0 {
		return AgentApplied
	}
	sort.Strings(r.skipped)
	return AgentAppliedPartial + ":" + strings.Join(r.skipped, ",")
}

// tomlString renders a TOML basic string (JSON escapes are a TOML subset when
// HTML escaping is disabled and "\/" is never produced).
func tomlString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return strings.TrimSpace(buf.String())
}

func tomlStringArray(values []string) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = tomlString(v)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func tomlInlineTable(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = tomlString(k) + "=" + tomlString(values[k])
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// combineInstructions joins thread instructions with the agent prompt.
func combineInstructions(base string, agent *ResolvedAgent) string {
	if agent == nil || strings.TrimSpace(agent.Prompt) == "" {
		return base
	}
	section := "# Agent: " + agent.Name + "\n\n" + strings.TrimSpace(agent.Prompt)
	if strings.TrimSpace(base) == "" {
		return section
	}
	return strings.TrimRight(base, "\n") + "\n\n" + section
}

// effectiveModel returns the explicit per-message model, else the agent's.
func effectiveModel(request TurnRequest) string {
	if request.RequestedModel != "" {
		return request.RequestedModel
	}
	if request.Agent != nil {
		return request.Agent.Model
	}
	return ""
}

// effectiveEffort returns the explicit effort, else the agent's.
func effectiveEffort(request TurnRequest) string {
	if request.RequestedEffort != "" {
		return request.RequestedEffort
	}
	if request.Agent != nil {
		return request.Agent.Effort
	}
	return ""
}

// mcpForRun returns the MCP servers adapters must pass, with valid names only.
func mcpForRun(request TurnRequest) []MCPServerSpec {
	out := make([]MCPServerSpec, 0, len(request.MCPServers))
	for _, s := range request.MCPServers {
		if ValidMCPServerName(s.Name) && (s.Command != "" || s.URL != "") {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func nonNativeSkills(agent *ResolvedAgent) []ResolvedSkill {
	if agent == nil {
		return nil
	}
	out := []ResolvedSkill{}
	for _, s := range agent.Skills {
		if !s.Native && s.Path != "" {
			out = append(out, s)
		}
	}
	return out
}
