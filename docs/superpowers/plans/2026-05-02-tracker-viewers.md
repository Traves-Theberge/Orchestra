# Tracker Viewer Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build WorkItem-based viewer panels for Linear, Jira, and Git — each with a browse list and a detail view — wired into the AppShell as a new section.

**Architecture:** A shared `WorkItem` TypeScript type is the only type viewer components ever touch. A `useTrackerWorkItems` SWR hook fetches from the backend. `WorkItemBrowser` and `WorkItemDetail` are tracker-agnostic; each tracker contributes only a `*Toolbar` slot component. The two-pane `TrackerViewer` shell composes these. The Git viewer reuses `widgets/git/DiffViewer` for PR diffs.

**Prerequisite:** Backend Plan (`2026-05-02-tracker-backend.md`) must be complete — the `/api/v1/tracker/configs` and `/api/v1/issues` endpoints must be running.

**Tech Stack:** React 19, TypeScript, Tailwind v4, SWR (already in deps or use existing polling pattern), `widgets/git/DiffViewer` for diffs.

---

## File Map

**New files:**
- `apps/desktop/src/entities/tracker/types.ts` — WorkItem, TrackerConfig, TrackerProject, TrackerState TS types
- `apps/desktop/src/entities/tracker/api.ts` — orchestra-client wrapper functions for tracker endpoints
- `apps/desktop/src/entities/tracker/useTrackerWorkItems.ts` — data-fetching hook
- `apps/desktop/src/components/tracker/WorkItemBrowser.tsx` — virtualised list with search/filter
- `apps/desktop/src/components/tracker/WorkItemDetail.tsx` — detail panel renderer
- `apps/desktop/src/components/tracker/TrackerToolbar.tsx` — slot + LinearToolbar + JiraToolbar + GitToolbar
- `apps/desktop/src/components/tracker/TrackerViewer.tsx` — two-pane shell
- `apps/desktop/src/components/tracker/index.ts` — barrel export

**Modified files:**
- `apps/desktop/src/app/layout/AppShell.tsx` — add Tracker nav item + section
- `apps/desktop/src/lib/orchestra-client.ts` — add tracker config + browse API calls

---

### Task 1: WorkItem TypeScript types and API client functions

**Files:**
- Create: `apps/desktop/src/entities/tracker/types.ts`
- Create: `apps/desktop/src/entities/tracker/api.ts`
- Modify: `apps/desktop/src/lib/orchestra-client.ts`

- [ ] **Step 1: Create types.ts**

```ts
// apps/desktop/src/entities/tracker/types.ts

export type WorkItemSource = 'github' | 'linear' | 'jira' | 'sqlite' | 'memory'

export interface WorkItem {
  id: string           // tracker-prefixed: "gh:123", "linear:abc", "jira:PROJ-45"
  identifier: string   // display ID: "#123", "ENG-42", "PROJ-45"
  source: WorkItemSource
  title: string
  description: string
  state: string
  priority: number
  url: string
  labels: string[]
  assignees: string[]
  assigneeId?: string
  projectId?: string
  branchName?: string
  prUrl?: string
  createdAt: string
  updatedAt: string
  extra: Record<string, unknown>
}

export interface TrackerConfig {
  id: string
  type: string
  displayName: string
  endpoint: string
  authMethod: 'apikey' | 'oauth'
  tokenEnc: string   // always "***" from API
  extra: string
  createdAt: number
  updatedAt: number
}

export interface TrackerProject {
  id: string
  name: string
}

export interface TrackerState {
  id: string
  name: string
  type: 'todo' | 'in_progress' | 'done' | 'cancelled'
}

export interface WorkItemFilter {
  states?: string[]
  labels?: string[]
  assigneeId?: string
  search?: string
}
```

- [ ] **Step 2: Add tracker API functions to orchestra-client.ts**

Open `apps/desktop/src/lib/orchestra-client.ts` and add these functions (following the existing pattern in that file):

```ts
// Tracker configs
export async function listTrackerConfigs(): Promise<TrackerConfig[]> {
  return apiFetch('/api/v1/tracker/configs')
}

export async function createTrackerConfig(payload: {
  type: string
  displayName: string
  endpoint: string
  authMethod: string
  token: string
  extra?: Record<string, unknown>
}): Promise<TrackerConfig> {
  return apiFetch('/api/v1/tracker/configs', {
    method: 'POST',
    body: JSON.stringify({
      type: payload.type,
      display_name: payload.displayName,
      endpoint: payload.endpoint,
      auth_method: payload.authMethod,
      token: payload.token,
      extra: payload.extra,
    }),
  })
}

export async function updateTrackerConfig(
  configId: string,
  patch: { displayName?: string; endpoint?: string; token?: string; extra?: Record<string, unknown> }
): Promise<TrackerConfig> {
  return apiFetch(`/api/v1/tracker/configs/${configId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      display_name: patch.displayName,
      endpoint: patch.endpoint,
      token: patch.token,
      extra: patch.extra,
    }),
  })
}

export async function deleteTrackerConfig(configId: string): Promise<void> {
  await apiFetch(`/api/v1/tracker/configs/${configId}`, { method: 'DELETE' })
}

export async function testTrackerConfig(configId: string): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(`/api/v1/tracker/configs/${configId}/test`, { method: 'POST' })
}

export async function fetchTrackerProjects(configId: string): Promise<TrackerProject[]> {
  return apiFetch(`/api/v1/tracker/configs/${configId}/projects`)
}

export async function fetchTrackerStates(configId: string): Promise<TrackerState[]> {
  return apiFetch(`/api/v1/tracker/configs/${configId}/states`)
}

// Browse: fetch WorkItems from a specific tracker config directly
export async function browseTrackerItems(
  configId: string,
  filter?: WorkItemFilter
): Promise<WorkItem[]> {
  const params = new URLSearchParams()
  if (filter?.states?.length) params.set('states', filter.states.join(','))
  if (filter?.search) params.set('q', filter.search)
  const qs = params.toString()
  return apiFetch(`/api/v1/tracker/configs/${configId}/issues${qs ? '?' + qs : ''}`)
}

export async function setProjectTracker(projectId: string, configId: string): Promise<void> {
  await apiFetch(`/api/v1/projects/${projectId}/tracker`, {
    method: 'POST',
    body: JSON.stringify({ config_id: configId }),
  })
}
```

Also add the missing backend endpoint for browse. In `apps/backend/internal/api/tracker_configs.go` add:

```go
// GetTrackerConfigIssues handles GET /api/v1/tracker/configs/{config_id}/issues
func (s *Server) GetTrackerConfigIssues(w http.ResponseWriter, r *http.Request) {
    configID := chi.URLParam(r, "config_id")
    a, err := s.registry.GetAdapter(configID)
    if err != nil {
        writeJSONError(w, http.StatusNotFound, "not_found", "adapter not loaded")
        return
    }
    states := strings.Split(r.URL.Query().Get("states"), ",")
    items, err := a.Fetch(r.Context(), tracker.Filter{States: states})
    if err != nil {
        writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
        return
    }
    writeJSON(w, http.StatusOK, items)
}
```

Register in router.go:
```go
protected.Get("/api/v1/tracker/configs/{config_id}/issues", server.GetTrackerConfigIssues)
```

- [ ] **Step 3: Create api.ts barrel**

```ts
// apps/desktop/src/entities/tracker/api.ts
export {
  listTrackerConfigs,
  createTrackerConfig,
  updateTrackerConfig,
  deleteTrackerConfig,
  testTrackerConfig,
  fetchTrackerProjects,
  fetchTrackerStates,
  browseTrackerItems,
  setProjectTracker,
} from '@/lib/orchestra-client'
export type { WorkItem, TrackerConfig, TrackerProject, TrackerState, WorkItemFilter } from './types'
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/entities/tracker/ apps/desktop/src/lib/orchestra-client.ts \
  apps/backend/internal/api/tracker_configs.go apps/backend/internal/api/router.go
git commit -m "feat(tracker): add WorkItem types, API client functions, and browse endpoint"
```

---

### Task 2: useTrackerWorkItems hook

**Files:**
- Create: `apps/desktop/src/entities/tracker/useTrackerWorkItems.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/desktop/src/entities/tracker/useTrackerWorkItems.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useTrackerWorkItems } from './useTrackerWorkItems'
import * as api from '@/lib/orchestra-client'

vi.mock('@/lib/orchestra-client', () => ({
  browseTrackerItems: vi.fn(),
}))

const mockItem = {
  id: 'linear:abc',
  identifier: 'ENG-1',
  source: 'linear' as const,
  title: 'Fix bug',
  description: '',
  state: 'In Progress',
  priority: 2,
  url: 'https://linear.app/eng/issue/ENG-1',
  labels: [],
  assignees: [],
  createdAt: '',
  updatedAt: '',
  extra: {},
}

describe('useTrackerWorkItems', () => {
  beforeEach(() => {
    vi.mocked(api.browseTrackerItems).mockResolvedValue([mockItem])
  })

  it('fetches items for a config', async () => {
    const { result } = renderHook(() => useTrackerWorkItems('cfg-1'))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0].identifier).toBe('ENG-1')
  })

  it('returns loading true initially', () => {
    const { result } = renderHook(() => useTrackerWorkItems('cfg-1'))
    expect(result.current.loading).toBe(true)
  })

  it('returns empty array when configId is null', () => {
    const { result } = renderHook(() => useTrackerWorkItems(null))
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && npx vitest run src/entities/tracker/useTrackerWorkItems.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

```ts
// apps/desktop/src/entities/tracker/useTrackerWorkItems.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { browseTrackerItems } from '@/lib/orchestra-client'
import type { WorkItem, WorkItemFilter } from './types'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  items: WorkItem[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(configId: string, filter?: WorkItemFilter): string {
  return `${configId}::${JSON.stringify(filter ?? {})}`
}

export function useTrackerWorkItems(
  configId: string | null,
  filter?: WorkItemFilter
): {
  items: WorkItem[]
  loading: boolean
  error: Error | null
  refresh: () => void
} {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetch = useCallback(async () => {
    if (!configId) return
    const key = cacheKey(configId, filter)
    const cached = cache.get(key)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setItems(cached.items)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setError(null)

    try {
      const data = await browseTrackerItems(configId, filter)
      cache.set(key, { items: data, fetchedAt: Date.now() })
      setItems(data)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err as Error)
      }
    } finally {
      setLoading(false)
    }
  }, [configId, JSON.stringify(filter)])

  useEffect(() => {
    if (!configId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    fetch()
    return () => abortRef.current?.abort()
  }, [fetch])

  return { items, loading, error, refresh: fetch }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop && npx vitest run src/entities/tracker/useTrackerWorkItems.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/entities/tracker/
git commit -m "feat(tracker): add useTrackerWorkItems hook with 5-min TTL cache"
```

---

### Task 3: WorkItemBrowser component

**Files:**
- Create: `apps/desktop/src/components/tracker/WorkItemBrowser.tsx`

- [ ] **Step 1: Implement WorkItemBrowser**

```tsx
// apps/desktop/src/components/tracker/WorkItemBrowser.tsx
import { useState, useMemo } from 'react'
import type { WorkItem, WorkItemFilter } from '@/entities/tracker/types'

interface Props {
  items: WorkItem[]
  loading: boolean
  selectedId: string | null
  onSelect: (item: WorkItem) => void
  filter: WorkItemFilter
  onFilterChange: (filter: WorkItemFilter) => void
}

const PRIORITY_LABELS: Record<number, string> = {
  0: '',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

const SOURCE_BADGE: Record<string, string> = {
  linear: 'bg-violet-500/20 text-violet-300',
  jira: 'bg-blue-500/20 text-blue-300',
  github: 'bg-gray-500/20 text-gray-300',
}

export function WorkItemBrowser({ items, loading, selectedId, onSelect, filter, onFilterChange }: Props) {
  const filtered = useMemo(() => {
    let out = items
    if (filter.search) {
      const q = filter.search.toLowerCase()
      out = out.filter(
        (i) => i.title.toLowerCase().includes(q) || i.identifier.toLowerCase().includes(q)
      )
    }
    if (filter.states?.length) {
      out = out.filter((i) => filter.states!.includes(i.state))
    }
    if (filter.labels?.length) {
      out = out.filter((i) => filter.labels!.some((l) => i.labels.includes(l)))
    }
    return out
  }, [items, filter])

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <input
          type="text"
          placeholder="Search…"
          value={filter.search ?? ''}
          onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
          className="w-full px-3 py-1.5 text-sm bg-surface-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-muted text-center">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-4 text-sm text-muted text-center">No items</div>
        )}
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={`w-full text-left px-3 py-2.5 border-b border-border hover:bg-surface-2 transition-colors ${
              selectedId === item.id ? 'bg-surface-2 border-l-2 border-l-accent' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs text-muted font-mono">{item.identifier}</span>
              {item.source !== 'sqlite' && (
                <span className={`text-xs px-1 rounded ${SOURCE_BADGE[item.source] ?? ''}`}>
                  {item.source}
                </span>
              )}
            </div>
            <div className="text-sm font-medium truncate">{item.title}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted">{item.state}</span>
              {item.priority > 0 && (
                <span className="text-xs text-muted">{PRIORITY_LABELS[item.priority]}</span>
              )}
              {item.labels.slice(0, 2).map((l) => (
                <span key={l} className="text-xs px-1 rounded bg-surface-3 text-muted">{l}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/tracker/WorkItemBrowser.tsx
git commit -m "feat(tracker): add WorkItemBrowser component"
```

---

### Task 4: WorkItemDetail component

**Files:**
- Create: `apps/desktop/src/components/tracker/WorkItemDetail.tsx`

- [ ] **Step 1: Implement WorkItemDetail**

```tsx
// apps/desktop/src/components/tracker/WorkItemDetail.tsx
import type { WorkItem } from '@/entities/tracker/types'

interface Props {
  item: WorkItem | null
}

export function WorkItemDetail({ item }: Props) {
  if (!item) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted">
        Select an item to view details
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-muted">{item.identifier}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-muted">{item.state}</span>
          {item.priority > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-muted">P{item.priority}</span>
          )}
        </div>
        <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
        <div className="flex flex-wrap gap-1 mt-2">
          {item.labels.map((l) => (
            <span key={l} className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-muted">{l}</span>
          ))}
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Description</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{item.description}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Details</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Source</dt>
          <dd>{item.source}</dd>
          {item.assigneeId && (
            <>
              <dt className="text-muted">Assignee</dt>
              <dd className="truncate">{item.assigneeId}</dd>
            </>
          )}
          {item.branchName && (
            <>
              <dt className="text-muted">Branch</dt>
              <dd className="font-mono text-xs truncate">{item.branchName}</dd>
            </>
          )}
          {item.prUrl && (
            <>
              <dt className="text-muted">PR</dt>
              <dd>
                <a href={item.prUrl} target="_blank" rel="noreferrer" className="text-accent underline text-xs truncate block">
                  {item.prUrl}
                </a>
              </dd>
            </>
          )}
          {item.url && (
            <>
              <dt className="text-muted">Link</dt>
              <dd>
                <a href={item.url} target="_blank" rel="noreferrer" className="text-accent underline text-xs truncate block">
                  View in tracker ↗
                </a>
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* Extra metadata chips (cycle, sprint, JQL match, etc.) */}
      {Object.keys(item.extra).length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Tracker Metadata</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(item.extra).map(([k, v]) => (
              <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-muted">
                {k}: {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/tracker/WorkItemDetail.tsx
git commit -m "feat(tracker): add WorkItemDetail component"
```

---

### Task 5: Tracker toolbars

**Files:**
- Create: `apps/desktop/src/components/tracker/TrackerToolbar.tsx`

- [ ] **Step 1: Implement TrackerToolbar with Linear, Jira, and Git slots**

```tsx
// apps/desktop/src/components/tracker/TrackerToolbar.tsx
import type { TrackerConfig } from '@/entities/tracker/types'
import type { WorkItemFilter } from '@/entities/tracker/types'

interface ToolbarProps {
  config: TrackerConfig | null
  filter: WorkItemFilter
  onFilterChange: (f: WorkItemFilter) => void
}

export function TrackerToolbar({ config, filter, onFilterChange }: ToolbarProps) {
  if (!config) return null
  switch (config.type) {
    case 'linear':
      return <LinearToolbar filter={filter} onFilterChange={onFilterChange} />
    case 'jira':
      return <JiraToolbar filter={filter} onFilterChange={onFilterChange} />
    case 'github':
      return <GitToolbar filter={filter} onFilterChange={onFilterChange} />
    default:
      return null
  }
}

function LinearToolbar({ filter, onFilterChange }: Omit<ToolbarProps, 'config'>) {
  const states = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 text-sm">
      <span className="text-muted text-xs">State:</span>
      <select
        value={filter.states?.[0] ?? ''}
        onChange={(e) => onFilterChange({ ...filter, states: e.target.value ? [e.target.value] : [] })}
        className="text-xs bg-surface-2 border border-border rounded px-1.5 py-0.5 focus:outline-none"
      >
        <option value="">All</option>
        {states.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  )
}

function JiraToolbar({ filter, onFilterChange }: Omit<ToolbarProps, 'config'>) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 text-sm">
      <span className="text-muted text-xs">State:</span>
      <input
        type="text"
        placeholder="e.g. In Progress"
        value={filter.states?.[0] ?? ''}
        onChange={(e) => onFilterChange({ ...filter, states: e.target.value ? [e.target.value] : [] })}
        className="text-xs bg-surface-2 border border-border rounded px-1.5 py-0.5 focus:outline-none w-32"
      />
    </div>
  )
}

function GitToolbar({ filter, onFilterChange }: Omit<ToolbarProps, 'config'>) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-1 text-sm">
      <span className="text-muted text-xs">Filter:</span>
      <select
        value={filter.states?.[0] ?? ''}
        onChange={(e) => onFilterChange({ ...filter, states: e.target.value ? [e.target.value] : [] })}
        className="text-xs bg-surface-2 border border-border rounded px-1.5 py-0.5 focus:outline-none"
      >
        <option value="">All</option>
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="merged">Merged</option>
      </select>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/tracker/TrackerToolbar.tsx
git commit -m "feat(tracker): add TrackerToolbar with Linear/Jira/Git slots"
```

---

### Task 6: TrackerViewer two-pane shell

**Files:**
- Create: `apps/desktop/src/components/tracker/TrackerViewer.tsx`
- Create: `apps/desktop/src/components/tracker/index.ts`

- [ ] **Step 1: Implement TrackerViewer**

```tsx
// apps/desktop/src/components/tracker/TrackerViewer.tsx
import { useState, useEffect } from 'react'
import { WorkItemBrowser } from './WorkItemBrowser'
import { WorkItemDetail } from './WorkItemDetail'
import { TrackerToolbar } from './TrackerToolbar'
import { useTrackerWorkItems } from '@/entities/tracker/useTrackerWorkItems'
import { listTrackerConfigs } from '@/lib/orchestra-client'
import type { WorkItem, TrackerConfig, WorkItemFilter } from '@/entities/tracker/types'

export function TrackerViewer() {
  const [configs, setConfigs] = useState<TrackerConfig[]>([])
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null)
  const [filter, setFilter] = useState<WorkItemFilter>({})

  useEffect(() => {
    listTrackerConfigs().then((data) => {
      setConfigs(data)
      if (data.length > 0 && !activeConfigId) {
        setActiveConfigId(data[0].id)
      }
    })
  }, [])

  const { items, loading } = useTrackerWorkItems(activeConfigId, filter)
  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Config selector header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-1">
        <span className="text-sm font-medium">Tracker</span>
        <select
          value={activeConfigId ?? ''}
          onChange={(e) => { setActiveConfigId(e.target.value); setSelectedItem(null) }}
          className="text-sm bg-surface-2 border border-border rounded px-2 py-1 focus:outline-none"
        >
          {configs.length === 0 && <option value="">No connections configured</option>}
          {configs.map((c) => (
            <option key={c.id} value={c.id}>{c.displayName}</option>
          ))}
        </select>
        {configs.length === 0 && (
          <span className="text-xs text-muted">Add a connection in Settings → Connections</span>
        )}
      </div>

      {/* Toolbar slot */}
      <TrackerToolbar config={activeConfig} filter={filter} onFilterChange={setFilter} />

      {/* Two-pane body */}
      <div className="flex flex-1 min-h-0">
        <div className="w-72 flex-shrink-0 border-r border-border overflow-hidden">
          <WorkItemBrowser
            items={items}
            loading={loading}
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelectedItem}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <WorkItemDetail item={selectedItem} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create barrel export**

```ts
// apps/desktop/src/components/tracker/index.ts
export { TrackerViewer } from './TrackerViewer'
export { WorkItemBrowser } from './WorkItemBrowser'
export { WorkItemDetail } from './WorkItemDetail'
export { TrackerToolbar } from './TrackerToolbar'
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/tracker/
git commit -m "feat(tracker): add TrackerViewer two-pane shell"
```

---

### Task 7: Wire TrackerViewer into AppShell

**Files:**
- Modify: `apps/desktop/src/app/layout/AppShell.tsx`

- [ ] **Step 1: Add Tracker nav item and section to AppShell**

Open `apps/desktop/src/app/layout/AppShell.tsx`. Find the section navigation array/enum and add a Tracker entry following the existing pattern. The exact code depends on the current AppShell structure — look for where sections like "Issues", "Sessions", or "Kanban" are registered.

Add the import at the top:
```tsx
import { TrackerViewer } from '@/components/tracker'
```

Add a nav item in the sections list (using whatever shape the existing items use — if they are objects with `id`, `label`, `icon`, follow that pattern):
```tsx
{ id: 'tracker', label: 'Tracker', icon: <TrackerIcon /> }
```

Add the section render in the section switch/conditional:
```tsx
case 'tracker':
  return <TrackerViewer />
```

- [ ] **Step 2: Add TrackerIcon**

If a generic tracker/database icon doesn't exist in the icon set, use an inline SVG:
```tsx
function TrackerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-current">
      <rect x="2" y="2" width="12" height="3" rx="1" fill="currentColor" opacity="0.4"/>
      <rect x="2" y="6.5" width="12" height="3" rx="1" fill="currentColor" opacity="0.7"/>
      <rect x="2" y="11" width="12" height="3" rx="1" fill="currentColor"/>
    </svg>
  )
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd apps/desktop && npx tsc --noEmit && npm run lint
```

Expected: no errors

- [ ] **Step 4: Start dev server and verify**

```bash
cd apps/desktop && npm run dev:linux
```

Open the app, click the Tracker nav item. Verify:
- The TrackerViewer renders
- The config selector shows "No connections configured" (or your seeded config if the backend is running)
- No console errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/layout/AppShell.tsx
git commit -m "feat(app): add Tracker section to AppShell nav"
```

---

## Completion Check

```bash
cd apps/desktop && npx vitest run && npx tsc --noEmit
```

Expected: all tests pass, no type errors.

With backend running, open the Tracker section, add a Linear or Jira config via the backend API (until Settings UI is built in Plan 3), and verify items render in the browser + detail view.
