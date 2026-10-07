# Agents, skills and MCP across harnesses (spec, 2026-10-07)

Goal: an OpenCode-style agent system that actually applies at runtime on
every supported harness: Claude, Codex, OpenCode, Antigravity (agy), 8gent.
Gemini is retired (see Cleanup). Decisions: Codex applies agents as
instructions + model/effort/MCP/skills; Orchestra-native agents ship now.

## Principles

1. Nothing the UI offers may be silently ignored. Every selectable option is
   backed by an adapter capability; anything unsupported is shown disabled
   with a reason.
2. Per-run application only. Adapters never mutate the user's global harness
   config. Use per-run temp files (deleted after the turn) or files written
   inside the run's worktree/project only when the harness has no per-run
   mechanism (agy).
3. Prefer files over inline JSON on command lines (Windows ~32K / shell ~8K
   limits; see `writePromptFile` in internal/agents/command_runner.go).
4. Each run records what was actually applied ("applied receipt").

## Data model (normalized)

```
Agent {
  id            // stable: "<source>:<scope>:<harness|orchestra>:<name>"
  name, description
  mode          // primary | subagent | all
  source        // harness (a harness's own file) | orchestra (native)
  scope         // project | global
  harness       // owning harness for source=harness; "" for orchestra
  compatible_harnesses []   // orchestra agents: every harness whose adapter can apply it
  model, effort, color, prompt
  skills []     // skill names the agent may use ("*" = all)
  mcp_servers []// MCP server names the agent may use
  permissions { edit, bash, webfetch: allow|ask|deny }   // best-effort per harness
  path, format, content_hash
  selectable bool, unavailable_reason string            // computed per target harness
}
Skill { name, description, path, scope, harness | "shared", content_hash }
McpServer { name, type: local|remote, command, args[], env{}, url, headers{},
            enabled, source: orchestra|harness, status, error }
HarnessCapabilities { harness, agent_select, agent_inline, skills, mcp,
            instructions, model, effort, permissions  // each {supported, mechanism, note}
}
```

Orchestra-native agents are markdown files with OpenCode-like YAML
frontmatter (fields above) and the prompt as the body:
- global: `~/.orchestra/agents/<name>.md`
- project: `<project root>/.orchestra/agents/<name>.md`

## Adapter matrix (what each adapter does when an agent is selected)

| | Claude | Codex (native app-server + exec) | OpenCode | agy | 8gent |
|---|---|---|---|---|---|
| harness agent | `--agent <name>` | `.codex/agents/*.toml` → map fields to developer instructions + model/effort/mcp/skills | `--agent <name>` | `--agent <name>` (+ existing confirmation check) | n/a |
| orchestra agent | `--agents <tmpfile>` + `--agent <name>` | developerInstructions (+ `-c` overrides for exec) | `OPENCODE_CONFIG=<tmpfile>` with `agent.<name>` + `--agent` | write `.agents/agents/<name>/agent.md` in the run cwd (orchestra-managed, gitignored via .orchestra-style marker) + `--agent` | AGENTS.md-style instructions prefix in prompt |
| MCP | `--mcp-config <tmpfile>` (no `--strict-mcp-config`; user servers still load) | app-server `config` / exec `-c mcp_servers.X.*` | `mcp` in OPENCODE_CONFIG tmpfile | `.agents/mcp_config.json` in run cwd (merge, never clobber) | `EIGHT_HOME` overlay (unverified, mark capability accordingly) |
| skills | `--plugin-dir <tmp plugin>` wrapping selected skill dirs, or existing `.claude/skills` | app-server `skills/extraRoots/set`; exec: `.agents/skills` | `skills.paths` in tmp config | `.agents/skills` in run cwd | `.claude/skills` under cwd |
| instructions | `--append-system-prompt-file` (exists) | developerInstructions (exists) | `instructions:[tmpfile]` | `.agents/rules/orchestra.md` in run cwd | prompt prefix |
| model / effort | `--model` (exists) / `--effort` | thread/turn model + effort (exists) | `-m provider/model` / `--variant` | `--model` / `--effort` | `--model` / none |

Every cell marked unverified by research must be covered by an adapter unit
test of the exact argv/env/files, and capability `note` must say
"unverified with installed CLI" until a live check passes.

## Selection flow

- Chat (workspacechat Create/Send) keeps the existing request fields
  `agent_id, agent_scope, agent_content_hash, agent_format` (desktop client
  already sends them). `agent_id` now uses the Agent.id format above.
  `validateAgentIntent` must accept selections the target harness adapter can
  apply (replace the always-reject paths: registry.go AgentSelectionValidator
  check, OpenCodeRunner.ValidateAgentSelection, missing validators for
  Claude/Codex/agy/8gent).
- The resolved agent (prompt, model, effort, skills, MCP) flows into
  `agents.TurnRequest` (new field `Agent *ResolvedAgent`) and each adapter
  applies it. Explicit per-message model/effort override the agent's.
- Automations: add optional `agent_id` to AutomationInput/Automation
  (docs/superpowers/specs/automations-2026-10-07.md) and pass it through.
- Task dispatch: optional agent on the task (issue field or metadata) applied
  at dispatch; if no agent, behavior unchanged.

## MCP registry

The Orchestra `mcp_servers` table (and cfg.MCPServers) is the source of
Orchestra-managed servers. Fix app/run.go so the registry is populated (no
empty map) and expose status. Orchestra servers are passed to harness runs
through the adapter mechanisms above (enabled servers only; an agent's
`mcp_servers` list narrows the set when present). Harness-native servers keep
loading from the harness's own config; the UI lists both, labeled by source.
Status: `connected | disabled | failed | needs_auth | unknown` from a
lightweight probe (spawn + initialize handshake with timeout for local;
HEAD/initialize for remote), cached.

## API (protected router; extend existing agent-catalog where possible)

```
GET  /api/v1/harnesses/capabilities                   -> { harnesses: HarnessCapabilities[] }
GET  /api/v1/projects/{pid}/agent-catalog?harness=&scope=effective
     (existing) items gain the Agent fields above; selectable/unavailable_reason
     computed for ?harness. pid "__orchestrator__" = global only.
GET  /api/v1/agents?project_id=&harness=              -> { agents: Agent[] }   unified list (harness + orchestra)
POST /api/v1/agents                                   body {scope, project_id?, name, ...} -> Agent  (orchestra agents only)
PATCH/DELETE /api/v1/agents/{id}                      (orchestra agents only; harness files keep using existing resource endpoints)
GET  /api/v1/skills?project_id=&harness=              -> { skills: Skill[] }
GET  /api/v1/mcp/servers/status                       -> { servers: McpServer[] }  (orchestra + harness-native, with status)
POST /api/v1/mcp/servers/{name}/probe                 -> McpServer
```
Chat message/session responses expose the applied receipt on the session:
`effective_agent_id`, `agent_observation` (existing fields) =
`applied | applied_partial:<what> | not_applied:<why>`.

### As implemented (backend, 2026-10-07) — deviations and details

- `GET /api/v1/agents` without query parameters still returns the legacy
  `{agents: string[]}` (registered provider names; used by HarnessSetupPanel,
  use-project-actions, orchestra-tools). The unified `Agent[]` list is returned
  when `project_id`, `harness` or `view=profiles` is present. Use
  `project_id=__orchestrator__` (or `view=profiles`) for the global-only list.
  Unambiguous alias: `GET/POST /api/v1/agent-profiles`,
  `PATCH/DELETE /api/v1/agent-profiles/{id}`.
- `{id}` in PATCH/DELETE is the URL-encoded Agent.id. Project agents need
  `project_id` (body or query; DELETE: query). Optional optimistic
  concurrency: `content_hash` (PATCH body / DELETE query) → 409 on mismatch.
  Agents cannot be renamed. Harness ids → 422.
- POST body: `{scope, project_id?, workspace_id?, name, description?, mode?,
  model?, effort?, color?, prompt?, skills?, mcp_servers?, permissions?}`;
  PATCH uses the same fields (absent = unchanged). Returns Agent.
- Agent.id format: `harness:<scope>:<lowercase harness>:<resource id>` and
  `orchestra:<scope>:orchestra:<name>`. Chat `agent_id` accepts these (scope and
  hash optional; a given hash must match) and legacy bare resource ids (scope
  + hash required). Agent-catalog items keep `id` = resource id; `agent_id`
  is now the stable Agent.id. Agent-catalog items do not include Orchestra
  agents (use /api/v1/agents).
- `/api/v1/skills` items: `harness` is the owning harness or `shared`
  (`~/.orchestra/skills`, `<project>/.orchestra/skills`).
- MCP: `GET /api/v1/mcp/servers/status` probes Orchestra servers (60s cache);
  harness-native servers (Claude, Codex, OpenCode, agy global configs) report
  cached status unless `?probe=all`. Env/header values are redacted (`***`).
  `POST /api/v1/mcp/servers/{name}/probe` probes an Orchestra server, or a
  harness-native one with `?harness=CLAUDE|CODEX|OPENCODE|ANTIGRAVITY`.
  `POST /api/v1/mcp/servers` accepts the full McpServer shape (`type, args,
  env, url, headers, enabled`) besides legacy `{name, command}`. Orchestra
  servers = `mcp_servers` table + `ORCHESTRA_MCP_SERVERS` (servers imported
  from Claude settings are not passed to runs).
- Chat Message gains `agent_id`, `agent_name`, `agent_color` (per-message
  provenance; assistant replies inherit their user message's agent). Agents
  are selected per message; on native Codex/agy an agent change starts a fresh
  provider thread seeded with the Orchestra transcript.
- Automations: `agent_id` (stable Agent.id only) on Automation, AutomationInput
  and Run.
- 8gent: all capabilities `supported:false`, note "deferred: see follow-up
  issue"; Orchestra agents list 8GENT as incompatible.
- Task dispatch: no agent on tasks yet (no issue metadata field); follow-up.
  Enabled Orchestra MCP servers are passed to local, non-plan task runs.

## Desktop UX (OpenCode-style, Orchestra styling)

- Composer: agent dropdown next to the harness/model picker (reuse/replace
  AgentPicker). Lists primary + all-mode agents compatible with the chosen
  harness; disabled entries show the reason. Tab / Shift+Tab cycles primary
  agents when the composer is focused and empty-selection-safe. Agent color
  dot on the picker and on assistant messages produced under that agent.
  Remember last model/effort per agent (localStorage per backend).
- `@` in the composer autocompletes subagents (inserts `@name`; harnesses
  that support subagent mentions receive it verbatim).
- Agents page (features/agents): sections Agents | Skills | MCP | Commands
  per harness plus an "Orchestra" (all harnesses) view. Agent editor
  (name, description, mode, color, model/effort, prompt, skills, MCP servers,
  permissions, compatible harnesses preview). "Create agent" flow.
  MCP panel shows status badges, probe/refresh, source label.
- Automations editor: Agent picker in the settings rail.
- Capability hints: a small "Applied on <harness> via <mechanism>" line in the
  agent picker tooltip.

## Cleanup

- Catalog: per-harness discovery only (stop mixing other harnesses' dirs into
  a harness's global list); parse TOML agents (Codex) for name/description;
  Claude `.claude/agents` are subagents (mode=subagent) unless frontmatter
  says otherwise; wire or delete dead probes.
- Remove the duplicate discovery system (`agents/config.go` AgentMeta +
  `/config/agents/items`) once the desktop no longer uses it; delete dead
  desktop panels superseded by AgentResourcesPanel.
- Gemini: remove as a selectable harness everywhere (catalog, registry
  defaults, Agents dashboard redirect, settings); keep read-only legacy chat
  history behavior.
