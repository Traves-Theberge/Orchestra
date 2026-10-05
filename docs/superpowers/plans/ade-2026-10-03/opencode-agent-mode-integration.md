# Chat composer agent selection and scoped agent definitions

Status: research and implementation plan only (2026-10-04). No implementation or provider configuration was changed for this package.

## Goal and product boundary

Add an agent selector beside the current workspace-chat harness/model controls. The selected harness owns the agent namespace and execution semantics. Users can discover, create, edit, and remove that harness's supported local/project or global definitions; selectable definitions appear in the composer for the matching harness. A selection is a request to the harness adapter, not a prompt-only label. It must be rejected or shown as unsupported if the installed adapter cannot apply it.

Keep these identities separate:

| Identity | Meaning | Owner |
| --- | --- | --- |
| Harness/provider | Codex, Claude Code, OpenCode, or another registered runner | `agents.Registry` and workspace chat session |
| Agent | Named harness profile/role such as `build`, `plan`, or `reviewer` | Harness-native definition plus selected agent ID |
| Model | Requested/provider-default model and any supported reasoning option | Existing model catalog and turn/session options |
| Runtime policy | Tools, approvals, sandbox, filesystem and shell permissions actually enforced by the provider | Harness-native runtime; separate observed/requested policy fields |
| Runtime/workspace | Local or supported remote execution target and project/worktree cwd | Existing workspace/task/runtime ownership |

Do not represent a subagent profile as a primary agent, a reviewer workflow as an active coding agent, or a model choice as an agent choice. Definitions that only describe a subagent must not become selectable as the conversation's primary agent unless that harness explicitly supports that role.

## Source review and reference receipt

### OpenCode

Inspected the OpenCode V2 agent documentation at [opencode.ai/v2/docs/agents](https://opencode.ai/v2/docs/agents) and [dev.opencode.ai/v2/docs/agents](https://dev.opencode.ai/v2/docs/agents), plus repository code pinned at `anomalyco/opencode` revision [`907b3bc518fa48e90e8ec24dd327d13eee71c36c`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c) (resolved from `refs/heads/dev` on 2026-10-04). The most relevant source files are [`packages/core/src/agent.ts`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/agent.ts), [`packages/core/src/config/agent.ts`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/config/agent.ts), and [`packages/app/src/components/prompt-input.tsx`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/app/src/components/prompt-input.tsx). The V2 core models agents as reusable profiles with `mode`, optional model, system prompt, ordered permissions, visibility and display metadata; its selector only exposes visible primary-capable entries. The legacy [agent docs](https://opencode.ai/docs/agents/) explicitly document primary-agent Tab cycling; the inspected composer provides a UI reference. V2 docs describe separate subagent invocation and global Markdown files at `~/.config/opencode/agents/<name>.md`, project files at `.opencode/agents/<name>.md`, nested IDs, and JSONC `agents` entries. The documented session model is stored separately from the primary agent; choosing an agent ID does not itself change the session model. `hidden` affects listing, not security. Permission rules are ordered with the last match winning.

Version caveat: the V2 docs and current development source are a distinct surface from OpenCode's legacy V1 config. The V2 docs include `default_agent` examples, while the dev-branch V2 config review at [`specs/v2/config.md`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/specs/v2/config.md) says not to carry forward that top-level field. Treat this as an unresolved version/spec mismatch. Do not write or translate `default_agent`, V1 `agent`/`permission`/`tools`, or V1 frontmatter fields until the actual installed OpenCode CLI/API version and schema are identified. The app's current composer code is useful as a selector example but is not, by itself, proof that every V2 service/API behavior is shipped. No OpenCode runtime was launched for this planning task.

### Required ADE references

The package registry is [`reference-patterns.md`](reference-patterns.md), with pinned Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` and T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`.

* **T3 Code, T4 `ChatComposer.tsx`** ([pinned source](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx)): the composer brings provider/model choice, runtime modes, prompt, attachments, context, and send state together. Its provider/model control chooses a concrete provider/model routing identity. No equivalent named-agent/harness profile contract was found in this assigned composer pattern. Adapt the cohesive composer state boundary; do not borrow T3 provider-account concepts as agent IDs.
* **Orca, O2 `agent-project-model-override.ts`** ([pinned source](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts), with cached source/test under `%TEMP%\orchestra-agents-scope-reference`): Orca checks project/worktree config roots because an account-level model listing does not establish the effective model inside a workspace. It deliberately treats a detected project config as “may override,” not proof of which model will run. No corresponding cross-harness agent catalog was found in this assigned pattern. Adapt its workspace-aware, non-authoritative discovery and provenance; keep agent discovery separate from model discovery.

Orchestra adaptation: retain the current provider/model picker and existing Kanban/task ownership; add a typed, workspace-scoped agent catalog and selected agent identity. Carry the requested identity through the existing native adapter boundary and report effective identity only when observed. No T3/Orca source is copied. Behavioral verification is defined below; reference behavior is not Orchestra E2E evidence.

## Orchestra baseline on 2026-10-04

Relevant implementation is [`HarnessPicker.tsx`](../../../../apps/desktop/src/features/workspace/chat/HarnessPicker.tsx), [`WorkspaceChat.tsx`](../../../../apps/desktop/src/features/workspace/chat/WorkspaceChat.tsx), `apps/backend/internal/workspacechat/{service.go,native.go,models.go,creation_options.go}`, `apps/backend/internal/agents/{types.go,registry.go,native_session.go,opencode_runner.go}`, and `apps/backend/internal/api/{workspace_chat.go,provider_domains.go,router.go}`.

* `WorkspaceChat` currently loads harnesses from `GET /api/v1/projects/{project_id}/chat/providers`, model catalogs only for native sessions, and creates sessions with provider/title/model/effort. `HarnessPicker` selects the harness and next-turn model; there is no agent catalog, selection state, agent ID in a session or send request, or Tab cycling. Harness changes from an existing conversation prepare a new unsent conversation; selection does not rebind the old provider thread.
* `workspacechat.Service.Providers` presents CODEX, CLAUDE, OPENCODE and all additional registered runners. Enablement means configured runner plus local turn validation. The current registry's `SupportsNativeSession` and `SupportsNativeTools` are Codex-only. Codex chat has a structured persistent native session; Claude, OpenCode, and other runners use transcript replay. Orchestrator scope additionally requires native Orchestra control tools. This is the current code contract, not a claim about harnesses' underlying capabilities.
* OpenCode's runner is a `CommandRunner` wrapper. Orchestra has OpenCode agent-config GET/POST/DELETE routes and an Agents settings panel, but these currently manage files rather than bind an agent to chat. OpenCode agent file listing reads only direct children of global/project `agents` directories; its create/update APIs write Markdown files. OpenCode V2 nested paths/IDs and merged effective catalogs are not implemented here.
* `agents.ListAgentConfigs(workspaceRoot, projectRoot)` performs broader classified discovery of Orchestra/provider config, instruction, skill and subagent resources. This is a settings/resource inventory, not a normalized named-agent catalog. Do not promote every returned `AgentConfig`—especially `AGENTS.md`, instructions, skills, hooks or rules—to a selectable primary agent. `UpdateGlobalAgentConfig` is also a separate legacy resource writer, not consent to create a named provider profile from catalog discovery.
* Claude and Codex have provider-specific subagent configuration surfaces. Their existence does not prove those entries can be selected as the primary workspace-chat agent. There is no shared harness-agent contract; the native session turn options currently include model and reasoning effort only. Additional registry runners advertise no agent selection capability.
* Workspace chat already has a project scope, optional workspace ID/path, immutable session provider, durable messages/events, model request intent and effective-model observations. A separate orchestrator scope exists. Task/worktree assignment remains an explicit C1/C2 integration concern; do not infer task identity from project ID or cwd.

## Capability inventory and delivery rule

The initial implementation must publish a backend catalog with truthful per-provider states. Avoid “agent support” as one boolean: management/read, creation/edit, primary selection, subagent invocation, native model override, native permissions, and session continuity are separate capabilities.

| Current harness path | Observed Orchestra behavior | First-release agent-selector state |
| --- | --- | --- |
| Codex native chat | Structured session and model/effort options; Codex definitions can be managed in settings; selected agent is absent from `NativeTurnOptions` | Catalog may expose discovered profiles as `configured_unapplied`; disable primary selection until app-server accepts an agent/mode and a canary proves the effect. Do not assume Codex “subagents” can be promoted to primary. |
| OpenCode CLI chat | CLI runner with transcript replay; OpenCode Markdown settings CRUD; no selected-agent argument in workspace chat | Can manage and validate native definitions. Keep the picker row unavailable for execution until the actual deployed OpenCode version's CLI/API accepts the requested agent and Orchestra can prove it. Do not inject just its prompt text as equivalent. |
| Claude Code chat | Runner with transcript replay; Claude subagent CRUD exists; no selected-agent field in chat request | Treat definitions as `configured_unapplied` pending discovery of the installed CLI's supported agent selector, role support and effective policy evidence. |
| Other registered runners (including legacy Gemini/8GENT when configured; Antigravity must be evaluated independently) | Generic registry/local turn path; current chat uses transcript replay unless adapter adds the native session interface | Catalog says `unsupported` until a harness adapter supplies and verifies capabilities. A visible provider row does not imply a selectable agent. |
| Orchestrator conversation | Requires native control-tool capability, currently Codex-only in registry | Keep orchestrator controls and its conversation identity distinct from user-created profiles. Selection cannot widen orchestration tools or run/task scope. |

Implementation gate: the first enabled agent selection must be an end-to-end vertical slice for one harness (prefer Codex only if an app-server agent/mode operation is confirmed; otherwise OpenCode only if its installed CLI/API can select an agent). If no adapter can prove application, deliver definition management and unavailable catalog states, not a cosmetic “working” picker.

## Proposed contracts and resolution rules

### Typed identity

Add `AgentSelection` to workspace-chat create/send requests:

```json
{
  "harness": "CODEX",
  "agent_id": "reviewer",
  "definition_scope": "project",
  "definition_version": "sha256:..."
}
```

Persist the canonical harness and agent ID per conversation/turn, scope/provenance, catalog revision or content hash, and requested/effective/unknown status. Keep old rows as “provider default / agent unknown”; never migrate them to an invented `build` ID. Switching selection changes future turns only. Changing a definition after selection must surface `changed since selection`; either freeze the validated definition/version for the next request or require refresh and explicit reselection. Missing definitions must not silently fall back to provider default.

Add optional methods rather than widening every runner's apparent capability:

```go
type AgentCatalogProvider interface {
  ListAgents(ctx context.Context, scope AgentScope, workspace AgentWorkspace) (AgentCatalog, error)
}
type AgentSelectionValidator interface {
  ValidateAgent(ctx context.Context, request TurnRequest, selection AgentSelection) (AgentCapability, error)
}
type NativeAgentSelector interface {
  SelectAgent(selection AgentSelection) error // only if provider protocol has a session-level operation
}
```

Names are illustrative; final Go API should reuse `agents.Provider`, current project/workspace resolution and existing adapter patterns. Catalog contract needs `observation` (`observed`, `stale`, `unavailable`, `unsupported`), `scope`, `agent_id`, `display_name`, `description`, native mode/role if known, `selectable_as_primary`, `invokable_as_subagent`, `hidden`, `model_preference`, capability flags, source path/hash, and a user-readable reason. Do not echo prompt bodies or credentials in list responses. Add protocol schema(s) under `packages/protocol/schemas/v1` only if these response/request shapes cross the public API.

Validation must occur before persisting accepted send intent or causing provider/workspace effects. Provider adapter revalidates at dispatch. Adapter reply should say `requested agent`, `effective agent`, and observed source separately. Provider default is an explicit empty selection. Preserve uncertain dispatch receipts; never retry an unobserved send automatically.

### Scope, precedence, and file durability

Use `global` and `project` as explicit user scopes, with project meaning the effective selected checkout root for all workspace chats, including child worktrees with no task. A task-linked conversation resolves the same explicit bound checkout; never fall back to the registered main checkout for a child chat. Show the resolved directory before create/save. For OpenCode, initial supported paths are global `~/.config/opencode/agents/` and project `.opencode/agents/`; follow ancestor/nested discovery and ID mapping only after proving the installed version's behavior. Existing Orchestra file endpoints silently skip read failures in listing and are non-recursive, so a new chat catalog should distinguish permission/parse/read errors from authoritative empty, preserve unknown files, write atomically, validate path containment/symlinks, and retain extension/content. On conflict, show which file wins and never overwrite both scopes.

Provider-native merge order is adapter-defined and must match that harness version. Where upstream semantics are unverified, show separately sourced entries with collision/override status instead of making an Orchestra precedence claim. Editing a native file is a user-visible disk mutation: autosave is inappropriate; validate the file, write temp+rename, preserve backups/version evidence on update, and report the exact path. Creating at project scope may change tracked project files; the UI should state that path and scope before save. Global changes apply to future projects and are persisted outside the repo.

Do not copy definitions to worktrees or rewrite global provider config to make one chat selection work. The chat must resolve the definition at the effective harness cwd, then record its source/version. If a task uses a worktree, tests must prove the chosen project profile resolves there (including linked worktree roots) and does not leak into a sibling task. Keep secrets out of profile snapshots and API responses.

### Agent, model, and permission semantics

The composer shows agent and model independently. A profile's model is a native preference; it may seed a model only where the adapter supports it and only under a declared rule. OpenCode V2 docs say session model is stored separately and selecting an agent doesn't change it; when upstream docs and source conflict, use the installed version's actual contract. Preserve the existing selected session model unless the user explicitly accepts the resolved agent model. Show inherited/default/requested/effective provenance; model catalog presence is not entitlement or execution proof.

Agent `mode`/role governs placement (primary versus subagent) only when the harness defines it. A `hidden`/disabled field governs discoverability only and is not a permission boundary. Permissions, approvals, sandboxing, tool allow/deny rules, and runtime target stay provider-native and distinct from descriptive agent prompts. An adapter without native enforcement must reject permission-bearing definitions for a selected run or label support as unknown; never claim that trimming Orchestra tool specs constrains a provider's own shell/edit tools. A profile prompt is provider instruction input, not a replacement for the provider's system prompt unless that adapter's protocol explicitly says so.

## Executable implementation phases

### Phase 0 — adapter/version inventory and acceptance decision

1. Record supported installed versions and executable discovery for each currently selectable harness on the supported OSes. Inspect the current Codex app-server protocol, OpenCode CLI/API and config format, and Claude and Antigravity installed protocol documentation (do not substitute the legacy Gemini CLI). Verify: list effective agent catalog, select primary agent at conversation creation and later turn, select subagent only if supported, model interaction, instruction loading, policy enforcement, interrupt/resume and remote target. Classify each as `verified`, `unsupported`, or `unknown`; do not infer from provider settings schemas.
2. Run a minimal isolated canary for each candidate before enabling it: choose a custom named agent with an observable harmless instruction, send a turn, inspect native protocol/session metadata and output; separately verify denied tool behavior for any policy claim. Capture version, exact request/CLI, effective agent/model, logs with secrets redacted and canary result. Choose one vertical-slice harness or keep all rows unavailable.
3. Add a reference receipt update here with exact source files/revisions, deliberate deviations, and what no reference implements. This task is planning; phase 0 has not been run against providers.

### Phase 1 — catalog and safe definition management

1. Add `internal/agents/agent_catalog.go` (or focused provider packages) with provider-specific discovery/validation and truthful status. Add API handlers in `internal/api/agent_catalog.go` and routes such as `GET /api/v1/projects/{project_id}/chat/agents?harness=OPENCODE&scope=effective`, `GET .../chat/agents/{agent_id}`, `PUT .../chat/agents/{agent_id}?scope=project`, and `DELETE ...` with explicit scope. Keep existing `/api/v1/agents/{provider}/...` settings API compatibility; factor shared safe file service instead of duplicating ad hoc root handling.
2. Implement list/read/create/update/delete first for one file-backed provider (OpenCode is the natural initial definition-management candidate), including global/project scope and nested IDs only when installed version support is verified. Reuse the existing settings inventory/parser where its resource classification is correct, but return a dedicated typed profile list rather than treating `ListAgentConfigs` as that contract. Discovery is read-only. Global creation requires an explicit user action with a visible global path; project creation requires a visible project/worktree path. Add matching provider-specific parsers/serializers and unknown-field preservation; do not make a cross-provider “universal YAML” format that overwrites native semantics.
3. Return `unavailable` on permission, parse, missing-root, or stale-read errors rather than an empty success. Keep `unsupported` distinct from “zero definitions.” Detect duplicate IDs across global/project/config-file sources and display the actual winner according to proven provider ordering. Use expected `content_hash` on writes for conflict detection; writes must be atomic, path-contained, and scoped. Reject invalid names, path traversal, symlink escape, empty/invalid document, oversized prompt, malformed frontmatter, and stale update hashes.
4. Add Go tests for root and nested discovery, linked worktree and project root binding, scope, native merge/collision order, malformed files, duplicate IDs, failed reads, permission errors, path traversal/symlink escape, stale hashes, atomic create/update/delete, restart durability and safe omission/redaction of sensitive values.

### Phase 2 — request identity and first proven adapter

1. Add optional requested agent fields to `workspacechat.CreateRequest`, `SendRequest`, durable SQL migration and `agents.TurnRequest`/native options. Store request and effective observation in separate columns/JSON, keyed per message/turn. Maintain backwards compatibility for provider-default sessions.
2. Add preflight catalog validation and dispatch validation. Require matching project/worktree + harness + agent ID + supported role + definition version. Invalid/stale/unsupported selections fail before message acceptance. Persist accepted intent before provider call; keep existing `accepted/unknown` and backend restart delivery semantics.
3. Implement only the proven selected-agent operation in its native adapter. The first end-to-end test must assert exact agent ID reached the real protocol/CLI and returned effective identity where the provider exposes it. Transcript replay cannot claim agent mode unless the harness has a documented request-level selection parameter. If a profile only supplies a prompt and user explicitly opts to “use as instructions” in a later feature, label that as a different capability.
4. Keep model semantics independent. Test agent preference with no model override, a selected chat model, stale model, provider default, and a per-turn model if supported. Reject or clearly resolve conflicts according to the adapter's documented rules; do not change existing session model implicitly.

### Phase 3 — workspace chat composer

1. Add a separate `AgentPicker` under `apps/desktop/src/features/workspace/chat/` and types/client methods under `apps/desktop/src/core/api/`. Keep `HarnessPicker` focused on harness/model, with selected harness passed to AgentPicker. Request catalog on harness/workspace/scope change and refresh after save/delete. Catalog state must distinguish loading, known empty, stale, unavailable, unsupported, configured-unapplied and selectable. Disabled rows include a concise reason.
2. Add a compact composer control with current agent, role, scope/source and model preference summary. A keyboard shortcut inspired by OpenCode Tab cycling may cycle only enabled primary-capable agents for the currently selected harness; in the multiline composer, do not steal Tab from text indentation or focus navigation. Use a configurable shortcut or `Alt+ArrowUp/Down` only if no existing shortcut conflicts; also provide a regular button and searchable menu. If Tab is chosen, scope it to composer focus, no popup/modal, no IME composition, and verify it cannot intercept accessibility navigation. Add `aria-label`, `aria-haspopup`, `aria-expanded`, `aria-pressed`/selected state, role descriptions, focus return, Escape-close, arrow-key menu navigation and screen-reader announcement of harness/agent/model/source.
3. Keep subagent profiles in a separate submenu/catalog section and only expose invocation when the adapter supports it; do not make selecting one change the primary agent. Preserve current behavior that harness selection doesn't send/create, keep drafts, and lock switching while an active or unsettled request owns the conversation. Agent switching applies to future turns and must not mutate history/session binding retroactively.
4. Add component tests for keyboard and screen-reader state, async catalog transitions (including stale/failed vs empty), scope/source badges, locked state, draft/focus retention, harness change, deleted/changed definition, and agent model conflict. Add an API-to-renderer fixture test proving persisted choice reloads correctly.

### Phase 4 — task, worktree, review, and orchestration integration

1. Bind catalog resolution to the explicit conversation scope. For a task chat, persist task/worktree identity through existing C1/C2 contracts; resolve project definitions against that worktree's effective harness cwd. For orchestrator chats, retain `__orchestrator__` root/authorization and separately gate control-tool support. Never infer or widen run ownership from an agent ID.
2. Freeze selected definition ID, content/version hash, harness version, requested model and reported policy provenance on each admitted turn. A retry reuses the same identity only if still valid; otherwise require user choice. Global/project edits apply to future turns and must not rewrite active or prior turn records.
3. Keep PR review role/profile separate from review task state, reviewer assignment and task acceptance. The agent definition may provide a specialized reviewer role only if supported by the current harness; authoritative PR/task status continues to come from Kanban/task records. Link chat/activity to task and worktree using shared durable IDs and observe the same run from chat/board/CLI rather than creating agent-private task state.
4. Tests: simultaneous tasks using conflicting agent definitions remain isolated; project profile only affects its intended project/worktree; global profile is available across projects; changed global config does not mutate an active turn; orchestrator control tools remain gated; a reviewer conversation does not mark a PR/task approved; app restart and reconnect retain selected/requested/effective identity and uncertain sends.

## E2E gates and acceptance criteria

Do not mark a harness enabled in the composer until all required criteria pass for that exact version and runtime mode:

1. Global and project definitions are discovered separately, scoped correctly, and create/edit/delete survive reload/restart. Effective merge and collision behavior matches the provider or is clearly unresolved and blocks selection.
2. Choosing an enabled profile does not submit a message, change harness, silently change model, reset draft, or rebind an existing provider thread. A future turn uses the selected ID exactly once; session history identifies requested and observed agent separately.
3. A canary visibly distinguishes the selected profile from provider default. Model identity is independently checked. Any native permissions claim includes an actual allowed and denied tool request through that provider; metadata or UI display alone is insufficient.
4. Unsupported, malformed, deleted, stale, unavailable-catalog, session-restart, timeout, uncertain-delivery, and adapter-version-changed cases preserve the draft and surface an actionable status. No silent fallback and no duplicate delivery.
5. Task/worktree and orchestrator scopes are isolated across at least two simultaneous sessions. Global changes do not mutate frozen active-turn configuration. Kanban state remains authoritative and shared.
6. Verify UI with a live supported application in addition to API/fixture tests. Fixture, unit, model-catalog, configured executable, and provider canary results are reported as different evidence classes. Do not claim real provider support from reference app behavior or unit tests.

## Risks and open questions

* Which installed OpenCode version is the target: current V1 CLI, evolving V2, or both? Does it expose a stable headless primary-agent selection surface and queryable effective agent identity? V2 docs/source have a `default_agent` mismatch requiring resolution.
* Can Codex app-server select a primary profile per persistent thread/turn, and are Codex subagent definitions primary-capable? Existing config UI does not answer this.
* Does the existing Agent settings scope resolver target the intended project/worktree owner, and should nested OpenCode paths and JSONC `agents` maps be editable in the first slice? Current agent file list is non-recursive and read failures appear as missing files.
* What is the intended precedence when a native config `agents` map and Markdown definition share an ID, and when ancestor `.opencode` directories contribute definitions? Let provider version decide; do not guess.
* Can other harnesses safely discover/select primary agents, and can their tools/policies be observed? Until individually proven, the catalog remains unsupported or configured-unapplied.
* Where should global definitions be authored when the backend service account's home differs from the desktop user's home or when chat executes remotely? Global ownership must follow the actual harness runtime host, not whichever process can write a path.
* Existing conversations use immutable provider and have no agent field. Migration defaults must preserve provider-default semantics; no inferred historical agent identity.

## Handoff

This document is a plan only. No Go/desktop/API/schema/provider configuration was edited and no tests or provider canaries were run for this feature. Before implementation, resolve phase 0, append its source/version evidence and reference behavioral verification, then implement one vertical slice and update the ADE reference receipt. Keep every unproven harness visibly unavailable.
