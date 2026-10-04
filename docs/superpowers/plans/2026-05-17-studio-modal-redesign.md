# Studio Modal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Studio from the sidebar navigation and surface it as a full-screen modal triggered from the KanbanBoard's "Create Task" button, with an internal project selector and a complete design-system reskin.

**Architecture:** Studio is promoted from a routed section to a modal overlay managed by a `studioModalOpen` flag in the UI slice. `StudioModal` wraps `StudioSection` (untouched logic) in a Dialog shell that owns project selection. KanbanBoard grows a "Create with AI" button that opens the modal via the store.

**Tech Stack:** React, Zustand (UI slice), Radix UI `Dialog`, `Button`/`CustomDropdown` design-system components, Tailwind CSS design tokens.

---

### Task 1: Remove STUDIO from sidebar navigation

**Files:**
- Modify: `apps/desktop/src/layout/sections.tsx`

- [ ] **Step 1: Write failing test for isSectionID not accepting 'STUDIO'**

```typescript
// apps/desktop/src/layout/sections.test.ts (NEW)
import { describe, it, expect } from 'vitest'
import { isSectionID, getSectionVisibility, sidebarItems } from './sections'

describe('sections', () => {
  it('STUDIO is not a valid SectionID', () => {
    expect(isSectionID('STUDIO')).toBe(false)
  })

  it('sidebarItems does not contain STUDIO', () => {
    expect(sidebarItems.find(i => i.id === 'STUDIO')).toBeUndefined()
  })

  it('getSectionVisibility does not have showStudio', () => {
    const vis = getSectionVisibility('CONSOLE')
    expect('showStudio' in vis).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/desktop && npx vitest run src/layout/sections.test.ts
```
Expected: FAIL — `isSectionID('STUDIO')` returns true currently.

- [ ] **Step 3: Edit `sections.tsx` to remove STUDIO**

Remove the `{ id: 'STUDIO', ... }` entry from `sidebarItems`.

Remove `'STUDIO'` from the `SectionID` union type.

Remove `'STUDIO'` from `SECTION_IDS`.

Remove `showStudio: boolean` from `SectionVisibility`.

Remove `showStudio: activeSection === 'STUDIO'` from `getSectionVisibility`.

Remove `STUDIO: { label: 'Authoring', title: 'Studio' }` from `sectionMeta`.

Also remove the `Sparkles` import if it becomes unused.

Full updated `sections.tsx`:

```tsx
import {
  Box,
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListTodo,
  Settings2,
  Terminal,
} from 'lucide-react'
import type { SidebarItem } from '@layout/types'

function SandboxIcon({ className, size }: { className?: string; size?: number }) {
  const s = size || 24
  return (
    <svg className={className} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 10h14l-1.5 9a1 1 0 0 1-1 .85H7.5a1 1 0 0 1-1-.85L5 10z" />
      <path d="M6 10l-.5-2.5A1 1 0 0 1 6.5 6h11a1 1 0 0 1 1 1.5L18 10" />
      <line x1="17" y1="2" x2="20" y2="8" />
      <path d="M19 7l2 1-1.5 2.5-2-1z" />
    </svg>
  )
}

export const sidebarItems: SidebarItem[] = [
  { id: 'CONSOLE', label: 'Development', description: 'Editor, terminals, and browser preview', icon: Terminal },
  { id: 'ISSUES', label: 'Tasks', description: 'Task board and inspector', icon: ListTodo },
  { id: 'PROJECTS', label: 'Projects', description: 'Local workspace grouping', icon: FolderTree },
  { id: 'AGENTS', label: 'Agents', description: 'Global agent configurations', icon: Cpu },
  { id: 'WAREHOUSE', label: 'Usage', description: 'Per-agent tokens, cost, and sessions', icon: Database },
  { id: 'SANDBOX', label: 'Remote', description: 'Remote code execution', icon: SandboxIcon },
  { id: 'DOCS', label: 'Documentation', description: 'User & engineering guides', icon: FileText },
  { id: 'SETTINGS', label: 'Settings', description: 'Backend profiles, integrations, notifications, and shortcuts', icon: Settings2 },
]

export type SectionID =
  | 'ISSUES'
  | 'PROJECTS'
  | 'AGENTS'
  | 'WAREHOUSE'
  | 'SANDBOX'
  | 'SETTINGS'
  | 'DOCS'
  | 'CONSOLE'

const SECTION_IDS: readonly SectionID[] = [
  'ISSUES',
  'PROJECTS',
  'AGENTS',
  'WAREHOUSE',
  'SANDBOX',
  'SETTINGS',
  'DOCS',
  'CONSOLE',
]

export function isSectionID(value: string): value is SectionID {
  return (SECTION_IDS as readonly string[]).includes(value)
}

export type SectionVisibility = {
  showIssueBoard: boolean
  showProjects: boolean
  showAgents: boolean
  showWarehouse: boolean
  showSandbox: boolean
  showSettings: boolean
  showDocs: boolean
  showConsole: boolean
}

const sectionMeta: Record<SectionID, { label: string; title: string }> = {
  ISSUES: { label: 'Tracker', title: 'Tasks' },
  PROJECTS: { label: 'Workspace', title: 'Projects' },
  AGENTS: { label: 'Compute', title: 'Agents' },
  WAREHOUSE: { label: 'Usage', title: 'Usage' },
  SANDBOX: { label: 'Compute', title: 'Remote Execution' },
  SETTINGS: { label: 'System', title: 'Settings' },
  DOCS: { label: 'Knowledge', title: 'Documentation' },
  CONSOLE: { label: 'Workspace', title: 'Development' },
}

export function getSectionVisibility(activeSection: SectionID): SectionVisibility {
  return {
    showIssueBoard: activeSection === 'ISSUES',
    showProjects: activeSection === 'PROJECTS',
    showAgents: activeSection === 'AGENTS',
    showWarehouse: activeSection === 'WAREHOUSE',
    showSandbox: activeSection === 'SANDBOX',
    showSettings: activeSection === 'SETTINGS',
    showDocs: activeSection === 'DOCS',
    showConsole: activeSection === 'CONSOLE',
  }
}

export function getCurrentSectionMeta(activeSection: SectionID): { label: string; title: string } {
  return sectionMeta[activeSection] ?? sectionMeta.ISSUES
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd apps/desktop && npx vitest run src/layout/sections.test.ts
```
Expected: PASS (3 tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/layout/sections.tsx apps/desktop/src/layout/sections.test.ts
git commit -m "feat(studio): remove Studio from sidebar navigation"
```

---

### Task 2: Add studioModalOpen to UI store

**Files:**
- Modify: `apps/desktop/src/core/store/types.ts`
- Modify: `apps/desktop/src/core/store/slices/ui.slice.ts`
- Modify: `apps/desktop/src/core/store/index.test.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/desktop/src/core/store/index.test.ts`, inside the "UI slice" describe block:

```typescript
it('exposes studioModalOpen initialized to false', () => {
  const { studioModalOpen } = useAppStore.getState()
  expect(studioModalOpen).toBe(false)
})

it('exposes setStudioModalOpen as a function', () => {
  const { setStudioModalOpen } = useAppStore.getState()
  expect(typeof setStudioModalOpen).toBe('function')
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/desktop && npx vitest run src/core/store/index.test.ts
```
Expected: FAIL — `studioModalOpen` is undefined.

- [ ] **Step 3: Add to UISlice type in `types.ts`**

In `apps/desktop/src/core/store/types.ts`, inside the `UISlice` interface, add after `agentHubPendingNav`:

```typescript
studioModalOpen: boolean

// ... (existing actions) ...
setStudioModalOpen: (open: boolean) => void
```

Full diff:
```typescript
// After: agentHubPendingNav: (() => void) | null
studioModalOpen: boolean

// After: requestAgentHubNav: (apply: () => void) => void
setStudioModalOpen: (open: boolean) => void
```

- [ ] **Step 4: Add state and action to ui.slice.ts**

In `apps/desktop/src/core/store/slices/ui.slice.ts`, add `studioModalOpen: false` to the state object (after `agentHubPendingNav: null`) and `setStudioModalOpen: (open) => set({ studioModalOpen: open })` to the actions (after `requestAgentHubNav`):

```typescript
// State — add after agentHubPendingNav: null
studioModalOpen: false,

// Actions — add after requestAgentHubNav
setStudioModalOpen: (open) => set({ studioModalOpen: open }),
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd apps/desktop && npx vitest run src/core/store/index.test.ts
```
Expected: PASS (all tests green including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/core/store/types.ts apps/desktop/src/core/store/slices/ui.slice.ts apps/desktop/src/core/store/index.test.ts
git commit -m "feat(studio): add studioModalOpen to UI store"
```

---

### Task 3: Redesign Studio components with design system

**Files:**
- Modify: `apps/desktop/src/features/studio/chat/ChatComposer.tsx`
- Modify: `apps/desktop/src/features/studio/chat/StudioChat.tsx`
- Modify: `apps/desktop/src/features/studio/draft/DraftPanel.tsx`
- Modify: `apps/desktop/src/features/studio/draft/fields/BasicsFields.tsx`
- Modify: `apps/desktop/src/features/studio/draft/fields/AcceptanceCriteria.tsx`
- Modify: `apps/desktop/src/features/studio/draft/fields/AgentGuidance.tsx`
- Modify: `apps/desktop/src/features/studio/draft/fields/ProviderPicker.tsx`

No new tests needed — these are visual changes; verify with dev server after wiring the modal (Task 4).

- [ ] **Step 1: Rewrite `ChatComposer.tsx`**

Replace all of `apps/desktop/src/features/studio/chat/ChatComposer.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@ui/button'

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="border-t border-border p-3 flex gap-2 items-end">
      <textarea
        rows={2}
        className="flex-1 bg-transparent border border-border rounded-md p-2 outline-none focus:border-ring resize-none text-sm placeholder:text-muted-foreground"
        placeholder="Describe what you want to task out… (Ctrl+Enter to send)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      />
      <Button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        size="sm"
      >
        Send
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `StudioChat.tsx`**

Replace all of `apps/desktop/src/features/studio/chat/StudioChat.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { ChatComposer } from './ChatComposer'
import type { ChatMessage } from './useStudioSession'

export function StudioChat({
  messages,
  onSend,
  sendDisabled,
  runner,
}: {
  messages: ChatMessage[]
  onSend: (text: string) => void
  sendDisabled?: boolean
  runner: string
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <h2 className="text-sm font-medium">Studio</h2>
        <span className="text-xs text-muted-foreground">via {runner}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Tell the agent what task you want to author. It can read your repo while it helps.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            {m.tool ? (
              <div className="inline-block text-xs bg-muted border border-border rounded px-2 py-1">
                <span className="text-muted-foreground">tool:</span> {m.tool.name}
              </div>
            ) : (
              <div
                className={`inline-block max-w-[80%] rounded-md p-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ChatComposer onSend={onSend} disabled={sendDisabled} />
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `BasicsFields.tsx`**

Replace all of `apps/desktop/src/features/studio/draft/fields/BasicsFields.tsx`:

```tsx
import type { StudioDraft } from '@core/api/client'

export function BasicsFields({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase text-muted-foreground">Title</span>
        <input
          className="bg-transparent border-b border-border px-1 py-1 outline-none focus:border-ring text-sm"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="What needs to happen?"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase text-muted-foreground">Description</span>
        <textarea
          rows={6}
          className="bg-transparent border border-border rounded-md p-2 outline-none focus:border-ring resize-y text-sm"
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Describe the task in markdown"
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `AcceptanceCriteria.tsx`**

Replace all of `apps/desktop/src/features/studio/draft/fields/AcceptanceCriteria.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@ui/button'
import type { StudioDraft } from '@core/api/client'

export function AcceptanceCriteria({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onChange({ acceptance_criteria: [...draft.acceptance_criteria, trimmed] })
    setInput('')
  }

  const remove = (i: number) => {
    onChange({ acceptance_criteria: draft.acceptance_criteria.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase text-muted-foreground">Acceptance criteria</div>
      <ul className="flex flex-col gap-1">
        {draft.acceptance_criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            <input type="checkbox" disabled className="mt-1 accent-primary" />
            <span className="flex-1 text-sm">{c}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove criterion ${i + 1}`}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-transparent border border-border rounded-md px-2 py-1 text-sm outline-none focus:border-ring"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add criterion…"
        />
        <Button type="button" onClick={add} size="sm" variant="outline">
          Add
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `AgentGuidance.tsx`**

Replace all of `apps/desktop/src/features/studio/draft/fields/AgentGuidance.tsx`:

```tsx
import type { StudioDraft } from '@core/api/client'

export function AgentGuidance({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase text-muted-foreground">Agent guidance</div>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 text-muted-foreground">Model</span>
        <input
          className="flex-1 bg-transparent border border-border rounded-md px-2 py-1 outline-none focus:border-ring"
          value={draft.suggested_model}
          onChange={(e) => onChange({ suggested_model: e.target.value })}
          placeholder="e.g. opus, sonnet"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 text-muted-foreground">Max turns</span>
        <input
          type="number"
          min={1}
          className="w-24 bg-transparent border border-border rounded-md px-2 py-1 outline-none focus:border-ring"
          value={draft.max_turns ?? ''}
          onChange={(e) => onChange({ max_turns: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 6: Rewrite `ProviderPicker.tsx` to use `CustomDropdown`**

Replace all of `apps/desktop/src/features/studio/draft/fields/ProviderPicker.tsx`:

```tsx
import { CustomDropdown } from '@layout/shared/controls'
import type { StudioDraft } from '@core/api/client'

const PROVIDERS = ['claude-code', 'codex', 'opencode', 'gemini'] as const

const PROVIDER_OPTIONS = [
  { label: '— orchestrator chooses —', value: '' },
  ...PROVIDERS.map((p) => ({ label: p, value: p })),
]

export function ProviderPicker({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase text-muted-foreground">Execution provider</span>
      <CustomDropdown
        value={draft.suggested_provider}
        options={PROVIDER_OPTIONS}
        onChange={(val) => onChange({ suggested_provider: val })}
      />
    </div>
  )
}
```

- [ ] **Step 7: Rewrite `DraftPanel.tsx`**

Replace all of `apps/desktop/src/features/studio/draft/DraftPanel.tsx`:

```tsx
import { Button } from '@ui/button'
import type { StudioDraft } from '@core/api/client'
import { AcceptanceCriteria } from './fields/AcceptanceCriteria'
import { AgentGuidance } from './fields/AgentGuidance'
import { Attachments } from './fields/Attachments'
import { BasicsFields } from './fields/BasicsFields'
import { ProviderPicker } from './fields/ProviderPicker'
import { TemplatePicker } from './fields/TemplatePicker'

export interface DraftPanelProps {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
  onPush: () => void
  onDiscard: () => void
  onBrowseTemplates?: () => void
  pushing?: boolean
  pushDisabledReason?: string
}

export function DraftPanel({ draft, onChange, onPush, onDiscard, onBrowseTemplates, pushing, pushDisabledReason }: DraftPanelProps) {
  return (
    <div className="h-full flex flex-col border-l border-border">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <h2 className="text-sm font-medium">Task draft</h2>
        <TemplatePicker draft={draft} onChange={onChange} onBrowse={onBrowseTemplates} />
        <Button type="button" onClick={onDiscard} variant="ghost" size="sm" className="ml-auto text-xs">
          Discard
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        <BasicsFields draft={draft} onChange={onChange} />
        <AcceptanceCriteria draft={draft} onChange={onChange} />
        <Attachments draft={draft} onChange={onChange} />
        <ProviderPicker draft={draft} onChange={onChange} />
        <AgentGuidance draft={draft} onChange={onChange} />
      </div>
      <div className="px-4 py-3 border-t border-border flex flex-col gap-1">
        {pushDisabledReason && <div className="text-xs text-yellow-500">{pushDisabledReason}</div>}
        <Button
          type="button"
          onClick={onPush}
          disabled={pushing || !!pushDisabledReason}
          className="w-full"
        >
          {pushing ? 'Pushing…' : '→ Push to backlog'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/features/studio/
git commit -m "refactor(studio): replace raw HTML with design system components"
```

---

### Task 4: Update StudioSection runner picker and toast

**Files:**
- Modify: `apps/desktop/src/features/studio/StudioSection.tsx`

- [ ] **Step 1: Rewrite `StudioSection.tsx`**

Replace the `StudioBody` inner component's runner `<select>` with `CustomDropdown`, replace the sky-colored toast button with a design-system `Button`, and replace the sky-colored error text:

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  applyStudioTemplate,
  createStudioSession,
  discardStudioSession,
  getStudioDraft,
  patchStudioDraft,
  pushStudioToBacklog,
  sendStudioMessage,
  studioEventsURL,
  type BackendConfig,
} from '@core/api/client'
import { Button } from '@ui/button'
import { CustomDropdown } from '@layout/shared/controls'
import { StudioChat } from './chat/StudioChat'
import { useStudioSession, type StudioSessionClient } from './chat/useStudioSession'
import { DraftPanel } from './draft/DraftPanel'
import { TemplateLibrary } from './templates/TemplateLibrary'
import { useTemplates } from './templates/useTemplates'

export interface StudioSectionProps {
  config: BackendConfig
  projectId: string
}

const RUNNERS = ['claude-code', 'codex', 'opencode', 'gemini']
const RUNNER_OPTIONS = RUNNERS.map((r) => ({ label: r, value: r }))

export function StudioSection({ config, projectId }: StudioSectionProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [runner, setRunner] = useState(RUNNERS[0])
  const [pushing, setPushing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const client = useMemo<StudioSessionClient>(
    () => ({
      studioEventsURL: (id) => studioEventsURL(config, id),
      getStudioDraft: (id) => getStudioDraft(config, id),
      sendStudioMessage: (id, m) => sendStudioMessage(config, id, m),
      patchStudioDraft: (id, p) => patchStudioDraft(config, id, p),
      pushStudioToBacklog: (id) => pushStudioToBacklog(config, id),
      discardStudioSession: (id) => discardStudioSession(config, id),
    }),
    [config],
  )

  useEffect(() => {
    if (sessionId) return
    let cancelled = false
    createStudioSession(config, { project_id: projectId, runner })
      .then((h) => {
        if (!cancelled) setSessionId(h.session_id)
      })
      .catch((err) => {
        if (!cancelled) setStartError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [config, projectId, runner, sessionId])

  if (startError) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to start studio session: {startError}
      </div>
    )
  }
  if (!sessionId) {
    return <div className="p-6 text-sm text-muted-foreground">Starting studio session…</div>
  }

  return (
    <StudioBody
      sessionId={sessionId}
      runner={runner}
      onRunnerChange={(r) => { setRunner(r); setSessionId(null) }}
      client={client}
      config={config}
      pushing={pushing}
      setPushing={setPushing}
      onPushed={(issueId) => { setToast(`Pushed to backlog: ${issueId}`); setSessionId(null) }}
      onDiscarded={() => setSessionId(null)}
      toast={toast}
      clearToast={() => setToast(null)}
    />
  )
}

function StudioBody({
  sessionId,
  runner,
  onRunnerChange,
  client,
  config,
  pushing,
  setPushing,
  onPushed,
  onDiscarded,
  toast,
  clearToast,
}: {
  sessionId: string
  runner: string
  onRunnerChange: (runner: string) => void
  client: StudioSessionClient
  config: BackendConfig
  pushing: boolean
  setPushing: (b: boolean) => void
  onPushed: (issueId: string) => void
  onDiscarded: () => void
  toast: string | null
  clearToast: () => void
}) {
  const { draft, messages, sendMessage, editDraft, push, discard } = useStudioSession(sessionId, client)
  const { templates, save: saveTemplate, remove: removeTemplate } = useTemplates(config)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const applyTemplate = async (name: string, vars: Record<string, string>) => {
    setTemplateError(null)
    try {
      await applyStudioTemplate(config, sessionId, name, vars)
      setLibraryOpen(false)
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err))
    }
  }

  const pushDisabledReason = !draft
    ? 'Loading draft…'
    : !draft.title.trim()
      ? 'Title required'
      : !draft.description.trim()
        ? 'Description required'
        : undefined

  const handlePush = async () => {
    setPushing(true)
    try {
      const { issue_id } = await push()
      onPushed(issue_id)
    } finally {
      setPushing(false)
    }
  }

  const handleDiscard = async () => {
    await discard()
    onDiscarded()
  }

  return (
    <div className="h-full flex relative">
      <div className="flex-[1.4] min-w-0 flex flex-col">
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Runner</span>
          <div className="w-36">
            <CustomDropdown
              value={runner}
              options={RUNNER_OPTIONS}
              onChange={onRunnerChange}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <StudioChat messages={messages} onSend={sendMessage} runner={runner} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {draft && (
          <DraftPanel
            draft={draft}
            onChange={editDraft}
            onPush={handlePush}
            onDiscard={handleDiscard}
            onBrowseTemplates={() => setLibraryOpen(true)}
            pushing={pushing}
            pushDisabledReason={pushDisabledReason}
          />
        )}
      </div>
      {libraryOpen && (
        <TemplateLibrary
          templates={templates}
          onApply={applyTemplate}
          onSave={saveTemplate}
          onDelete={removeTemplate}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {templateError && (
        <div className="absolute bottom-16 right-4 bg-destructive text-destructive-foreground text-xs px-3 py-2 rounded shadow max-w-sm">
          {templateError}
        </div>
      )}
      {toast && (
        <Button
          type="button"
          onClick={clearToast}
          className="absolute bottom-4 right-4 shadow"
          size="sm"
        >
          {toast}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/features/studio/StudioSection.tsx
git commit -m "refactor(studio): use design system in StudioSection runner picker and toasts"
```

---

### Task 5: Create StudioModal component

**Files:**
- Create: `apps/desktop/src/features/studio/StudioModal.tsx`
- Modify: `apps/desktop/src/features/studio/index.ts`

- [ ] **Step 1: Create `StudioModal.tsx`**

```tsx
// apps/desktop/src/features/studio/StudioModal.tsx
import { lazy, Suspense, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@ui/dialog'
import { ProjectSelector } from '@layout/shared/controls'
import { useAppStore } from '@core/store'
import type { BackendConfig } from '@core/api/client'
import type { Project } from '@core/api/types'

const StudioSection = lazy(() => import('./StudioSection').then(m => ({ default: m.StudioSection })))

const SectionLoader = () => (
  <div className="flex-1 grid place-items-center text-muted-foreground text-sm">Starting session…</div>
)

export function StudioModal({
  config,
  projects,
}: {
  config: BackendConfig | null
  projects: Project[]
}) {
  const open = useAppStore(s => s.studioModalOpen)
  const setOpen = useAppStore(s => s.setStudioModalOpen)
  const storeProjectId = useAppStore(s => s.selectedProjectID)

  // Local project override — lets the user change project inside the modal
  // without affecting the global selectedProjectID selection.
  const [localProjectId, setLocalProjectId] = useState<string | null>(null)
  const projectId = localProjectId ?? storeProjectId ?? ''

  const handleOpenChange = (next: boolean) => {
    if (!next) setLocalProjectId(null)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!fixed !inset-0 !translate-x-0 !translate-y-0 !left-0 !top-0 !max-w-none w-full h-full overflow-hidden flex flex-col p-0 rounded-none border-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Studio — Author a task with AI</DialogTitle>
          <DialogDescription>Chat with an agent to draft and push a task to the backlog.</DialogDescription>
        </DialogHeader>

        {/* Modal toolbar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-background">
          <span className="text-sm font-semibold">Studio</span>
          <div className="w-52">
            <ProjectSelector
              value={projectId}
              projects={projects}
              onChange={setLocalProjectId}
              direction="down"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => handleOpenChange(false)}
            aria-label="Close Studio"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {!config ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8">
              No backend configured. Connect to a backend in Settings first.
            </div>
          ) : !projectId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8">
              Select a project above to begin.
            </div>
          ) : (
            <Suspense fallback={<SectionLoader />}>
              <StudioSection config={config} projectId={projectId} />
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Export from `studio/index.ts`**

Replace `apps/desktop/src/features/studio/index.ts`:

```typescript
export { StudioSection } from './StudioSection'
export type { StudioSectionProps } from './StudioSection'
export { StudioModal } from './StudioModal'
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/studio/StudioModal.tsx apps/desktop/src/features/studio/index.ts
git commit -m "feat(studio): add StudioModal full-screen dialog component"
```

---

### Task 6: Wire StudioModal into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Replace StudioSection lazy import with StudioModal**

In `App.tsx`, remove:
```typescript
const StudioSection = lazy(() => import('@features/studio').then(m => ({ default: m.StudioSection })))
```

Add (not lazy — StudioModal owns its own lazy-loaded StudioSection internally):
```typescript
import { StudioModal } from '@features/studio'
```

- [ ] **Step 2: Remove the `showStudio` section block**

Remove the entire block:
```tsx
{sectionVisibility.showStudio ? (
  <SectionErrorBoundary name="Studio">
    <section className="flex-1 flex flex-col min-h-0">
      <Suspense fallback={<SectionLoader />}>
        {config && selectedProjectID ? (
          <StudioSection config={config} projectId={selectedProjectID} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <p className="text-sm text-muted-foreground">Select a project to open the studio.</p>
            {projects.length > 0 && (
              <div className="border border-border/40 rounded-lg bg-card/50">
                <ProjectSelector
                  value={selectedProjectID ?? ''}
                  projects={projects}
                  onChange={(id) => useAppStore.getState().setSelectedProjectID(id)}
                  direction="down"
                />
              </div>
            )}
          </div>
        )}
      </Suspense>
    </section>
  </SectionErrorBoundary>
) : null}
```

- [ ] **Step 3: Add `<StudioModal>` next to `<AppDialogs>`**

Find the `<AppDialogs ... />` JSX in the return. Add `<StudioModal>` directly below it:

```tsx
<AppDialogs
  config={config}
  {/* ...existing props... */}
/>
<StudioModal config={config} projects={projects} />
```

- [ ] **Step 4: Remove unused imports from App.tsx**

If `ProjectSelector` is now only used in StudioModal (no longer used in App.tsx itself after the studio block is removed), remove it from App.tsx imports. Also remove `SectionErrorBoundary` usage check — it's still used by other sections so leave it.

- [ ] **Step 5: Remove `showStudio` from sectionVisibility destructure**

Find where `sectionVisibility` is destructured or used and remove any `showStudio` reference.

- [ ] **Step 6: TypeCheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(studio): mount StudioModal in App, remove Studio sidebar section"
```

---

### Task 7: Wire Studio trigger from KanbanBoard

**Files:**
- Modify: `apps/desktop/src/features/kanban/KanbanBoard.tsx`

The "Create Task" button stays as-is (opens the regular `CreateTaskDialog` via `onCreateIssue`). We add a secondary "Create with AI" button next to it that opens StudioModal.

- [ ] **Step 1: Add import and button in `KanbanBoard.tsx`**

Add `Sparkles` to the existing lucide-react import at the top:
```typescript
import { ..., Sparkles } from 'lucide-react'
```

Add `useAppStore` import if not already present (it is at line 34).

- [ ] **Step 2: Add "AI" button next to Create Task**

In the toolbar section (around line 452–458, next to the `Create Task` button), add:

```tsx
<button
  onClick={() => useAppStore.getState().setStudioModalOpen(true)}
  className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-card hover:bg-muted text-[12px] font-medium tracking-tight transition-colors text-foreground"
>
  <Sparkles size={13} />
  Create with AI
</button>
```

Place it immediately after the existing `Create Task` button.

- [ ] **Step 3: TypeCheck and lint**

```bash
cd apps/desktop && npx tsc --noEmit && npm run lint
```
Expected: 0 errors and 0 lint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/kanban/KanbanBoard.tsx
git commit -m "feat(studio): add 'Create with AI' button to KanbanBoard that opens StudioModal"
```

---

### Task 8: Clean up store test and run full test suite

**Files:**
- Modify: `apps/desktop/src/core/store/index.test.ts`

The store test checks for `showStudio` visibility via `getSectionVisibility` (imported from sections). Now that STUDIO is removed from `SectionID`, if any test previously navigated to STUDIO it will now be a type error.

- [ ] **Step 1: Audit and fix the store test**

Check `index.test.ts` for any `'STUDIO'` references:
```bash
grep -n "STUDIO\|showStudio" apps/desktop/src/core/store/index.test.ts
```

If any are found, replace `'STUDIO'` with `'AGENTS'` (a valid section). The test at line 176 uses `'AGENTS'` already, so only update any explicit `'STUDIO'` if found.

- [ ] **Step 2: Run full test suite**

```bash
cd apps/desktop && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit if any changes were made**

```bash
git add apps/desktop/src/core/store/index.test.ts
git commit -m "test(studio): remove STUDIO section references from store tests"
```

---

### Self-Review

**Spec coverage:**
- ✅ Remove Studio sidebar tab — Task 1
- ✅ Modal triggered from task board — Tasks 5, 6, 7
- ✅ Project selector inside modal — Task 5 (`StudioModal` owns `ProjectSelector`)
- ✅ Design system reskin — Tasks 3, 4
- ✅ Store state for modal open/close — Task 2
- ✅ Test suite stays green — Task 8

**Placeholder scan:** No TBD, TODO, or incomplete sections. Every step includes exact code.

**Type consistency:**
- `studioModalOpen: boolean` / `setStudioModalOpen: (open: boolean) => void` — consistent across `types.ts`, `ui.slice.ts`, and `StudioModal.tsx`
- `StudioSectionProps.projectId: string` — unchanged; modal passes a resolved string, never undefined
- `RUNNER_OPTIONS` replaces inline `RUNNERS` map — consistent in `StudioSection.tsx`
- `CustomDropdown` props: `value`, `options: {label, value}[]`, `onChange` — consistent with existing `controls.tsx` usage
