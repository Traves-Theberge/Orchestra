# Task Authoring Studio — Design

**Date:** 2026-05-10
**Status:** Spec, pending implementation plan

## Summary

A new top-level section in the Orchestra desktop app for authoring backlog tasks through conversation with a CLI coding agent (Claude Code, Codex, OpenCode, or Gemini). The agent helps shape the task by exploring the repo, asking questions, and progressively filling a structured task draft that the user can edit directly. On confirmation, the draft is pushed to the backlog and picked up by the normal orchestrator dispatch loop.

The studio reuses Orchestra's existing CLI-agent runners, MCP server infrastructure, worktree lifecycle, SSE pubsub, and tracker `CreateIssue` path. The genuinely new surface is one MCP server, one backend package, a small set of HTTP/SSE routes, and a frontend feature module.

## Goals

- Turn rough intent into well-formed backlog tasks (title, description, acceptance criteria, attachments, suggested provider, agent guidance) via a chat that has filesystem access to the repo.
- Use Orchestra's existing CLI providers as the authoring substrate — no parallel LLM API integration.
- Output tasks that flow into the existing backlog and dispatch loop unchanged.

## Non-goals

- Workflow chaining / task DAGs.
- Side-by-side multi-provider comparison.
- Dispatch-time provider routing changes.
- Editing the agent's reasoning quality (that's a property of the chosen CLI, not the studio).

## User experience

### Placement

A new top-level sidebar entry, `Studio`, alongside Kanban, Issues, Agents. Route key `studio`. Implemented as a lazy-loaded feature module (`React.lazy`), consistent with the performance work already done in `App.tsx`.

### Layout

Two-pane: chat thread on the left (~60%), live task draft panel on the right (~40%).

- **Chat (left)** — reuses `components/embedded-agent/` rendering for messages, code blocks, tool calls, and attachment chips. The composer has a runner picker (Claude Code / Codex / OpenCode / Gemini), a message input, and a send button. Voice input via Whisper is inherited from the embedded agent.
- **Draft panel (right)** — directly-editable fields:
  - Basics (title, description in markdown, labels, priority)
  - Acceptance criteria (ordered checklist)
  - Attachments (files/paths, links)
  - Suggested execution provider (separate from the authoring runner)
  - Agent guidance (model, max turns, tool restrictions)
  - Source template (read-only chip when a template was applied)
  - Primary action: `→ Push to backlog`

The user can edit any field at any time. Agent tool calls and user edits feed the same draft row server-side — there is no client-side reconciliation logic.

### Templates

Templates are markdown files under `.orchestra/studio/templates/*.md` with YAML front-matter:

```yaml
---
name: add-tests
description: Add unit tests to a target file
variables:
  - file: required, path to file under test
  - framework: optional, defaults to project's test framework
suggested_provider: claude-code
suggested_max_turns: 8
---
Add unit tests to `{{file}}` covering all exported functions.
Use {{framework | default("the framework already used in this repo")}}.
Acceptance: tests pass with `go test ./...` (or repo equivalent).
```

Selecting a template at the top of the chat (a) prefills the draft fields from the front-matter, (b) injects the rendered body as the first user message, and (c) hands control to the agent. Templates can also be applied mid-conversation via the `apply_template` MCP tool.

A `Manage templates` modal browses, edits, and creates templates. Backed by a small CRUD API over the template files.

### Session outcome

`push_to_backlog` validates (title + description required), calls the existing tracker `CreateIssue`, persists the extra fields, tears down the studio's scratch worktree, and resets the studio for a new task. A toast with a "View on board" link confirms.

Discard is also supported (sidebar / keyboard) — drops the draft and the scratch worktree.

## Architecture

### Authoring substrate: CLI agents over MCP

The chat surface is a CLI coding agent (the same runners Orchestra dispatches to today), running in a new run mode called `studio`. Distinct from `execute`:

- Uses a read-only scratch worktree of the project (the agent can explore — read files, grep, list — but not modify the working tree).
- An additional MCP server, `orchestra-studio`, is attached at spawn time. The agent calls its tools to mutate the task draft.
- The only "writes" performed during a studio session are MCP tool calls and the eventual `push_to_backlog`.

All four supported runners (Claude Code, Codex, OpenCode, Gemini) speak MCP, so this approach is uniform across providers. Each runner's existing adapter in `internal/agents/` is extended to accept the studio mode + extra MCP server, but no new transport is added.

### The `orchestra-studio` MCP server

A new in-process MCP server under `internal/mcp/studio/`, registered for the lifetime of a studio session and exposing:

- `set_title(text)`
- `set_description(markdown)`
- `add_acceptance_criterion(text)`, `remove_acceptance_criterion(id)`
- `attach_file(path)` — records the path and a content snapshot at authoring time
- `attach_link(url, label?)`
- `set_provider(name)` — suggested execution provider
- `set_model(name)`, `set_max_turns(n)`
- `apply_template(name, vars)`
- `push_to_backlog()` — terminal; validates, materializes via tracker, ends the session

Each tool mutates the active `issue_drafts` row and emits an event on the existing PubSub bus. The desktop subscribes via SSE.

### Backend packages

- `internal/studio/` — session manager. Starts a session (spawns the chosen CLI runner with the `orchestra-studio` MCP server attached, in a read-only scratch worktree), brokers messages, handles draft mutations, validates and executes push. Composes existing primitives (runner registry, worktree, MCP lifecycle, pubsub, tracker).
- `internal/mcp/studio/` — the MCP server itself. JSON-RPC tool implementations operating on `issue_drafts`.

### HTTP / SSE surface

Under `/api/studio` (Chi router, existing middleware applies):

- `POST /studio/sessions` — body `{ project_id, runner, template?, template_vars? }`. Returns `{ session_id, sse_url }`.
- `GET /studio/sessions/:id/events` (SSE) — chat tokens, tool calls, draft snapshots, status changes.
- `POST /studio/sessions/:id/message` — user message to the agent.
- `POST /studio/sessions/:id/draft` — manual field edits from the UI (bypasses the agent; same effect as a tool call).
- `POST /studio/sessions/:id/push` — manual push (equivalent to the agent calling `push_to_backlog`).
- `DELETE /studio/sessions/:id` — discard.
- `GET /studio/templates`, `POST /studio/templates`, `PUT /studio/templates/:name`, `DELETE /studio/templates/:name` — CRUD over `.orchestra/studio/templates/`.

### Data model

New tables (added via `migrateColumn()` / new-table migrations in `internal/db/`):

- `issue_drafts` — one row per active studio session:
  - `id`, `session_id`, `title`, `description`, `acceptance_criteria` (JSON array), `attachments` (JSON), `suggested_provider`, `suggested_model`, `max_turns`, `template_name`, `template_vars` (JSON), `agent_guidance` (JSON), `created_at`, `updated_at`.
  - Deleted on `push` or `discard`.
- `studio_sessions` — `id`, `project_id`, `runner`, `started_at`, `ended_at`, `outcome` (`pushed` | `discarded`).

Columns added to existing `issues` table:

- `acceptance_criteria` (JSON), `attachments` (JSON), `agent_guidance` (JSON), `source_template` (text), `authoring_session_id` (text).

### Reuse vs. new

| Concern | Reuses | New |
|---|---|---|
| CLI runner spawning | `internal/agents/` | runner adapters extended for `studio` mode |
| Worktree | `internal/workspace/` | read-only scratch worktree variant |
| MCP transport | `internal/mcp/` | `internal/mcp/studio/` server |
| Event stream | PubSub + SSE in `internal/observability/`, `internal/api/` | studio routes |
| Tracker write | tracker `CreateIssue` | extended payload fields |
| Chat UI | `components/embedded-agent/` | studio feature module wraps it |
| State sync | SSE → store | `useStudioSession`, `useDraft` |

## Frontend module

```
apps/desktop/src/features/studio/
├── StudioSection.tsx
├── chat/
│   ├── StudioChat.tsx
│   ├── ChatComposer.tsx
│   └── useStudioSession.ts
├── draft/
│   ├── DraftPanel.tsx
│   ├── fields/
│   │   ├── BasicsFields.tsx
│   │   ├── AcceptanceCriteria.tsx
│   │   ├── Attachments.tsx
│   │   ├── ProviderPicker.tsx
│   │   ├── AgentGuidance.tsx
│   │   └── TemplatePicker.tsx
│   └── useDraft.ts
├── templates/
│   ├── TemplateLibrary.tsx
│   └── useTemplates.ts
└── api/studio-client.ts
```

State model: the draft is server-owned; the frontend keeps a mirror via SSE. Field edits go through `POST /draft` and echo back. No client-side reconciliation.

Lazy-loaded into `App.tsx`'s section router.

## Testing

**Backend:**

- `internal/studio/` unit tests: session lifecycle, draft mutations, push validation, idempotent push.
- `internal/mcp/studio/` unit tests: each tool happy path and error case (unknown template, malformed path, push without title).
- API integration tests under `internal/api/`: full flow create → message → tool-call → push → issue exists in tracker. Memory tracker + an in-test fake runner; no real CLI shell-out.
- `go test -race ./internal/studio/...` to cover concurrent draft writes from the agent and manual UI edits.

**Frontend:**

- Vitest for `useDraft` (server echo overrides optimistic, edits collapse correctly).
- Vitest for `useStudioSession` SSE handling (message append, tool-call → draft update, error states).
- Component tests for `DraftPanel` field editing and `TemplatePicker`.
- Smoke: a happy-path test that boots the backend, opens the studio section, runs a fake authoring session, and asserts a new issue appears in the backlog.

**Explicitly not tested:** the CLI agents' reasoning quality.

## Open questions deferred to implementation

- Whether `attachments` and `agent_guidance` should be a JSON column on `issues` or a separate normalized table — decision deferred until we inspect the existing `issues` schema and migration history.
- Exact SSE event taxonomy for tool-call rendering parity with the embedded-agent's existing event shapes.
- Whether the read-only scratch worktree should be the existing checkout in a read-only overlay or a fresh shallow clone — depends on runner behavior under read-only filesystems.
