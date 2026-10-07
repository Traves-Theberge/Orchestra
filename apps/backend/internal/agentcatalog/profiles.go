package agentcatalog

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	toml "github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"
)

// Agent is the normalized agent profile shared by every harness (spec
// docs/superpowers/specs/agents-profiles-2026-10-07.md).
type Agent struct {
	ID                  string                  `json:"id"`
	Name                string                  `json:"name"`
	Description         string                  `json:"description,omitempty"`
	Mode                string                  `json:"mode"`
	Source              string                  `json:"source"`
	Scope               Scope                   `json:"scope"`
	Harness             string                  `json:"harness"`
	CompatibleHarnesses []string                `json:"compatible_harnesses"`
	Model               string                  `json:"model,omitempty"`
	Effort              string                  `json:"effort,omitempty"`
	Color               string                  `json:"color,omitempty"`
	Prompt              string                  `json:"prompt"`
	Skills              []string                `json:"skills"`
	MCPServers          []string                `json:"mcp_servers"`
	Permissions         agents.AgentPermissions `json:"permissions"`
	Path                string                  `json:"path"`
	Format              string                  `json:"format"`
	ContentHash         string                  `json:"content_hash"`
	Selectable          bool                    `json:"selectable"`
	UnavailableReason   string                  `json:"unavailable_reason,omitempty"`
}

// Skill is a discovered skill; Harness is "shared" for Orchestra skills.
type Skill struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Path        string `json:"path"`
	Scope       Scope  `json:"scope"`
	Harness     string `json:"harness"`
	ContentHash string `json:"content_hash"`
}

// AgentInput creates or patches an Orchestra agent. Nil fields are unchanged.
type AgentInput struct {
	Scope        Scope                    `json:"scope"`
	ProjectID    string                   `json:"project_id"`
	WorkspaceID  string                   `json:"workspace_id"`
	Name         *string                  `json:"name"`
	Description  *string                  `json:"description"`
	Mode         *string                  `json:"mode"`
	Model        *string                  `json:"model"`
	Effort       *string                  `json:"effort"`
	Color        *string                  `json:"color"`
	Prompt       *string                  `json:"prompt"`
	Skills       *[]string                `json:"skills"`
	MCPServers   *[]string                `json:"mcp_servers"`
	Permissions  *agents.AgentPermissions `json:"permissions"`
	ExpectedHash string                   `json:"content_hash"`
}

// ResolveRequest identifies a selected agent for a target harness.
type ResolveRequest struct {
	ProjectID   string
	WorkspaceID string
	Harness     string
	AgentID     string
	Scope       string
	Hash        string
	Format      string
}

const (
	SourceHarness   = agents.AgentSourceHarness
	SourceOrchestra = agents.AgentSourceOrchestra
	sharedHarness   = "shared"
	orchestraFormat = "orchestra-markdown"
)

var (
	effortPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)
	colorPattern  = regexp.MustCompile(`^(#[0-9A-Fa-f]{3,8}|[a-z][a-z-]{0,31})$`)
	refPattern    = regexp.MustCompile(`^(\*|[A-Za-z0-9][A-Za-z0-9._:-]{0,79})$`)
)

// HarnessAgentID is the stable id of a harness-owned definition.
func HarnessAgentID(scope Scope, harness, resourceID string) string {
	return SourceHarness + ":" + string(scope) + ":" + strings.ToLower(harness) + ":" + resourceID
}

// OrchestraAgentID is the stable id of an Orchestra-native agent.
func OrchestraAgentID(scope Scope, name string) string {
	return SourceOrchestra + ":" + string(scope) + ":orchestra:" + name
}

// ParseAgentID splits "<source>:<scope>:<harness|orchestra>:<name>".
func ParseAgentID(id string) (source string, scope Scope, harness, name string, ok bool) {
	parts := strings.SplitN(id, ":", 4)
	if len(parts) != 4 || parts[3] == "" {
		return "", "", "", "", false
	}
	scope = Scope(parts[1])
	if scope != ScopeProject && scope != ScopeGlobal {
		return "", "", "", "", false
	}
	switch parts[0] {
	case SourceOrchestra:
		if parts[2] != "orchestra" || !namePart.MatchString(parts[3]) {
			return "", "", "", "", false
		}
		return SourceOrchestra, scope, "", parts[3], true
	case SourceHarness:
		h, err := normalizeHarness(parts[2])
		if err != nil || !validResourceID(parts[3], KindAgentDefinition) {
			return "", "", "", "", false
		}
		return SourceHarness, scope, h, parts[3], true
	}
	return "", "", "", "", false
}

// harnessAgentName is the name a harness CLI selects: Claude and agy use the
// frontmatter name; OpenCode and Codex use the file id.
func harnessAgentName(harness, id, metaName string) string {
	if (harness == "CLAUDE" || harness == "ANTIGRAVITY" || harness == "OMP") && strings.TrimSpace(metaName) != "" {
		return strings.TrimSpace(metaName)
	}
	return id
}

type agentMeta struct {
	name, description, mode, model, effort, color, prompt string
	skills, mcpServers                                    []string
	permissions                                           agents.AgentPermissions
}

func stringList(v any) []string {
	switch t := v.(type) {
	case string:
		out := []string{}
		for _, part := range strings.Split(t, ",") {
			if p := strings.TrimSpace(part); p != "" {
				out = append(out, p)
			}
		}
		return out
	case []any:
		out := []string{}
		for _, item := range t {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	}
	return nil
}

func permissionValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// splitFrontmatter returns YAML frontmatter and the markdown body.
func splitFrontmatter(text string) (string, string, bool) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return "", text, false
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return "", text, false
	}
	body := text[4+end+4:]
	if i := strings.Index(body, "\n"); i >= 0 {
		body = body[i+1:]
	} else {
		body = ""
	}
	return text[4 : 4+end], body, true
}

// parseAgentFile reads markdown+YAML (Claude, OpenCode, agy, Orchestra) or
// TOML (Codex .codex/agents) definitions.
func parseAgentFile(data []byte, ext string) agentMeta {
	var out agentMeta
	if strings.EqualFold(ext, ".toml") {
		var fields map[string]any
		if toml.Unmarshal(data, &fields) != nil {
			return out
		}
		out.name, _ = fields["name"].(string)
		out.description, _ = fields["description"].(string)
		out.prompt, _ = fields["developer_instructions"].(string)
		out.model, _ = fields["model"].(string)
		out.effort, _ = fields["model_reasoning_effort"].(string)
		out.mode, _ = fields["mode"].(string)
		return out
	}
	front, body, ok := splitFrontmatter(string(data))
	out.prompt = strings.TrimSpace(body)
	if !ok {
		return out
	}
	var fields map[string]any
	if yaml.Unmarshal([]byte(front), &fields) != nil {
		return out
	}
	out.name, _ = fields["name"].(string)
	out.description, _ = fields["description"].(string)
	out.mode, _ = fields["mode"].(string)
	out.model, _ = fields["model"].(string)
	out.color, _ = fields["color"].(string)
	for _, key := range []string{"effort", "reasoning_effort", "reasoningEffort"} {
		if v, ok := fields[key].(string); ok && v != "" {
			out.effort = v
			break
		}
	}
	out.skills = stringList(fields["skills"])
	out.mcpServers = stringList(fields["mcp_servers"])
	for _, key := range []string{"permissions", "permission"} {
		if perms, ok := fields[key].(map[string]any); ok {
			out.permissions = agents.AgentPermissions{Edit: permissionValue(perms["edit"]), Bash: permissionValue(perms["bash"]), WebFetch: permissionValue(perms["webfetch"])}
			break
		}
	}
	if subagent, ok := fields["subagent"].(bool); ok && subagent {
		out.mode = "subagent"
	} else if mainAgent, ok := fields["mainAgent"].(bool); ok {
		if mainAgent {
			out.mode = "primary"
		} else {
			out.mode = "subagent"
		}
	}
	return out
}

func selectionStatus(harness string, kind Kind, mode, capability string) (string, string) {
	if kind == KindSkill {
		return SelectionUnsupported, "Skills are not primary-agent profiles."
	}
	if caps, ok := agents.CapabilitiesFor(agents.Provider(harness)); !ok || !caps.AgentSelect.Supported {
		return SelectionUnsupported, "The " + harness + " adapter cannot select named agents."
	}
	if mode == "subagent" {
		return "subagent_only", "This native definition is marked as a subagent."
	}
	if capability == SelectionUnavailable || capability == SelectionUnsupported {
		return capability, "No " + harness + " command is configured."
	}
	return SelectionSelectablePrimary, ""
}

func supportsAuthoring(harness string) bool {
	return harness == "OPENCODE" || harness == "CLAUDE" || harness == "CODEX" || harness == "ANTIGRAVITY" || harness == "OMP"
}

// selectionProbe reports whether the harness can run at all; what an agent
// selection applies is decided by the adapter capability matrix.
func (s *Service) selectionProbe(_ context.Context, harness string) runtimeProbe {
	if strings.TrimSpace(s.commands[harness]) == "" {
		return runtimeProbe{SelectionUnavailable, "", "No " + harness + " command is configured."}
	}
	return runtimeProbe{SelectionSelectablePrimary, "", ""}
}

func (s *Service) harnessConfigured(harness string) bool {
	return strings.TrimSpace(s.commands[harness]) != ""
}

// orchestraSelectable computes selectable/unavailable_reason for an
// Orchestra agent on a target harness ("" = any compatible harness).
func (s *Service) orchestraSelectable(a *Agent, harness string) {
	a.Selectable, a.UnavailableReason = false, ""
	if a.Mode == "subagent" {
		a.UnavailableReason = "This agent is a subagent and cannot be the primary agent."
		return
	}
	if harness == "" {
		for _, h := range a.CompatibleHarnesses {
			if s.harnessConfigured(h) {
				a.Selectable = true
				return
			}
		}
		a.UnavailableReason = "No compatible harness command is configured."
		return
	}
	compatible := false
	for _, h := range a.CompatibleHarnesses {
		compatible = compatible || h == harness
	}
	if !compatible {
		a.UnavailableReason = "The " + harness + " adapter cannot apply Orchestra agents."
		return
	}
	if !s.harnessConfigured(harness) {
		a.UnavailableReason = "No " + harness + " command is configured."
		return
	}
	a.Selectable = true
}

func orchestraCompatible() []string {
	out := []string{}
	for _, p := range agents.SelectableHarnesses() {
		if caps, ok := agents.CapabilitiesFor(p); ok && caps.AgentInline.Supported {
			out = append(out, string(p))
		}
	}
	return out
}

func itemAgent(item Item) Agent {
	a := Agent{ID: item.AgentID, Name: item.Name, Description: item.Description, Mode: item.Mode, Source: SourceHarness, Scope: item.Scope, Harness: item.Harness, CompatibleHarnesses: []string{item.Harness}, Model: item.Model, Effort: item.Effort, Color: item.Color, Prompt: item.prompt, Skills: nonNil(item.Skills), MCPServers: nonNil(item.MCPServers), Path: item.Path, Format: item.Format, ContentHash: item.ContentHash, Selectable: item.Selectable, UnavailableReason: item.UnavailableReason}
	if a.Mode == "" {
		a.Mode = "all"
	}
	if item.Permissions != nil {
		a.Permissions = *item.Permissions
	}
	return a
}

func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// orchestraDirs returns the Orchestra agent/skill directory roots in scope order.
func (s *Service) orchestraRoots(ctx context.Context, projectID, workspaceID string, scope Scope) ([]resolvedScope, error) {
	if projectID == "" {
		projectID = "__orchestrator__"
		scope = ScopeGlobal
	}
	return s.scopes(ctx, Request{ProjectID: projectID, WorkspaceID: workspaceID, Scope: scope})
}

func orchestraAgentDir(root string) string { return filepath.Join(root, ".orchestra", "agents") }
func orchestraSkillDir(root string) string { return filepath.Join(root, ".orchestra", "skills") }

func readOrchestraAgent(path string, scope Scope) (Agent, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Agent{}, err
	}
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	meta := parseAgentFile(data, ".md")
	a := Agent{ID: OrchestraAgentID(scope, name), Name: name, Description: meta.description, Mode: first(meta.mode, "primary"), Source: SourceOrchestra, Scope: scope, CompatibleHarnesses: orchestraCompatible(), Model: meta.model, Effort: meta.effort, Color: meta.color, Prompt: meta.prompt, Skills: nonNil(meta.skills), MCPServers: nonNil(meta.mcpServers), Permissions: meta.permissions, Path: path, Format: orchestraFormat, ContentHash: contentHash(data)}
	return a, nil
}

func (s *Service) listOrchestraAgents(ctx context.Context, projectID, workspaceID string) ([]Agent, error) {
	scope := ScopeEffective
	if projectID == "" || projectID == "__orchestrator__" {
		scope = ScopeGlobal
	}
	roots, err := s.orchestraRoots(ctx, projectID, workspaceID, scope)
	if err != nil {
		return nil, err
	}
	out := []Agent{}
	for _, root := range roots {
		dir := orchestraAgentDir(root.root)
		entries, err := os.ReadDir(dir)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			name := strings.TrimSuffix(e.Name(), ".md")
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") || !namePart.MatchString(name) || e.Type()&os.ModeSymlink != 0 {
				continue
			}
			a, err := readOrchestraAgent(filepath.Join(dir, e.Name()), root.scope)
			if err != nil {
				return nil, err
			}
			out = append(out, a)
		}
	}
	return out, nil
}

func targetHarnesses(harness string) ([]string, error) {
	if strings.TrimSpace(harness) != "" {
		h, err := normalizeHarness(harness)
		if err != nil {
			return nil, err
		}
		return []string{h}, nil
	}
	out := []string{}
	for _, p := range agents.SelectableHarnesses() {
		out = append(out, string(p))
	}
	return out, nil
}

func catalogScope(projectID string) (string, Scope) {
	if projectID == "" || projectID == "__orchestrator__" {
		return "__orchestrator__", ScopeGlobal
	}
	return projectID, ScopeEffective
}

// Agents is the unified list: harness-owned definitions plus Orchestra
// agents, with selectable computed for harness ("" = each agent's own).
func (s *Service) Agents(ctx context.Context, projectID, workspaceID, harness string) ([]Agent, error) {
	harnesses, err := targetHarnesses(harness)
	if err != nil {
		return nil, err
	}
	target := ""
	if harness != "" {
		target = harnesses[0]
	}
	pid, scope := catalogScope(projectID)
	out := []Agent{}
	for _, h := range harnesses {
		cat, err := s.List(ctx, Request{ProjectID: pid, WorkspaceID: workspaceID, Harness: h, Scope: scope})
		if err != nil {
			return nil, err
		}
		for _, item := range cat.Items {
			if item.Kind == KindAgentDefinition {
				out = append(out, itemAgent(item))
			}
		}
	}
	orchestra, err := s.listOrchestraAgents(ctx, projectID, workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range orchestra {
		s.orchestraSelectable(&orchestra[i], target)
		out = append(out, orchestra[i])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source > out[j].Source // orchestra first
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func skillFromItem(item Item) Skill {
	path := item.Path
	if filepath.Base(path) == "SKILL.md" {
		path = filepath.Dir(path)
	}
	name := item.ID
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	return Skill{Name: name, Description: item.Description, Path: path, Scope: item.Scope, Harness: item.Harness, ContentHash: item.ContentHash}
}

func (s *Service) sharedSkills(ctx context.Context, projectID, workspaceID string) ([]Skill, error) {
	pid, scope := catalogScope(projectID)
	roots, err := s.orchestraRoots(ctx, pid, workspaceID, scope)
	if err != nil {
		return nil, err
	}
	out := []Skill{}
	for _, root := range roots {
		dir := orchestraSkillDir(root.root)
		found, err := walkResources(root.root, dir, KindSkill, "ORCHESTRA", root.scope, "")
		if err != nil {
			return nil, err
		}
		for _, item := range found {
			if filepath.Base(item.Path) != "SKILL.md" {
				continue
			}
			sk := skillFromItem(item)
			sk.Harness = sharedHarness
			out = append(out, sk)
		}
	}
	return out, nil
}

// Skills lists harness skills (one harness or all) plus shared Orchestra skills.
func (s *Service) Skills(ctx context.Context, projectID, workspaceID, harness string) ([]Skill, error) {
	harnesses, err := targetHarnesses(harness)
	if err != nil {
		return nil, err
	}
	pid, scope := catalogScope(projectID)
	out := []Skill{}
	for _, h := range harnesses {
		cat, err := s.List(ctx, Request{ProjectID: pid, WorkspaceID: workspaceID, Harness: h, Scope: scope})
		if err != nil {
			return nil, err
		}
		for _, item := range cat.Items {
			if item.Kind == KindSkill {
				out = append(out, skillFromItem(item))
			}
		}
	}
	shared, err := s.sharedSkills(ctx, projectID, workspaceID)
	if err != nil {
		return nil, err
	}
	out = append(out, shared...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Harness != out[j].Harness {
			return out[i].Harness < out[j].Harness
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// findAgent locates an agent by id (new format or legacy harness resource id).
func (s *Service) findAgent(ctx context.Context, req ResolveRequest) (Agent, error) {
	source, scope, owner, name, ok := ParseAgentID(req.AgentID)
	if !ok {
		// Legacy: a bare resource id of the target harness in req.Scope.
		h, err := normalizeHarness(req.Harness)
		if err != nil {
			return Agent{}, err
		}
		if req.Scope != string(ScopeProject) && req.Scope != string(ScopeGlobal) {
			return Agent{}, ErrInvalid
		}
		source, scope, owner, name = SourceHarness, Scope(req.Scope), h, req.AgentID
	}
	if req.Scope != "" && Scope(req.Scope) != scope {
		return Agent{}, ErrConflict
	}
	pid := req.ProjectID
	if pid == "" {
		pid = "__orchestrator__"
	}
	if pid == "__orchestrator__" && scope != ScopeGlobal {
		return Agent{}, ErrForbidden
	}
	if source == SourceOrchestra {
		roots, err := s.orchestraRoots(ctx, pid, req.WorkspaceID, scope)
		if err != nil {
			return Agent{}, err
		}
		path := filepath.Join(orchestraAgentDir(roots[0].root), name+".md")
		a, err := readOrchestraAgent(path, scope)
		if errors.Is(err, os.ErrNotExist) {
			return Agent{}, ErrNotFound
		}
		return a, err
	}
	cat, err := s.List(ctx, Request{ProjectID: pid, WorkspaceID: req.WorkspaceID, Harness: owner, Scope: scope})
	if err != nil {
		return Agent{}, err
	}
	for _, item := range cat.Items {
		if item.Kind == KindAgentDefinition && item.ID == name && item.Scope == scope {
			return itemAgent(item), nil
		}
	}
	return Agent{}, ErrNotFound
}

// ResolveAgent turns a selection into the exact profile adapters apply.
// An expected hash (when given) must match the current content.
func (s *Service) ResolveAgent(ctx context.Context, req ResolveRequest) (*agents.ResolvedAgent, error) {
	target, err := normalizeHarness(req.Harness)
	if err != nil {
		return nil, err
	}
	a, err := s.findAgent(ctx, req)
	if err != nil {
		return nil, err
	}
	if req.Hash != "" && req.Hash != a.ContentHash || req.Format != "" && req.Format != a.Format {
		return nil, ErrConflict
	}
	if a.Source == SourceOrchestra {
		s.orchestraSelectable(&a, target)
	} else if a.Harness != target {
		return nil, fmt.Errorf("%w: %s agent %q cannot run on %s", ErrUnsupported, strings.ToLower(a.Harness), a.Name, target)
	}
	if !a.Selectable {
		return nil, fmt.Errorf("%w: %s", ErrUnsupported, first(a.UnavailableReason, "agent is not selectable"))
	}
	resolved := &agents.ResolvedAgent{ID: a.ID, Name: a.Name, Description: a.Description, Source: a.Source, Scope: string(a.Scope), Mode: a.Mode, Prompt: a.Prompt, Model: a.Model, Effort: a.Effort, Color: a.Color, Permissions: a.Permissions, ContentHash: a.ContentHash, Path: a.Path}
	if a.Source == SourceHarness {
		resolved.Harness = a.Harness
	}
	for _, m := range a.MCPServers {
		if m != "*" {
			resolved.MCPServers = append(resolved.MCPServers, m)
		}
	}
	if len(a.Skills) > 0 && !(len(a.Skills) == 1 && a.Skills[0] == "*") {
		skills, err := s.resolveSkills(ctx, req.ProjectID, req.WorkspaceID, target, a.Skills)
		if err != nil {
			return nil, err
		}
		resolved.Skills = skills
	}
	return resolved, nil
}

func (s *Service) resolveSkills(ctx context.Context, projectID, workspaceID, target string, names []string) ([]agents.ResolvedSkill, error) {
	all, err := s.Skills(ctx, projectID, workspaceID, "")
	if err != nil {
		return nil, err
	}
	out := []agents.ResolvedSkill{}
	for _, name := range names {
		if name == "*" {
			continue
		}
		var native, other *Skill
		for i := range all {
			if all[i].Name != name {
				continue
			}
			if all[i].Harness == target && native == nil {
				native = &all[i]
			} else if other == nil || all[i].Harness == sharedHarness {
				other = &all[i]
			}
		}
		switch {
		case native != nil:
			out = append(out, agents.ResolvedSkill{Name: name, Path: native.Path, Native: true})
		case other != nil:
			out = append(out, agents.ResolvedSkill{Name: name, Path: other.Path})
		default:
			return nil, fmt.Errorf("%w: skill %q was not found", ErrConflict, name)
		}
	}
	return out, nil
}

func validateAgentInput(in AgentInput) error {
	check := func(v *string, ok func(string) bool) error {
		if v != nil && *v != "" && !ok(*v) {
			return ErrInvalid
		}
		return nil
	}
	if err := check(in.Mode, func(v string) bool { return v == "primary" || v == "subagent" || v == "all" }); err != nil {
		return fmt.Errorf("%w: mode must be primary, subagent or all", err)
	}
	if err := check(in.Effort, effortPattern.MatchString); err != nil {
		return fmt.Errorf("%w: effort must be a lowercase identifier", err)
	}
	if err := check(in.Color, colorPattern.MatchString); err != nil {
		return fmt.Errorf("%w: color must be a hex value or color name", err)
	}
	if err := check(in.Model, func(v string) bool { return len(v) <= 200 && !strings.ContainsAny(v, "\n\r") }); err != nil {
		return fmt.Errorf("%w: model is invalid", err)
	}
	if in.Description != nil && (len(*in.Description) > 1024 || strings.ContainsAny(*in.Description, "\n\r")) {
		return fmt.Errorf("%w: description must be one line up to 1024 bytes", ErrInvalid)
	}
	if in.Prompt != nil && len(*in.Prompt) > 256*1024 {
		return fmt.Errorf("%w: prompt is too long", ErrInvalid)
	}
	for _, list := range []*[]string{in.Skills, in.MCPServers} {
		if list == nil {
			continue
		}
		for _, v := range *list {
			if !refPattern.MatchString(v) {
				return fmt.Errorf("%w: invalid skill or MCP server name %q", ErrInvalid, v)
			}
		}
	}
	if p := in.Permissions; p != nil {
		for _, v := range []string{p.Edit, p.Bash, p.WebFetch} {
			if v != "" && v != "allow" && v != "ask" && v != "deny" {
				return fmt.Errorf("%w: permissions must be allow, ask or deny", ErrInvalid)
			}
		}
	}
	return nil
}

type orchestraFrontmatter struct {
	Name        string                   `yaml:"name"`
	Description string                   `yaml:"description,omitempty"`
	Mode        string                   `yaml:"mode,omitempty"`
	Model       string                   `yaml:"model,omitempty"`
	Effort      string                   `yaml:"effort,omitempty"`
	Color       string                   `yaml:"color,omitempty"`
	Skills      []string                 `yaml:"skills,omitempty"`
	MCPServers  []string                 `yaml:"mcp_servers,omitempty"`
	Permissions *agents.AgentPermissions `yaml:"permissions,omitempty"`
}

func renderOrchestraAgent(a Agent) ([]byte, error) {
	front := orchestraFrontmatter{Name: a.Name, Description: a.Description, Mode: a.Mode, Model: a.Model, Effort: a.Effort, Color: a.Color, Skills: a.Skills, MCPServers: a.MCPServers}
	if a.Permissions != (agents.AgentPermissions{}) {
		p := a.Permissions
		front.Permissions = &p
	}
	raw, err := yaml.Marshal(front)
	if err != nil {
		return nil, err
	}
	return []byte("---\n" + string(raw) + "---\n\n" + strings.TrimSpace(a.Prompt) + "\n"), nil
}

func applyAgentInput(a *Agent, in AgentInput) {
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = strings.TrimSpace(*v)
		}
	}
	set(&a.Description, in.Description)
	set(&a.Mode, in.Mode)
	set(&a.Model, in.Model)
	set(&a.Effort, in.Effort)
	set(&a.Color, in.Color)
	if in.Prompt != nil {
		a.Prompt = *in.Prompt
	}
	if in.Skills != nil {
		a.Skills = *in.Skills
	}
	if in.MCPServers != nil {
		a.MCPServers = *in.MCPServers
	}
	if in.Permissions != nil {
		a.Permissions = *in.Permissions
	}
	if a.Mode == "" {
		a.Mode = "primary"
	}
}

func (s *Service) orchestraWriteRoot(ctx context.Context, projectID, workspaceID string, scope Scope) (string, error) {
	if scope != ScopeProject && scope != ScopeGlobal {
		return "", ErrInvalid
	}
	if scope == ScopeProject && (projectID == "" || projectID == "__orchestrator__") {
		return "", ErrForbidden
	}
	roots, err := s.orchestraRoots(ctx, projectID, workspaceID, scope)
	if err != nil {
		return "", err
	}
	return roots[0].root, nil
}

// CreateOrchestraAgent writes <root>/.orchestra/agents/<name>.md.
func (s *Service) CreateOrchestraAgent(ctx context.Context, in AgentInput) (Agent, error) {
	if in.Name == nil || !namePart.MatchString(*in.Name) {
		return Agent{}, fmt.Errorf("%w: name must match %s", ErrInvalid, namePart.String())
	}
	if err := validateAgentInput(in); err != nil {
		return Agent{}, err
	}
	root, err := s.orchestraWriteRoot(ctx, in.ProjectID, in.WorkspaceID, in.Scope)
	if err != nil {
		return Agent{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(orchestraAgentDir(root), *in.Name+".md")
	if _, err := os.Lstat(path); err == nil {
		return Agent{}, ErrConflict
	}
	a := Agent{Name: *in.Name, Skills: []string{}, MCPServers: []string{}}
	applyAgentInput(&a, in)
	data, err := renderOrchestraAgent(a)
	if err != nil {
		return Agent{}, err
	}
	if err = atomicWrite(root, path, data); err != nil {
		return Agent{}, err
	}
	out, err := readOrchestraAgent(path, in.Scope)
	if err == nil {
		s.orchestraSelectable(&out, "")
	}
	return out, err
}

func (s *Service) orchestraPath(ctx context.Context, id, projectID, workspaceID string) (string, string, Scope, error) {
	source, scope, _, name, ok := ParseAgentID(id)
	if !ok || source != SourceOrchestra {
		return "", "", "", fmt.Errorf("%w: only Orchestra agents are managed here; edit harness files through the agent-catalog resource endpoints", ErrUnsupported)
	}
	root, err := s.orchestraWriteRoot(ctx, projectID, workspaceID, scope)
	if err != nil {
		return "", "", "", err
	}
	return root, filepath.Join(orchestraAgentDir(root), name+".md"), scope, nil
}

// UpdateOrchestraAgent patches an Orchestra agent (expected hash optional).
func (s *Service) UpdateOrchestraAgent(ctx context.Context, id string, in AgentInput) (Agent, error) {
	if err := validateAgentInput(in); err != nil {
		return Agent{}, err
	}
	root, path, scope, err := s.orchestraPath(ctx, id, in.ProjectID, in.WorkspaceID)
	if err != nil {
		return Agent{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, err := readOrchestraAgent(path, scope)
	if errors.Is(err, os.ErrNotExist) {
		return Agent{}, ErrNotFound
	} else if err != nil {
		return Agent{}, err
	}
	if in.ExpectedHash != "" && in.ExpectedHash != a.ContentHash {
		return Agent{}, ErrConflict
	}
	if in.Name != nil && *in.Name != a.Name {
		return Agent{}, fmt.Errorf("%w: agents cannot be renamed; create a new agent", ErrInvalid)
	}
	applyAgentInput(&a, in)
	data, err := renderOrchestraAgent(a)
	if err != nil {
		return Agent{}, err
	}
	if err = atomicWrite(root, path, data); err != nil {
		return Agent{}, err
	}
	out, err := readOrchestraAgent(path, scope)
	if err == nil {
		s.orchestraSelectable(&out, "")
	}
	return out, err
}

// DeleteOrchestraAgent removes an Orchestra agent (expected hash optional).
func (s *Service) DeleteOrchestraAgent(ctx context.Context, id, projectID, workspaceID, expectedHash string) error {
	root, path, scope, err := s.orchestraPath(ctx, id, projectID, workspaceID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, err := readOrchestraAgent(path, scope)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if expectedHash != "" && expectedHash != a.ContentHash {
		return ErrConflict
	}
	if err = ensureContained(root, path); err != nil {
		return err
	}
	return os.Remove(path)
}
