# Orchestra API Reference

Orchestra is a multi-agent orchestration platform. The backend daemon (`orchestrad`)
exposes a REST + SSE + WebSocket API at `http://127.0.0.1:3284` by default.

- **Auth:** `Authorization: Bearer <token>` when `ORCHESTRA_API_TOKEN` is set.
  Loopback connections (`127.0.0.1`, `::1`) skip auth.
- **Rate limits:** 20 req/s sustained, 60 burst. OAuth endpoints: 5 req/s, 10 burst.
- **Errors:** All errors use the envelope `{"error":{"code":"...","message":"..."}}`.
- **Content-Type:** POST bodies must be `application/json` (or omit the header for empty bodies).

---

## Endpoint Groups

### Health

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/healthz` | No | Daemon health check |
| GET | `/api/v1/healthz` | No | Daemon health check (versioned) |
| GET | `/api/v1/openapi.yaml` | No | OpenAPI spec |
| GET | `/api/v1/telemetry/health` | Yes | Warehouse DB health |

### State

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/state` | Yes | Full orchestrator snapshot |
| POST | `/api/v1/refresh` | Yes | Queue tracker sync cycle |

### Issues

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/issues` | Yes | List issues | `states`, `project_id`, `limit`, `offset` |
| POST | `/api/v1/issues` | Yes | Create issue | body: `title` (required) |
| GET | `/api/v1/issues/{id}` | Yes | Get issue detail | — |
| PATCH | `/api/v1/issues/{id}` | Yes | Update issue | body: partial update |
| DELETE | `/api/v1/issues/{id}` | Yes | Delete issue | — |
| GET | `/api/v1/issues/{id}/history` | Yes | Run/event history | — |
| GET | `/api/v1/issues/{id}/logs` | Yes | Agent session log | — |
| GET | `/api/v1/issues/{id}/diff` | Yes | Git diff | `provider` |
| GET | `/api/v1/issues/{id}/artifacts` | Yes | List artifacts | `provider` |
| GET | `/api/v1/issues/{id}/artifacts/*` | Yes | Get artifact content | `provider` |
| DELETE | `/api/v1/issues/{id}/session` | Yes | Stop session, reset to Todo | `provider` |
| POST | `/api/v1/issues/{id}/stop` | Yes | Stop + reset to Backlog | — |
| POST | `/api/v1/issues/{id}/pr` | Yes | Create GitHub PR | body: `title`, `head`, `base` |
| GET | `/api/v1/search` | Yes | Full-text search | `q` (required) |

### Sessions

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/sessions` | Yes | List sessions | `project_id`, `limit`, `offset` |
| GET | `/api/v1/sessions/{session_id}` | Yes | Session + events | — |

### Events (SSE)

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/events` | Yes | SSE event stream |

### Projects

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/projects` | Yes | List projects | — |
| POST | `/api/v1/projects` | Yes | Register project | body: `root_path` |
| GET | `/api/v1/projects/{id}` | Yes | Project stats | — |
| DELETE | `/api/v1/projects/{id}` | Yes | Delete project | — |
| POST | `/api/v1/projects/{id}/refresh` | Yes | Re-scan git remote | — |
| PATCH | `/api/v1/projects/{id}/issue-source` | Yes | Set issue source | — |
| POST | `/api/v1/projects/{id}/issue-source/test` | Yes | Test issue source | — |
| GET | `/api/v1/projects/{id}/tracker/issues` | Yes | Browse tracker issues | `states` |
| GET | `/api/v1/projects/{id}/file` | Yes | Read project file | `path` |
| GET | `/api/v1/projects/{id}/tree` | Yes | Project file tree | `path` |
| POST | `/api/v1/projects/{id}/tracker` | Yes | Assign tracker config | body: `config_id` |

### Git Operations

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/projects/{id}/git` | Yes | Commit history | `branch` |
| GET | `/api/v1/projects/{id}/git/status` | Yes | Working tree status | — |
| GET | `/api/v1/projects/{id}/git/diff` | Yes | Diff | `hash`, `file`, `staged` |
| POST | `/api/v1/projects/{id}/git/commit` | Yes | Create commit | body: `message` |
| POST | `/api/v1/projects/{id}/git/push` | Yes | Push | body: `remote`, `branch` |
| POST | `/api/v1/projects/{id}/git/pull` | Yes | Pull | body: `remote`, `branch` |
| POST | `/api/v1/projects/{id}/git/fetch` | Yes | Fetch | — |
| GET | `/api/v1/projects/{id}/git/branches` | Yes | List branches | — |
| POST | `/api/v1/projects/{id}/git/branches` | Yes | Create branch | body: `name` |
| GET | `/api/v1/projects/{id}/git/branches/detail` | Yes | Branches + metadata | — |
| DELETE | `/api/v1/projects/{id}/git/branches/{branch}` | Yes | Delete branch | — |
| POST | `/api/v1/projects/{id}/git/checkout` | Yes | Checkout branch | body: `branch` |
| GET | `/api/v1/projects/{id}/git/default-branch` | Yes | Default branch name | — |
| POST | `/api/v1/projects/{id}/git/stage` | Yes | Stage files | body: `files` |
| POST | `/api/v1/projects/{id}/git/unstage` | Yes | Unstage files | body: `files` |
| POST | `/api/v1/projects/{id}/git/stash` | Yes | Stash changes | body: `message` |
| GET | `/api/v1/projects/{id}/git/stash/list` | Yes | List stashes | — |
| POST | `/api/v1/projects/{id}/git/stash/pop` | Yes | Pop stash | — |
| POST | `/api/v1/projects/{id}/git/stash/apply` | Yes | Apply stash | body: `index` |
| POST | `/api/v1/projects/{id}/git/stash/drop` | Yes | Drop stash | body: `index` |
| GET | `/api/v1/projects/{id}/git/conflicts` | Yes | List conflicts | — |
| POST | `/api/v1/projects/{id}/git/merge` | Yes | Merge branch | body: `branch` |
| POST | `/api/v1/projects/{id}/git/merge/abort` | Yes | Abort merge | — |
| POST | `/api/v1/projects/{id}/git/resolve` | Yes | Resolve conflict | body: `path` |

### GitHub Integration

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/projects/{id}/github/issues` | Yes | List GitHub issues | `state`, `page` |
| POST | `/api/v1/projects/{id}/github/issues` | Yes | Create GitHub issue | body: `title`, `body` |
| PATCH | `/api/v1/projects/{id}/github/issues/{number}` | Yes | Update GitHub issue | — |
| GET | `/api/v1/projects/{id}/github/pulls` | Yes | List pull requests | — |
| POST | `/api/v1/projects/{id}/github/pulls` | Yes | Create pull request | body: `title`, `head`, `base` |
| GET | `/api/v1/projects/{id}/github/pulls/{n}/diff` | Yes | PR diff | — |
| GET | `/api/v1/projects/{id}/github/pulls/{n}/reviews` | Yes | PR reviews | — |
| POST | `/api/v1/projects/{id}/github/pulls/{n}/reviews` | Yes | Submit review | body: `body`, `event` |
| GET | `/api/v1/projects/{id}/github/pulls/{n}/comments` | Yes | PR comments | — |
| PUT | `/api/v1/projects/{id}/github/pulls/{n}/merge` | Yes | Merge PR | body: `merge_method` |
| POST | `/api/v1/projects/{id}/github/disconnect` | Yes | Remove GitHub link | — |
| POST | `/api/v1/projects/{id}/github/create-repo` | Yes | Create GitHub repo | body: `name`, `private` |
| GET | `/api/v1/github/login` | No | OAuth login redirect | — |
| GET | `/api/v1/github/callback` | No | OAuth callback | `code`, `state` |

### Tracker Configs

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/tracker/configs` | Yes | List tracker configs |
| POST | `/api/v1/tracker/configs` | Yes | Create tracker config |
| PATCH | `/api/v1/tracker/configs/{config_id}` | Yes | Update tracker config |
| DELETE | `/api/v1/tracker/configs/{config_id}` | Yes | Delete tracker config |
| POST | `/api/v1/tracker/configs/{config_id}/test` | Yes | Test connection |
| GET | `/api/v1/tracker/configs/{config_id}/projects` | Yes | List tracker projects |
| GET | `/api/v1/tracker/configs/{config_id}/states` | Yes | List tracker states |
| GET | `/api/v1/tracker/configs/{config_id}/issues` | Yes | Browse tracker issues |

### Workspace File Ops

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/workspace/file` | Yes | Read file | `path` |
| PUT | `/api/v1/workspace/file` | Yes | Write file | `path` |
| GET | `/api/v1/workspace/tree` | Yes | List directory | `path` |
| POST | `/api/v1/workspace/dir` | Yes | Create directory | `path` |
| POST | `/api/v1/workspace/rename` | Yes | Rename/move | body: `from`, `to` |
| DELETE | `/api/v1/workspace/path` | Yes | Delete path | `path` |
| GET | `/api/v1/workspace/migration/plan` | Yes | Migration plan | — |
| POST | `/api/v1/workspace/migrate` | Yes | Run migration | — |

### Agents

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/agents` | Yes | List agent providers |
| GET | `/api/v1/config/agents` | Yes | Agent config (commands, provider, max_turns) |
| PATCH | `/api/v1/config/agents` | Yes | Update max_turns |
| POST | `/api/v1/config/agents` | Yes | Replace agent config |
| GET | `/api/v1/agents/{provider}/mcp` | Yes | Provider MCP servers |
| POST | `/api/v1/agents/{provider}/mcp` | Yes | Add MCP server |
| PUT | `/api/v1/agents/{provider}/mcp/{name}` | Yes | Update MCP server |
| PATCH | `/api/v1/agents/{provider}/mcp/{name}` | Yes | Toggle MCP server |
| DELETE | `/api/v1/agents/{provider}/mcp/{name}` | Yes | Delete MCP server |
| GET/POST | `/api/v1/agents/{provider}/permissions` | Yes | Provider permissions |
| GET/POST | `/api/v1/agents/{provider}/model` | Yes | Provider model |
| GET/POST | `/api/v1/agents/{provider}/hooks` | Yes | Provider hooks |
| GET/POST | `/api/v1/agents/claude/settings` | Yes | Claude settings.json |
| GET/POST/DELETE | `/api/v1/agents/claude/instructions` | Yes | Claude CLAUDE.md |
| GET/POST | `/api/v1/agents/claude/rules` | Yes | Claude rules |
| DELETE | `/api/v1/agents/claude/rules/{name}` | Yes | Delete rule |
| GET/POST | `/api/v1/agents/claude/skills` | Yes | Claude skills |
| DELETE | `/api/v1/agents/claude/skills/{name}` | Yes | Delete skill |
| GET/POST | `/api/v1/agents/claude/subagents` | Yes | Claude sub-agents |
| DELETE | `/api/v1/agents/claude/subagents/{name}` | Yes | Delete sub-agent |
| GET/POST | `/api/v1/config/agent-providers` | Yes | Embedded agent API keys |

### MCP Servers

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/mcp/tools` | Yes | All tools from MCP servers |
| GET | `/api/v1/mcp/servers` | Yes | List MCP servers |
| POST | `/api/v1/mcp/servers` | Yes | Register MCP server |
| DELETE | `/api/v1/mcp/servers/{id}` | Yes | Delete MCP server |

### Usage & Analytics

| Method | Path | Auth | Summary | Key params |
|--------|------|------|---------|------------|
| GET | `/api/v1/usage/{provider}/scan-state` | Yes | Scanner state | — |
| POST | `/api/v1/usage/{provider}/enabled` | Yes | Enable/disable tracking | body: `enabled` |
| POST | `/api/v1/usage/{provider}/refresh` | Yes | Re-scan usage files | body: `force` |
| GET | `/api/v1/usage/{provider}/summary` | Yes | Aggregated summary | `scope`, `range` |
| GET | `/api/v1/usage/{provider}/daily` | Yes | Daily data points | `scope`, `range` |
| GET | `/api/v1/usage/{provider}/breakdown` | Yes | Breakdown by model/project | `scope`, `range`, `kind` |
| GET | `/api/v1/usage/{provider}/sessions` | Yes | Session-level records | `scope`, `range`, `limit` |
| GET | `/api/v1/usage/rate-limits` | Yes | Rate limit status | — |
| POST | `/api/v1/usage/rate-limits/refresh` | Yes | Force rate limit check | — |
| GET | `/api/v1/warehouse/stats` | Yes | Platform-wide stats | `since`, `until`, `provider`, `project_id` |

### STT

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/stt/health` | Yes | Whisper availability |
| POST | `/api/v1/stt/transcribe` | Yes | Transcribe audio |

### Terminal

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET (WS) | `/api/v1/terminal/{session_id}` | No | WebSocket PTY |

### Unsandbox & Runtimes

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| GET | `/api/v1/unsandbox/status` | Yes | Service status |
| POST | `/api/v1/unsandbox/execute` | Yes | Execute remote command |
| GET | `/api/v1/unsandbox/sessions` | Yes | Active sessions |
| GET | `/api/v1/unsandbox/services` | Yes | Available services |
| GET/POST/DELETE | `/api/v1/config/unsandbox` | Yes | Unsandbox API key |
| GET | `/api/v1/config/runtimes` | Yes | All runtime targets |
| GET/POST/DELETE | `/api/v1/config/tailscale` | Yes | Tailscale config |
| GET | `/api/v1/config/tailscale/test` | Yes | Test Tailscale |
| GET/POST/DELETE | `/api/v1/config/kubernetes` | Yes | Kubernetes config |
| GET | `/api/v1/config/kubernetes/test` | Yes | Test Kubernetes |

---

## Detailed Endpoint Reference

### Health

#### `GET /healthz` or `GET /api/v1/healthz`

No authentication required.

**Response 200**
```json
{"status": "ok"}
```

---

### State

#### `GET /api/v1/state`

Returns the full in-memory orchestrator snapshot. Used by the desktop app for
initial hydration. The payload is formatted by the presenter layer and includes
all active, queued, and retrying issues.

**Response 200** — presenter-formatted state object (structure mirrors the issue list).

---

#### `POST /api/v1/refresh`

Enqueues a tracker sync cycle (pulls issues from the configured tracker into the
orchestrator). Returns immediately.

**Response 202**
```json
{"queued": true}
```

---

### Issues

#### `GET /api/v1/issues`

**Query parameters**

| Param | Type | Description |
|-------|------|-------------|
| `states` | string | Comma-separated state filter, e.g. `Todo,In Progress` |
| `project_id` | string | Filter by project |
| `assignee_id` | string | Filter by assignee |
| `limit` | integer | Page size |
| `offset` | integer | Page offset |

**Response 200**
```json
{
  "issues": [ <Issue> ... ],
  "total": 42
}
```

---

#### `POST /api/v1/issues`

**Request body**
```json
{
  "title": "Fix login bug",
  "description": "Users can't log in with SSO.",
  "state": "Backlog",
  "priority": 1,
  "assignee_id": "claude",
  "project_id": "abc123",
  "provider": "claude",
  "runtime_target": "",
  "disabled_tools": []
}
```

`title` is required. All other fields are optional and default to empty/zero.

**Response 201** — the created `Issue` object.

---

#### `GET /api/v1/issues/{issue_identifier}`

Returns the full issue detail. When the issue is actively running, the response
includes `running`, `retry`, `workspace`, `recent_events`, and `logs` fields.
When not running, these fields are present but may be empty.

**Response 200**
```json
{
  "id": "uuid",
  "identifier": "PROJ-42",
  "title": "Fix login bug",
  "description": "...",
  "state": "In Progress",
  "assignee_id": "claude",
  "priority": 1,
  "project_id": "abc123",
  "branch_name": "fix/proj-42-login-bug",
  "base_sha": "deadbeef",
  "url": "https://github.com/org/repo/issues/42",
  "labels": ["bug"],
  "provider": "claude",
  "disabled_tools": [],
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-02T00:00:00Z",
  "status": "RUNNING",
  "attempts": {
    "restart_count": 0,
    "current_retry_attempt": 0
  },
  "workspace": {"path": "/tmp/orchestra/worktrees/abc123/fix/proj-42-login-bug"},
  "running": {
    "provider": "claude",
    "session_log_path": "/tmp/orchestra/_logs/PROJ-42/latest.log",
    "last_event": "tool_use",
    "last_event_at": "2025-01-02T12:00:00Z",
    "last_message": "Reading file src/auth.go"
  },
  "retry": null,
  "logs": {
    "codex_session_logs": [{"label": "latest", "path": "/tmp/.../latest.log", "url": null}]
  },
  "recent_events": [
    {"at": "2025-01-02T12:00:00Z", "event": "tool_use", "message": "Reading file"}
  ],
  "history": [ <HistoryEntry> ... ],
  "pr_url": "",
  "plan": "",
  "feedback": ""
}
```

---

#### `PATCH /api/v1/issues/{issue_identifier}`

Applies a partial update. Fields not present in the body are unchanged.

**State transition rules:**

| From | To | Notes |
|------|----|-------|
| Backlog | Todo | Requires `title`, `description`, `assignee_id`, `project_id` all non-empty |
| Todo | In Progress | Free |
| Todo | Backlog | Free |
| In Progress | Review | Free; triggers auto-commit |
| In Progress | Backlog | Free |
| Review | Done | Free; triggers auto-commit + worktree cleanup |
| Review | Todo | Requires `feedback` in body |
| Review | In Progress | Requires `feedback` in body |

**Locked fields** (cannot change when state is not Backlog): `title`, `description`, `project_id`, `assignee_id`.

**Request body example**
```json
{
  "state": "Review"
}
```

**Response 200** — updated `Issue` object.

**Error codes**

| Code | HTTP | Description |
|------|------|-------------|
| `invalid_transition` | 400 | State change not in allowed graph |
| `field_locked` | 400 | Attempting to edit a locked field |
| `issue_not_found` | 404 | — |

---

#### `DELETE /api/v1/issues/{issue_identifier}`

Permanently deletes the issue. Stops running sessions, removes the git worktree and
branch, then deletes from the tracker.

**Response 204** — no body.

---

#### `DELETE /api/v1/issues/{issue_identifier}/session`

Stops the active agent session(s) and resets the issue state to `Todo`.

**Query params**

| Param | Description |
|-------|-------------|
| `provider` | Stop only this provider (e.g. `claude`). Omit to stop all. |

**Response 204** — no body.

---

#### `POST /api/v1/issues/{issue_identifier}/stop`

Hard-reset: stops all sessions, removes the worktree/branch, and resets the issue
to `Backlog` with `feedback`, `plan`, `branch_name`, and `base_sha` cleared.

**Response 200** — reset `Issue` object.

---

#### `POST /api/v1/issues/{issue_identifier}/pr`

Creates a GitHub pull request. The branch is pushed automatically before the PR is
opened. If a PR already exists for the branch it is returned instead of creating a
duplicate.

`owner`, `repo`, and `token` are resolved in this priority order:
1. Fields in the request body
2. Project's GitHub configuration
3. Global `ORCHESTRA_TRACKER_ENDPOINT` and `ORCHESTRA_TRACKER_TOKEN` config
4. `gh auth token` (GitHub CLI)

**Request body**
```json
{
  "title": "Fix login bug",
  "body": "Resolves PROJ-42",
  "head": "fix/proj-42-login-bug",
  "base": "main"
}
```

**Response 201** — GitHub PR object (from GitHub API).

---

#### `GET /api/v1/search`

**Query params**

| Param | Required | Description |
|-------|----------|-------------|
| `q` | Yes | Search query (full-text) |

**Response 200**
```json
{"issues": [ <Issue> ... ]}
```

---

### Events (SSE)

#### `GET /api/v1/events`

Long-lived connection. The server streams events as they occur. Reconnect using
`Last-Event-ID` after a disconnect.

**Response headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
```

**Event format**
```
id: <event-id>
event: <event-type>
data: <JSON payload>

```

**Event types**

| Type | Payload |
|------|---------|
| `state_update` | Full orchestrator snapshot |
| `issue_update` | Changed issue fields |
| `agent_event` | Agent execution event (tool use, message, etc.) |
| `session_started` | Session creation |
| `session_ended` | Session completion or failure |
| `run_completed` | Successful agent run |
| `run_failed` | Failed agent run |

**Heartbeat:** The server sends a `comment` line (`:\n\n`) every 15 seconds to keep
the connection alive through proxies.

---

### Sessions

#### `GET /api/v1/sessions`

**Query params**

| Param | Description |
|-------|-------------|
| `project_id` | Filter to a single project |
| `limit` | Page size |
| `offset` | Page offset |

**Response 200**
```json
{
  "sessions": [
    {
      "id": "sess-abc",
      "project_id": "proj-xyz",
      "project_name": "myrepo",
      "session_uuid": "uuid",
      "provider": "claude",
      "model": "claude-opus-4-5",
      "branch": "fix/proj-42",
      "created_at": "2025-01-01T10:00:00Z",
      "updated_at": "2025-01-01T10:30:00Z",
      "total_input": 15000,
      "total_output": 4000
    }
  ],
  "total": 1
}
```

---

#### `GET /api/v1/sessions/{session_id}`

Returns the session plus all its ordered events.

**Response 200**
```json
{
  "id": "sess-abc",
  "project_id": "proj-xyz",
  "provider": "claude",
  "model": "claude-opus-4-5",
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-01T10:30:00Z",
  "total_input": 15000,
  "total_output": 4000,
  "events": [
    {
      "id": "evt-001",
      "session_id": "sess-abc",
      "kind": "tool_use",
      "message": "Reading src/main.go",
      "raw_payload": "",
      "input_tokens": 1200,
      "output_tokens": 300,
      "timestamp": "2025-01-01T10:01:00Z"
    }
  ]
}
```

---

### Projects

#### `POST /api/v1/projects`

Registers a local directory. Git remote info is detected automatically by running
`git remote get-url origin`. GitHub owner/repo are parsed from the remote URL if it
points to `github.com`.

**Request body**
```json
{
  "root_path": "/home/user/projects/myrepo",
  "issue_source_type": "github",
  "issue_source_endpoint": "owner/repo",
  "issue_source_token": "ghp_..."
}
```

Only `root_path` is required.

**Response 201**
```json
{"id": "a3f8c2b1..."}
```

The `id` is a hex-encoded SHA-256 hash of the canonical (symlink-resolved) root path.

---

#### `GET /api/v1/projects`

Returns all projects. Token fields are redacted: `github_token` becomes `"<set>"` if
configured or `""` if not. `issue_source_has_token` is a boolean.

**Response 200** — array of `Project` objects.

---

#### `PATCH /api/v1/projects/{project_id}/issue-source`

Sets the per-project issue source. This replaces the legacy global `tracker_config_id`
assignment and is the recommended way to configure where a project gets its issues from.

**Request body**
```json
{
  "issue_source_type": "github",
  "issue_source_endpoint": "owner/repo",
  "issue_source_token": "ghp_..."
}
```

Token is encrypted before storage. Omitting `issue_source_token` leaves the existing
token in place.

---

### Git Operations

#### `GET /api/v1/projects/{project_id}/git/status`

Returns `git status --porcelain --branch` parsed into files and branch ahead/behind.

**Response 200**
```json
{
  "files": [
    {"status": " M", "path": "src/auth.go"},
    {"status": "A ", "path": "src/newfile.go"}
  ],
  "branch": {"ahead": 2, "behind": 0}
}
```

---

#### `GET /api/v1/projects/{project_id}/git/diff`

**Query params**

| Param | Description |
|-------|-------------|
| `hash` | Show diff for a specific commit |
| `file` | Scope to a file path |
| `staged` | `true` to show `--cached` diff |

Returns unified diff text (`text/plain`).

---

#### `POST /api/v1/projects/{project_id}/git/commit`

Runs `git add -A && git commit -m <message>`.

**Request body**
```json
{"message": "feat(auth): fix SSO login flow"}
```

Paths are validated to be inside a registered project root. Returns `403` for
paths outside allowed roots.

---

### GitHub Integration

#### `GET /api/v1/projects/{project_id}/github/issues`

Returns GitHub issues for the linked repository. Requires `github_owner`,
`github_repo`, and a GitHub token on the project.

**Query params**

| Param | Default | Description |
|-------|---------|-------------|
| `state` | `open` | `open` or `closed` |
| `page` | `1` | Page number (50 items per page) |

**Response 200**
```json
{
  "issues": [ ...GitHub issue objects... ],
  "has_more": true
}
```

Returns `{"issues": [], "has_more": false}` when the project has no GitHub credentials.

---

#### `POST /api/v1/projects/{project_id}/github/pulls/{number}/reviews`

**Request body**

| Field | Values |
|-------|--------|
| `body` | Review text |
| `event` | `COMMENT`, `APPROVE`, or `REQUEST_CHANGES` |

---

### Tracker Configs

Tracker configs are named, reusable connections to external issue trackers. They
differ from per-project issue sources: a tracker config can be shared across multiple
projects via the legacy `tracker_config_id` assignment.

#### `POST /api/v1/tracker/configs`

**Request body**
```json
{
  "type": "github",
  "display_name": "My Org GitHub",
  "endpoint": "myorg/myrepo",
  "auth_method": "apikey",
  "token": "ghp_...",
  "extra": {}
}
```

`type` and `display_name` are required. `auth_method` defaults to `apikey`.
Token is encrypted with AES-256-GCM before storage.

**Response 201**
```json
{
  "id": "uuid",
  "type": "github",
  "display_name": "My Org GitHub",
  "endpoint": "myorg/myrepo",
  "auth_method": "apikey",
  "has_token": true,
  "extra": "",
  "created_at": 1704067200,
  "updated_at": 1704067200
}
```

Note: `has_token` is `true`/`false` — the actual token is never returned.

---

#### `POST /api/v1/tracker/configs/{config_id}/test`

Pings the underlying tracker adapter. Use this to verify credentials before saving.

**Response 200**
```json
{"ok": true}
// or
{"ok": false, "error": "401 Unauthorized"}
```

---

### Workspace File Operations

All workspace file operations are path-validated. The `path` parameter must be an
absolute path inside one of: the configured `ORCHESTRA_WORKSPACE_ROOT`, worktree
root, or any registered project's `root_path`. Paths that escape these roots return
`400 invalid_path`.

#### `PUT /api/v1/workspace/file`

Writes file content. The raw request body is the file content (not JSON). Maximum
body size is **32 MiB**.

**Query params**

| Param | Required | Description |
|-------|----------|-------------|
| `path` | Yes | Absolute path to write |

**Response 200**
```json
{"ok": true, "bytes": 1234}
```

---

#### `POST /api/v1/workspace/rename`

**Request body**
```json
{
  "from": "/abs/path/to/old-name.ts",
  "to": "/abs/path/to/new-name.ts"
}
```

Returns `404` if source doesn't exist, `409` if destination already exists.

---

### MCP Servers

MCP (Model Context Protocol) servers extend agents with additional tools via
JSON-RPC over stdin/stdout.

#### `POST /api/v1/mcp/servers`

**Request body**
```json
{
  "name": "filesystem",
  "command": "npx -y @modelcontextprotocol/server-filesystem /tmp"
}
```

After creation, the orchestrator's MCP registry is hot-reloaded — the new server
starts immediately.

**Response 201**
```json
{"id": "1", "name": "filesystem", "command": "..."}
```

---

### Agent Configuration

#### `GET /api/v1/config/agents`

**Response 200**
```json
{
  "commands": {
    "claude": "claude",
    "codex": "codex",
    "gemini": "gemini-cli",
    "opencode": "opencode"
  },
  "agent_provider": "claude",
  "max_turns": 50
}
```

---

#### `PATCH /api/v1/config/agents`

Updates `max_turns` only (1–100). Other fields are read-only via this endpoint.

**Request body**
```json
{"max_turns": 30}
```

---

### Claude-Specific Config

The following endpoints manage Claude's configuration files stored in the
home directory:

| Endpoint | File managed |
|----------|-------------|
| `GET/POST /api/v1/agents/claude/settings` | `~/.claude/settings.json` |
| `GET/POST/DELETE /api/v1/agents/claude/instructions` | `CLAUDE.md` |
| `GET/POST /api/v1/agents/claude/rules` | Rule files in `~/.claude/rules/` |
| `DELETE /api/v1/agents/claude/rules/{name}` | Single rule file |
| `GET/POST /api/v1/agents/claude/skills` | Skill files in `~/.claude/skills/` |
| `DELETE /api/v1/agents/claude/skills/{name}` | Single skill file |
| `GET/POST /api/v1/agents/claude/subagents` | Sub-agent configs |
| `DELETE /api/v1/agents/claude/subagents/{name}` | Single sub-agent |

---

### Usage Analytics

Usage endpoints read JSONL session files written by Claude Code and other agents.
Data is not derived from the Orchestra warehouse DB — it reads the agents' own
usage logs from disk.

**Providers:** `claude` (others may be added).

**Scope values:**

| Value | Description |
|-------|-------------|
| `all` | All sessions (default) |
| `project` | Scoped to a project |
| `session` | Single session |

**Range values:**

| Value | Description |
|-------|-------------|
| `7d` | Last 7 days |
| `30d` | Last 30 days (default) |
| `90d` | Last 90 days |
| `1y` | Last year |

---

#### `GET /api/v1/usage/{provider}/summary`

**Query params:** `scope`, `range`

**Response 200**
```json
{
  "total_input": 1500000,
  "total_output": 300000,
  "total_cache_read": 200000,
  "total_cache_write": 50000,
  "total_cost_usd": 12.50,
  "session_count": 47
}
```

---

#### `GET /api/v1/usage/{provider}/daily`

**Response 200** — array of daily data points:
```json
[
  {"date": "2025-01-01", "input_tokens": 50000, "output_tokens": 10000, "cost_usd": 0.45},
  {"date": "2025-01-02", "input_tokens": 75000, "output_tokens": 15000, "cost_usd": 0.68}
]
```

---

#### `GET /api/v1/usage/{provider}/breakdown`

**Query params:** `scope`, `range`, `kind` (`model`|`project`|`session`)

**Response 200** — array of breakdown rows:
```json
[
  {
    "key": "claude-opus-4-5",
    "input_tokens": 900000,
    "output_tokens": 200000,
    "cost_usd": 9.50,
    "session_count": 28
  }
]
```

---

#### `POST /api/v1/usage/{provider}/refresh`

Triggers a filesystem re-scan. On failure, the partial state is returned in
`details.state` alongside the error:

```json
{
  "error": {"code": "refresh_failed", "message": "permission denied: /home/user/.claude/usage/bad-file.jsonl"},
  "details": {
    "state": {"enabled": true, "scanning": false, "file_count": 12}
  }
}
```

---

#### `GET /api/v1/usage/rate-limits`

Returns the rate limit status from the most recent Claude API response. Cached
until the reset time.

**Response 200**
```json
{
  "requests_limit": 1000,
  "requests_remaining": 847,
  "requests_reset": "2025-01-01T10:00:00Z",
  "tokens_limit": 2000000,
  "tokens_remaining": 1450000,
  "tokens_reset": "2025-01-01T10:00:00Z"
}
```

---

### Warehouse Stats

#### `GET /api/v1/warehouse/stats`

Returns platform-wide aggregate token usage from the Orchestra warehouse SQLite DB
(distinct from usage analytics). Results are cached for 30 seconds.

**Query params**

| Param | Description |
|-------|-------------|
| `since` | RFC3339 lower bound on session created_at |
| `until` | RFC3339 upper bound |
| `provider` | Filter to one provider |
| `project_id` | Filter to one project |

**Response 200**
```json
{
  "total_tokens": 5000000,
  "total_input": 4000000,
  "total_output": 1000000,
  "total_cache_read": 500000,
  "total_cache_write": 100000,
  "total_thinking": 0,
  "provider_usage": {"claude": 4500000, "codex": 500000},
  "provider_tokens": {
    "claude": {
      "total": 4500000, "input": 3500000, "output": 1000000,
      "cache_read": 400000, "cache_write": 80000, "thinking": 0
    }
  },
  "model_usage": {"claude-opus-4-5": 3000000, "claude-sonnet-4-5": 1500000},
  "provider_sessions": {
    "claude": {"total": 120, "completed": 105, "failed": 15, "avg_duration": 185.4}
  },
  "recent_sessions": [ <Session> ... ]
}
```

---

### STT

#### `POST /api/v1/stt/transcribe`

Transcribes audio using Whisper.

**Request body**
```json
{
  "audio": "<base64-encoded audio>",
  "language": "en"
}
```

**Response 200**
```json
{"text": "Fix the authentication bug in the login flow."}
```

---

### Terminal WebSocket

#### `GET /api/v1/terminal/{session_id}`

Upgrades to WebSocket. The `session_id` maps to a PTY managed by the terminal
multiplexer. This endpoint bypasses HTTP bearer auth — authentication is handled
at the WebSocket handshake layer.

**Message types (client to server)**

- Binary frames: stdin data
- JSON text frame: `{"type":"resize","cols":120,"rows":40}`

**Message types (server to client)**

- Binary frames: stdout/stderr data

---

## Data Schemas

### Issue

The core work item. The `identifier` field is the human-readable ID (e.g. `PROJ-42`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID |
| `identifier` | string | Short human-readable ID |
| `title` | string | — |
| `description` | string | — |
| `state` | string | `Backlog` \| `Todo` \| `In Progress` \| `Review` \| `Done` |
| `priority` | integer | Lower = higher priority |
| `assignee_id` | string | Agent provider name |
| `project_id` | string | — |
| `branch_name` | string | Git branch for this issue |
| `base_sha` | string | SHA the branch was created from |
| `provider` | string | Agent override |
| `disabled_tools` | string[] | Tools disabled for this run |
| `feedback` | string | Human feedback (Review to backtrack) |
| `pr_url` | string | GitHub PR if created |
| `plan` | string | Agent execution plan |
| `status` | string | Runtime dispatch status |

---

### Project

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | SHA-256(canonical_path)[0:16], hex |
| `name` | string | Directory basename |
| `root_path` | string | Absolute filesystem path |
| `remote_url` | string | Git remote URL |
| `github_owner` | string | — |
| `github_repo` | string | — |
| `github_token` | string | `"<set>"` or `""` (never the real value) |
| `tracker_config_id` | string | Legacy tracker config link |
| `path_exists` | boolean | Whether root_path exists |
| `issue_source_type` | string | `github`\|`linear`\|`jira`\|`sqlite`\|`memory` |
| `issue_source_endpoint` | string | — |
| `issue_source_has_token` | boolean | Token is configured |

---

### Session

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session UUID |
| `project_id` | string | — |
| `project_name` | string | Display name |
| `session_uuid` | string | Agent-reported session UUID |
| `provider` | string | `claude`\|`codex`\|`gemini`\|`opencode` |
| `model` | string | Model name used |
| `branch` | string | Git branch at session start |
| `created_at` | datetime | — |
| `updated_at` | datetime | Timestamp of last event |
| `total_input` | integer | Cumulative input tokens |
| `total_output` | integer | Cumulative output tokens |

---

### TrackerConfig

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID |
| `type` | string | `github`\|`linear`\|`jira` |
| `display_name` | string | — |
| `endpoint` | string | API URL or `owner/repo` |
| `auth_method` | string | `apikey`\|`oauth`\|`none` |
| `has_token` | boolean | Token is stored (never exposed) |
| `extra` | string | JSON string |
| `created_at` | integer | Unix timestamp |
| `updated_at` | integer | Unix timestamp |

---

## Error Reference

All errors use the envelope:
```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human-readable description"
  }
}
```

Some errors include a `details` object with partial state.

### Common error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `invalid_json` | 400 | Malformed JSON body |
| `invalid_request` | 400 | Missing required field |
| `invalid_transition` | 400 | Disallowed state change |
| `field_locked` | 400 | Field cannot change in current state |
| `missing_params` | 400 | Required parameters could not be inferred |
| `unauthorized` | 401 | Missing/invalid bearer token |
| `unauthorized_project_path` | 403 | Path outside allowed roots |
| `invalid_path` | 403 | Path traversal attempt |
| `not_found` / `issue_not_found` / `project_not_found` | 404 | Resource not found |
| `session_not_found` | 404 | — |
| `path_not_found` | 404 | — |
| `no_active_session` | 409 | Stop requested but no session |
| `path_exists` | 409 | Create but path already exists |
| `destination_exists` | 409 | Rename destination exists |
| `body_too_large` | 413 | Workspace file write > 32 MiB |
| `unsupported_media_type` | 415 | POST without `application/json` |
| `fetch_failed` / `db_failed` | 500 | Internal database or fetch error |
| `create_failed` / `update_failed` | 500 | Write operation failed |
| `delete_failed` | 500 | Delete operation failed |
| `git_commit_failed` | 500 | Git commit error |
| `git_push_failed` | 500 | Git push error |
| `pr_creation_failed` | 500 | GitHub PR creation error |
| `refresh_failed` | 500 | Usage scan refresh failed (with `details.state`) |
| `db_unavailable` | 503 | Database not initialized |
| `github_fetch_failed` | 502 | GitHub API upstream error |

---

## State Transitions

```
Backlog --> Todo --> In Progress --> Review --> Done
             ^           ^               |
             |           |    (feedback) |
             +-----------+<--------------+
```

**Gates:**
- `Backlog to Todo`: `title`, `description`, `assignee_id`, `project_id` must all be set and `assignee_id` must not be `"unassigned"`.
- `Review to Todo` or `Review to In Progress`: `feedback` field must be present in the PATCH body.

---

## Authentication Details

When `ORCHESTRA_API_TOKEN` is set, all `/api/v1/*` routes (except `/api/v1/healthz`
and `/api/v1/openapi.yaml`) require the header:

```
Authorization: Bearer <token>
```

Connections from `127.0.0.1`, `::1`, or `localhost` bypass this check automatically,
allowing the desktop Electron app to connect without explicit configuration.

The terminal WebSocket endpoint (`/api/v1/terminal/{session_id}`) also bypasses HTTP
bearer auth — it uses its own handshake-level authentication.

---

## CORS

Allowed origins:
- `http://127.0.0.1:4010` / `5173` / `5174`
- `http://localhost:4010` / `5173` / `5174`
- `http://[::1]:4010` / `5173` / `5174`
- When `ORCHESTRA_HOST` is a non-loopback address: `http://<host>` and `https://<host>`

Allowed methods: `GET POST PUT DELETE PATCH OPTIONS`

Allowed headers: `Accept Authorization Content-Type`

`max-age`: 300 seconds
