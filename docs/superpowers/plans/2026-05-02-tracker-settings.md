# Settings Overhaul + Connections Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal existing Settings with a full multi-section Settings overlay (Connections, Agents, Workspace, Appearance, Integrations, About) and implement the Connections page for managing tracker integrations including OAuth flow.

**Architecture:** Settings opens as a full-page overlay using the AppShell section routing pattern. Each section is a lazy-loaded React component. The Connections page uses a card-per-connection layout with an edit drawer. OAuth flow triggers an Electron `BrowserWindow` via the existing `window.orchestraDesktop` IPC bridge. Per-project tracker assignment lives on the Project detail page.

**Prerequisite:** Backend Plan must be complete (tracker config endpoints exist). Viewer Plan must be complete (WorkItem types and API client functions exist).

**Tech Stack:** React 19, TypeScript, Tailwind v4, Electron IPC via `window.orchestraDesktop`.

---

## File Map

**New files:**
- `apps/desktop/src/components/settings/SettingsShell.tsx` — full-page overlay with left nav
- `apps/desktop/src/components/settings/sections/ConnectionsPage.tsx` — tracker connection cards
- `apps/desktop/src/components/settings/sections/ConnectionDrawer.tsx` — edit/add connection form
- `apps/desktop/src/components/settings/sections/AgentsPage.tsx` — restructured agents config
- `apps/desktop/src/components/settings/sections/WorkspacePage.tsx` — workspace config
- `apps/desktop/src/components/settings/sections/AppearancePage.tsx` — theme/density controls
- `apps/desktop/src/components/settings/sections/IntegrationsPage.tsx` — MCP servers, webhooks
- `apps/desktop/src/components/settings/sections/AboutPage.tsx` — version info
- `apps/desktop/src/components/settings/index.ts` — barrel export
- `apps/desktop/electron/oauth-handler.cjs` — Electron OAuth BrowserWindow + protocol handler

**Modified files:**
- `apps/desktop/src/app/layout/AppShell.tsx` — add Settings trigger + overlay
- `apps/desktop/electron/preload.cjs` — expose `openOAuthWindow` via `window.orchestraDesktop`
- `apps/desktop/electron/main.cjs` — register `orchestra://` protocol + IPC handler

---

### Task 1: Settings shell

**Files:**
- Create: `apps/desktop/src/components/settings/SettingsShell.tsx`

- [ ] **Step 1: Implement SettingsShell**

```tsx
// apps/desktop/src/components/settings/SettingsShell.tsx
import { lazy, Suspense, useState } from 'react'

type SettingsSection = 'connections' | 'agents' | 'workspace' | 'appearance' | 'integrations' | 'about'

const ConnectionsPage = lazy(() => import('./sections/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })))
const AgentsPage = lazy(() => import('./sections/AgentsPage').then(m => ({ default: m.AgentsPage })))
const WorkspacePage = lazy(() => import('./sections/WorkspacePage').then(m => ({ default: m.WorkspacePage })))
const AppearancePage = lazy(() => import('./sections/AppearancePage').then(m => ({ default: m.AppearancePage })))
const IntegrationsPage = lazy(() => import('./sections/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })))
const AboutPage = lazy(() => import('./sections/AboutPage').then(m => ({ default: m.AboutPage })))

const NAV_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'about', label: 'About' },
]

interface Props {
  onClose: () => void
  initialSection?: SettingsSection
}

export function SettingsShell({ onClose, initialSection = 'connections' }: Props) {
  const [active, setActive] = useState<SettingsSection>(initialSection)

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <span className="font-semibold text-base">Settings</span>
        <button
          onClick={onClose}
          className="text-muted hover:text-foreground transition-colors text-sm px-2 py-1 rounded hover:bg-surface-2"
        >
          Close ✕
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left nav */}
        <nav className="w-48 flex-shrink-0 border-r border-border py-4 px-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`w-full text-left px-3 py-2 text-sm rounded transition-colors ${
                active === item.id
                  ? 'bg-surface-2 text-foreground font-medium'
                  : 'text-muted hover:text-foreground hover:bg-surface-2'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
            {active === 'connections' && <ConnectionsPage />}
            {active === 'agents' && <AgentsPage />}
            {active === 'workspace' && <WorkspacePage />}
            {active === 'appearance' && <AppearancePage />}
            {active === 'integrations' && <IntegrationsPage />}
            {active === 'about' && <AboutPage />}
          </Suspense>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create placeholder section stubs** (to be filled in subsequent tasks)

Create these minimal files so `SettingsShell` compiles:

```tsx
// apps/desktop/src/components/settings/sections/AgentsPage.tsx
export function AgentsPage() {
  return <div className="text-sm text-muted">Agents configuration — coming soon</div>
}
```

```tsx
// apps/desktop/src/components/settings/sections/WorkspacePage.tsx
export function WorkspacePage() {
  return <div className="text-sm text-muted">Workspace configuration — coming soon</div>
}
```

```tsx
// apps/desktop/src/components/settings/sections/AppearancePage.tsx
export function AppearancePage() {
  return <div className="text-sm text-muted">Appearance — coming soon</div>
}
```

```tsx
// apps/desktop/src/components/settings/sections/IntegrationsPage.tsx
export function IntegrationsPage() {
  return <div className="text-sm text-muted">Integrations — coming soon</div>
}
```

```tsx
// apps/desktop/src/components/settings/sections/AboutPage.tsx
export function AboutPage() {
  return <div className="text-sm text-muted">Orchestra — version info coming soon</div>
}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/settings/
git commit -m "feat(settings): add SettingsShell with section nav and lazy-loaded pages"
```

---

### Task 2: Wire Settings into AppShell

**Files:**
- Modify: `apps/desktop/src/app/layout/AppShell.tsx`

- [ ] **Step 1: Add Settings trigger and overlay to AppShell**

Open `apps/desktop/src/app/layout/AppShell.tsx`. Add:

```tsx
import { useState } from 'react'
import { SettingsShell } from '@/components/settings'
```

Add state:
```tsx
const [settingsOpen, setSettingsOpen] = useState(false)
```

Add a gear/settings button to the nav (in the bottom of the sidebar or wherever the nav currently has auxiliary controls):
```tsx
<button
  onClick={() => setSettingsOpen(true)}
  className="text-muted hover:text-foreground transition-colors p-2 rounded hover:bg-surface-2"
  title="Settings"
>
  ⚙
</button>
```

Add the overlay render (at the root of the component return, outside the layout grid):
```tsx
{settingsOpen && <SettingsShell onClose={() => setSettingsOpen(false)} />}
```

- [ ] **Step 2: Typecheck and start dev server**

```bash
cd apps/desktop && npx tsc --noEmit
cd apps/desktop && npm run dev:linux
```

Click the gear icon — verify Settings overlay opens, sections switch in the left nav, Close button works.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/app/layout/AppShell.tsx
git commit -m "feat(app): wire Settings overlay into AppShell"
```

---

### Task 3: Connections page — card list

**Files:**
- Create: `apps/desktop/src/components/settings/sections/ConnectionsPage.tsx`

- [ ] **Step 1: Implement ConnectionsPage**

```tsx
// apps/desktop/src/components/settings/sections/ConnectionsPage.tsx
import { useState, useEffect } from 'react'
import { listTrackerConfigs, deleteTrackerConfig, testTrackerConfig } from '@/lib/orchestra-client'
import type { TrackerConfig } from '@/entities/tracker/types'
import { ConnectionDrawer } from '../ConnectionDrawer'

const SOURCE_COLOR: Record<string, string> = {
  linear: 'bg-violet-500',
  jira: 'bg-blue-500',
  github: 'bg-gray-500',
  sqlite: 'bg-green-500',
}

export function ConnectionsPage() {
  const [configs, setConfigs] = useState<TrackerConfig[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TrackerConfig | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'error' | 'loading'>>({})

  const load = () => listTrackerConfigs().then(setConfigs)

  useEffect(() => { load() }, [])

  const handleTest = async (cfg: TrackerConfig) => {
    setTestResults((r) => ({ ...r, [cfg.id]: 'loading' }))
    const result = await testTrackerConfig(cfg.id)
    setTestResults((r) => ({ ...r, [cfg.id]: result.ok ? 'ok' : 'error' }))
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this connection?')) return
    await deleteTrackerConfig(id)
    load()
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold">Connections</h2>
          <p className="text-sm text-muted mt-0.5">Manage tracker integrations for your projects</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setDrawerOpen(true) }}
          className="text-sm px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          + Add connection
        </button>
      </div>

      {configs.length === 0 && (
        <div className="text-sm text-muted border border-dashed border-border rounded-lg p-8 text-center">
          No connections yet. Add a Linear, Jira, or GitHub connection to get started.
        </div>
      )}

      <div className="space-y-2">
        {configs.map((cfg) => {
          const testState = testResults[cfg.id]
          return (
            <div
              key={cfg.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-1"
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${SOURCE_COLOR[cfg.type] ?? 'bg-gray-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{cfg.displayName}</div>
                <div className="text-xs text-muted truncate">{cfg.type} · {cfg.endpoint || 'no endpoint'}</div>
              </div>
              {testState === 'ok' && <span className="text-xs text-green-400">✓ Connected</span>}
              {testState === 'error' && <span className="text-xs text-red-400">✗ Error</span>}
              {testState === 'loading' && <span className="text-xs text-muted">Testing…</span>}
              <button
                onClick={() => handleTest(cfg)}
                className="text-xs text-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface-2 transition-colors"
              >
                Test
              </button>
              <button
                onClick={() => { setEditTarget(cfg); setDrawerOpen(true) }}
                className="text-xs text-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface-2 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(cfg.id)}
                className="text-xs text-red-400/70 hover:text-red-400 px-2 py-1 rounded hover:bg-surface-2 transition-colors"
              >
                Delete
              </button>
            </div>
          )
        })}
      </div>

      {drawerOpen && (
        <ConnectionDrawer
          existing={editTarget}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => { setDrawerOpen(false); load() }}
        />
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
git add apps/desktop/src/components/settings/sections/ConnectionsPage.tsx
git commit -m "feat(settings): add Connections page with card list and test-connection"
```

---

### Task 4: Connection edit drawer

**Files:**
- Create: `apps/desktop/src/components/settings/ConnectionDrawer.tsx`

- [ ] **Step 1: Implement ConnectionDrawer**

```tsx
// apps/desktop/src/components/settings/ConnectionDrawer.tsx
import { useState } from 'react'
import { createTrackerConfig, updateTrackerConfig } from '@/lib/orchestra-client'
import type { TrackerConfig } from '@/entities/tracker/types'

interface Props {
  existing: TrackerConfig | null
  onClose: () => void
  onSaved: () => void
}

const TRACKER_TYPES = [
  { value: 'linear', label: 'Linear' },
  { value: 'jira', label: 'Jira' },
  { value: 'github', label: 'GitHub' },
  { value: 'sqlite', label: 'SQLite (local)' },
]

export function ConnectionDrawer({ existing, onClose, onSaved }: Props) {
  const [type, setType] = useState(existing?.type ?? 'linear')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '')
  const [authMethod, setAuthMethod] = useState(existing?.authMethod ?? 'apikey')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!displayName.trim()) { setError('Display name is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await updateTrackerConfig(existing.id, {
          displayName: displayName.trim(),
          endpoint: endpoint.trim(),
          token: token || undefined,
        })
      } else {
        await createTrackerConfig({
          type,
          displayName: displayName.trim(),
          endpoint: endpoint.trim(),
          authMethod,
          token,
        })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const endpointLabel: Record<string, string> = {
    linear: 'Team Key (e.g. ENG)',
    jira: 'Base URL (e.g. https://myorg.atlassian.net)',
    github: 'Owner/Repo (e.g. owner/repo)',
    sqlite: '',
  }
  const tokenLabel: Record<string, string> = {
    linear: 'Linear API Key',
    jira: 'Personal Access Token',
    github: 'GitHub Token',
    sqlite: '',
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-60 bg-black/40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-60 w-96 bg-background border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">{existing ? 'Edit Connection' : 'Add Connection'}</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground text-sm">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Type */}
          {!existing && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Provider</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full text-sm bg-surface-2 border border-border rounded px-3 py-2 focus:outline-none"
              >
                {TRACKER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Display name */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Linear Engineering"
              className="w-full text-sm bg-surface-2 border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Endpoint */}
          {endpointLabel[type] && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">{endpointLabel[type]}</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full text-sm bg-surface-2 border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          {/* Auth method */}
          {!existing && type !== 'sqlite' && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Auth Method</label>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    value="apikey"
                    checked={authMethod === 'apikey'}
                    onChange={() => setAuthMethod('apikey')}
                  />
                  API Key / PAT
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    value="oauth"
                    checked={authMethod === 'oauth'}
                    onChange={() => setAuthMethod('oauth')}
                  />
                  OAuth
                </label>
              </div>
            </div>
          )}

          {/* Token input (API key mode) */}
          {authMethod === 'apikey' && type !== 'sqlite' && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {tokenLabel[type] ?? 'Token'} {existing && '(leave blank to keep current)'}
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={existing ? '••••••••' : 'Paste token…'}
                className="w-full text-sm bg-surface-2 border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent font-mono"
              />
            </div>
          )}

          {/* OAuth button */}
          {authMethod === 'oauth' && (
            <div>
              <button
                onClick={() => {
                  // Triggers Electron OAuth flow — implemented in Task 5
                  window.orchestraDesktop?.openOAuthWindow?.(type)
                    .then((accessToken: string) => setToken(accessToken))
                    .catch((err: Error) => setError(err.message))
                }}
                className="w-full text-sm px-3 py-2 rounded border border-border hover:bg-surface-2 transition-colors"
              >
                Authorize with {TRACKER_TYPES.find(t => t.value === type)?.label} →
              </button>
              {token && <p className="text-xs text-green-400 mt-1">✓ Token received</p>}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded border border-border hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Add Connection'}
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/settings/ConnectionDrawer.tsx
git commit -m "feat(settings): add ConnectionDrawer with API key and OAuth auth modes"
```

---

### Task 5: OAuth flow (Electron)

**Files:**
- Create: `apps/desktop/electron/oauth-handler.cjs`
- Modify: `apps/desktop/electron/main.cjs`
- Modify: `apps/desktop/electron/preload.cjs`

- [ ] **Step 1: Create oauth-handler.cjs**

```js
// apps/desktop/electron/oauth-handler.cjs
'use strict'

const { BrowserWindow, protocol, ipcMain } = require('electron')

const OAUTH_CONFIGS = {
  linear: {
    authUrl: 'https://linear.app/oauth/authorize',
    params: {
      client_id: process.env.LINEAR_CLIENT_ID || '',
      redirect_uri: 'orchestra://oauth/linear/callback',
      response_type: 'code',
      scope: 'read write',
    },
    tokenUrl: 'https://api.linear.app/oauth/token',
  },
  jira: {
    authUrl: 'https://auth.atlassian.com/authorize',
    params: {
      client_id: process.env.JIRA_CLIENT_ID || '',
      redirect_uri: 'orchestra://oauth/jira/callback',
      response_type: 'code',
      scope: 'read:jira-work write:jira-work',
      audience: 'api.atlassian.com',
    },
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
  },
}

/**
 * Opens an OAuth BrowserWindow for the given provider and resolves with
 * the access token once the user completes the flow.
 * @param {string} provider - 'linear' | 'jira'
 * @returns {Promise<string>} access token
 */
async function openOAuthWindow(provider) {
  const cfg = OAUTH_CONFIGS[provider]
  if (!cfg) throw new Error(`Unknown OAuth provider: ${provider}`)

  const params = new URLSearchParams(cfg.params)
  const authUrl = `${cfg.authUrl}?${params.toString()}`

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 600,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    win.loadURL(authUrl)

    win.on('closed', () => reject(new Error('OAuth window closed before completing')))

    // Intercept the custom protocol redirect
    const handler = (request) => {
      const url = new URL(request.url)
      if (!url.hostname.startsWith('oauth')) return
      const code = url.searchParams.get('code')
      if (!code) { win.close(); reject(new Error('No code in redirect')); return }

      exchangeCodeForToken(cfg.tokenUrl, code, cfg.params.redirect_uri, cfg.params.client_id)
        .then((token) => { win.close(); resolve(token) })
        .catch((err) => { win.close(); reject(err) })
    }

    protocol.handle('orchestra', handler)
    win.on('closed', () => protocol.unhandle('orchestra'))
  })
}

async function exchangeCodeForToken(tokenUrl, code, redirectUri, clientId) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri, client_id: clientId, grant_type: 'authorization_code' }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

function registerOAuthIPC() {
  ipcMain.handle('orchestra:oauth', (_event, provider) => openOAuthWindow(provider))
}

module.exports = { registerOAuthIPC }
```

- [ ] **Step 2: Register OAuth IPC in main.cjs**

Open `apps/desktop/electron/main.cjs`. Find where other IPC handlers are registered (look for `ipcMain.handle` calls) and add:

```js
const { registerOAuthIPC } = require('./oauth-handler.cjs')
// Inside app.whenReady() or wherever other handlers are registered:
registerOAuthIPC()
```

Also register the `orchestra://` protocol before `app.whenReady()`:

```js
const { protocol } = require('electron')
// Before app.whenReady():
protocol.registerSchemesAsPrivileged([
  { scheme: 'orchestra', privileges: { standard: true, secure: true } }
])
```

- [ ] **Step 3: Expose openOAuthWindow in preload.cjs**

Open `apps/desktop/electron/preload.cjs`. Find where `window.orchestraDesktop` is defined via `contextBridge.exposeInMainWorld`. Add:

```js
openOAuthWindow: (provider) => ipcRenderer.invoke('orchestra:oauth', provider),
```

- [ ] **Step 4: Add openOAuthWindow type to window.orchestraDesktop**

Find the TypeScript declaration for `window.orchestraDesktop` (likely in `src/types/electron.d.ts` or similar). Add:

```ts
openOAuthWindow?: (provider: string) => Promise<string>
```

- [ ] **Step 5: Build check**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/oauth-handler.cjs apps/desktop/electron/main.cjs \
  apps/desktop/electron/preload.cjs
git commit -m "feat(electron): add OAuth BrowserWindow flow for Linear and Jira"
```

---

### Task 6: Per-project tracker assignment

**Files:**
- Modify: existing Project settings or detail view (find via `grep -r "project_id\|ProjectID\|projectId" apps/desktop/src --include="*.tsx" -l`)

- [ ] **Step 1: Find the project detail/settings component**

```bash
grep -r "project.*settings\|ProjectSettings\|project_id" apps/desktop/src --include="*.tsx" -l | head -10
```

Open the most relevant file. Look for where project metadata (name, remote URL, GitHub config) is displayed or edited.

- [ ] **Step 2: Add tracker assignment dropdown**

In the project settings/detail component, add state and fetch logic:

```tsx
import { useState, useEffect } from 'react'
import { listTrackerConfigs, setProjectTracker } from '@/lib/orchestra-client'
import type { TrackerConfig } from '@/entities/tracker/types'

// Inside the component:
const [trackerConfigs, setTrackerConfigs] = useState<TrackerConfig[]>([])
const [selectedConfigId, setSelectedConfigId] = useState<string>('')

useEffect(() => {
  listTrackerConfigs().then(setTrackerConfigs)
}, [])

const handleTrackerChange = async (configId: string) => {
  setSelectedConfigId(configId)
  await setProjectTracker(project.id, configId)
}
```

Add the UI (in the project settings form section):

```tsx
<div>
  <label className="block text-xs font-medium text-muted mb-1">Issue Tracker</label>
  <select
    value={selectedConfigId}
    onChange={(e) => handleTrackerChange(e.target.value)}
    className="w-full text-sm bg-surface-2 border border-border rounded px-3 py-2 focus:outline-none"
  >
    <option value="">None (use default)</option>
    {trackerConfigs.map((c) => (
      <option key={c.id} value={c.id}>{c.displayName}</option>
    ))}
  </select>
  <p className="text-xs text-muted mt-1">Agents dispatched on this project will pull issues from this tracker.</p>
</div>
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd apps/desktop && npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(projects): add per-project tracker assignment dropdown"
```

---

### Task 7: Create barrel and final wiring

**Files:**
- Create: `apps/desktop/src/components/settings/index.ts`

- [ ] **Step 1: Create barrel**

```ts
// apps/desktop/src/components/settings/index.ts
export { SettingsShell } from './SettingsShell'
export { ConnectionDrawer } from './ConnectionDrawer'
```

- [ ] **Step 2: Run full test suite**

```bash
cd apps/desktop && npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: all pass

- [ ] **Step 3: Start dev server and walk the Settings flow**

```bash
cd apps/desktop && npm run dev:linux
```

Verify:
1. Gear icon opens Settings overlay
2. Connections section shows "No connections" empty state
3. "Add connection" opens the drawer
4. Filling in Linear + API key and saving creates a new card
5. "Test" button returns connected/error status
6. Close button dismisses the overlay
7. Tracker section in AppShell now shows the new connection in the selector

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/settings/index.ts
git commit -m "feat(settings): finalize Settings system with Connections page and OAuth flow"
```

---

## Completion Check

```bash
cd apps/desktop && npx vitest run && npx tsc --noEmit
cd apps/backend && go test -race ./...
```

All pass. Settings overlay navigates all six sections. Connections page can create, edit, test, and delete tracker connections. OAuth flow opens a BrowserWindow and returns a token. Per-project tracker dropdown saves via API. Tracker viewer reflects connections added through Settings.
