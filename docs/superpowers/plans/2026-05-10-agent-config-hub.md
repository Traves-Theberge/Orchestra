# Agent Config Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Agents Dashboard into an editorial, consistent configuration hub with a narrative Overview, side-by-side Global vs Project comparison, and three standardized panel archetypes.

**Architecture:** Build a small library of shared primitives (header, footer, scope toggle, project selector, inheritance indicators, empty/error states), then refactor every panel to consume them. Add a new Overview panel per provider as the landing screen. All existing data hooks (`useClaudeConfig`, `useCodexConfig`, etc.) stay unchanged — this is purely a presentation refactor.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest, Monaco (`@monaco-editor/react`), Zustand store, existing CustomDropdown component from `@layout/shared/controls`.

**Spec:** `docs/superpowers/specs/2026-05-10-agent-config-hub-design.md`

---

## File Structure

```
apps/desktop/src/features/agents/
├── AgentsDashboard.tsx                  (modified — shell + overview routing)
├── AgentsDashboard.test.tsx             (modified — new assertions)
├── constants.ts                         (modified — add 'overview' CategoryId)
├── types.ts                             (modified — add 'overview' to CategoryId union)
├── tokens.ts                            NEW — design system constants
├── tokens.test.ts                       NEW
├── components/                          NEW directory
│   ├── PanelHeader.tsx                  NEW
│   ├── PanelHeader.test.tsx             NEW
│   ├── PanelFooter.tsx                  NEW
│   ├── PanelFooter.test.tsx             NEW
│   ├── ScopeToggle.tsx                  NEW
│   ├── ScopeToggle.test.tsx             NEW
│   ├── ProjectSelector.tsx              NEW
│   ├── ProjectSelector.test.tsx         NEW
│   ├── EmptyStateCard.tsx               NEW
│   ├── ErrorStrip.tsx                   NEW
│   ├── ErrorStrip.test.tsx              NEW
│   ├── InheritedField.tsx               NEW
│   ├── InheritedField.test.tsx          NEW
│   ├── OverviewRow.tsx                  NEW
│   └── OverviewRow.test.tsx             NEW
└── panels/
    ├── OverviewPanel.tsx                NEW
    ├── OverviewPanel.test.tsx           NEW
    ├── SettingsPanel.tsx                (refactor → Archetype A canonical)
    ├── InstructionsPanel.tsx            (refactor → Archetype B canonical)
    ├── SkillsPanel.tsx                  (refactor → Archetype C canonical)
    ├── HooksPanel.tsx                   (apply Archetype A)
    ├── PermissionsPanel.tsx             (apply Archetype A)
    ├── MCPPanel.tsx                     (apply Archetype C)
    ├── RulesPanel.tsx                   (apply Archetype C)
    ├── SubAgentsPanel.tsx               (apply Archetype C)
    ├── CodexConfigPanel.tsx             (apply Archetype A)
    ├── CodexModelPanel.tsx              (apply Archetype A)
    ├── CodexInstructionsPanel.tsx       (apply Archetype B)
    ├── CodexApprovalsPanel.tsx          (apply Archetype A)
    ├── CodexEnvironmentPanel.tsx        (apply Archetype A)
    ├── CodexProfilesPanel.tsx           (apply Archetype C)
    ├── CodexSubAgentsPanel.tsx          (apply Archetype C)
    ├── CodexSkillsPanel.tsx             (apply Archetype C)
    ├── CodexRulesPanel.tsx              (apply Archetype C)
    ├── GeminiSettingsPanel.tsx          (apply Archetype A)
    ├── GeminiModelPanel.tsx             (apply Archetype A)
    ├── GeminiPermissionsPanel.tsx       (apply Archetype A)
    ├── GeminiContextPanel.tsx           (apply Archetype B)
    ├── GeminiCommandsPanel.tsx          (apply Archetype C)
    ├── OpenCodeConfigPanel.tsx          (apply Archetype A)
    ├── OpenCodeModelPanel.tsx           (apply Archetype A)
    ├── OpenCodeInstructionsPanel.tsx    (apply Archetype B)
    ├── OpenCodeAgentsPanel.tsx          (apply Archetype C)
    ├── OpenCodeCommandsPanel.tsx        (apply Archetype C)
    ├── OpenCodeSkillsPanel.tsx          (apply Archetype C)
    └── OpenCodePermissionsPanel.tsx     (apply Archetype A)
```

---

## Phase 1 — Foundation primitives

### Task 1: Design system tokens

**Files:**
- Create: `apps/desktop/src/features/agents/tokens.ts`
- Create: `apps/desktop/src/features/agents/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tokens.test.ts
import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

describe('design tokens', () => {
  it('exposes typography classes', () => {
    expect(TOKENS.textEyebrow).toContain('text-[10px]')
    expect(TOKENS.textEyebrow).toContain('uppercase')
    expect(TOKENS.textTitle).toContain('text-[16px]')
    expect(TOKENS.textTitle).toContain('font-semibold')
    expect(TOKENS.textSub).toContain('text-[11px]')
    expect(TOKENS.textMeta).toContain('font-mono')
    expect(TOKENS.textInherit).toContain('italic')
  })

  it('exposes pill classes', () => {
    expect(TOKENS.pillOverride).toContain('bg-accent/15')
    expect(TOKENS.pillUnsaved).toContain('bg-amber-500/15')
  })

  it('exposes surface classes', () => {
    expect(TOKENS.surfaceGlobal).toContain('bg-foreground/[0.02]')
    expect(TOKENS.surfaceProject).toContain('bg-accent/[0.04]')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd apps/desktop && npx vitest run src/features/agents/tokens.test.ts
```
Expected: FAIL — "Cannot find module './tokens'"

- [ ] **Step 3: Implement tokens.ts**

```ts
// apps/desktop/src/features/agents/tokens.ts
/**
 * Design system tokens for the Agent Config Hub.
 * Tailwind-flavored class strings — compose with template literals.
 */
export const TOKENS = {
  // Typography
  textEyebrow:   'text-[10px] uppercase tracking-[0.14em] text-foreground/45',
  textTitle:     'text-[16px] font-semibold tracking-[-0.01em] text-foreground',
  textSub:       'text-[11px] text-foreground/50',
  textMeta:      'text-[10px] font-mono text-foreground/35',
  textValue:     'text-[13px] font-medium text-foreground',
  textInherit:   'text-[11px] italic text-foreground/35',
  textOverride:  'text-[13px] font-medium text-accent',

  // Pills
  pillBase:      'text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded-[3px]',
  pillOverride:  'bg-accent/15 text-accent',
  pillUnsaved:   'bg-amber-500/15 text-amber-400',
  pillInherit:   'bg-foreground/[0.04] text-foreground/40',

  // Surfaces
  surfaceGlobal:  'bg-foreground/[0.02] border border-border/40 rounded-lg',
  surfaceProject: 'bg-accent/[0.04] border border-accent/20 rounded-lg',
  surfaceCard:    'bg-card border border-border/40 rounded-lg',

  // Layout spacing constants (px-based, intentionally explicit)
  paneSpace:     'p-[18px] space-y-[14px]',
  rowGap:        'space-y-[10px]',
} as const

export type Tokens = typeof TOKENS
```

- [ ] **Step 4: Re-run test, verify it passes**

```bash
cd apps/desktop && npx vitest run src/features/agents/tokens.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/tokens.ts apps/desktop/src/features/agents/tokens.test.ts
git commit -m "feat(agents): design system tokens for config hub"
```

---

### Task 2: PanelHeader component

**Files:**
- Create: `apps/desktop/src/features/agents/components/PanelHeader.tsx`
- Create: `apps/desktop/src/features/agents/components/PanelHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// PanelHeader.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelHeader } from './PanelHeader'

describe('PanelHeader', () => {
  it('renders eyebrow, title, and sub', () => {
    render(<PanelHeader eyebrow="Claude / Instructions" title="CLAUDE.md" sub="42 lines" />)
    expect(screen.getByText('Claude / Instructions')).toBeInTheDocument()
    expect(screen.getByText('CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByText('42 lines')).toBeInTheDocument()
  })

  it('omits sub when not provided', () => {
    render(<PanelHeader eyebrow="x" title="y" />)
    expect(screen.queryByTestId('panel-header-sub')).toBeNull()
  })

  it('shows Unsaved pill when dirty', () => {
    render(<PanelHeader eyebrow="x" title="y" dirty />)
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('hides Unsaved pill when not dirty', () => {
    render(<PanelHeader eyebrow="x" title="y" />)
    expect(screen.queryByText('Unsaved')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/PanelHeader.test.tsx
```
Expected: FAIL — "Cannot find module './PanelHeader'"

- [ ] **Step 3: Implement PanelHeader.tsx**

```tsx
// apps/desktop/src/features/agents/components/PanelHeader.tsx
import { TOKENS } from '../tokens'

interface PanelHeaderProps {
  eyebrow: string
  title: string
  sub?: string
  dirty?: boolean
  rightSlot?: React.ReactNode
}

export function PanelHeader({ eyebrow, title, sub, dirty, rightSlot }: PanelHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pb-3 mb-3 border-b border-dashed border-border/30">
      <div className="min-w-0 flex-1">
        <div className={TOKENS.textEyebrow}>{eyebrow}</div>
        <div className="flex items-center gap-2 mt-1">
          <h2 className={`${TOKENS.textTitle} truncate`}>{title}</h2>
          {dirty && (
            <span className={`${TOKENS.pillBase} ${TOKENS.pillUnsaved} animate-pulse`}>Unsaved</span>
          )}
        </div>
        {sub && (
          <p data-testid="panel-header-sub" className={`${TOKENS.textSub} mt-1`}>{sub}</p>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </header>
  )
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/PanelHeader.test.tsx
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/PanelHeader.tsx apps/desktop/src/features/agents/components/PanelHeader.test.tsx
git commit -m "feat(agents): PanelHeader primitive with dirty pill"
```

---

### Task 3: PanelFooter component

**Files:**
- Create: `apps/desktop/src/features/agents/components/PanelFooter.tsx`
- Create: `apps/desktop/src/features/agents/components/PanelFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// PanelFooter.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelFooter } from './PanelFooter'

describe('PanelFooter', () => {
  it('disables Save when not dirty', () => {
    render(<PanelFooter dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('enables Save when dirty', () => {
    render(<PanelFooter dirty saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('hides Discard when not dirty', () => {
    render(<PanelFooter dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull()
  })

  it('shows Discard when dirty', () => {
    render(<PanelFooter dirty saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })

  it('calls onSave when clicked', () => {
    const onSave = vi.fn()
    render(<PanelFooter dirty saving={false} onSave={onSave} onDiscard={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('shows saving indicator', () => {
    render(<PanelFooter dirty saving onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/PanelFooter.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement PanelFooter.tsx**

```tsx
// apps/desktop/src/features/agents/components/PanelFooter.tsx
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@ui/button'

interface PanelFooterProps {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  extraLeft?: React.ReactNode
}

export function PanelFooter({ dirty, saving, onSave, onDiscard, extraLeft }: PanelFooterProps) {
  return (
    <footer className="flex items-center justify-between gap-3 pt-3 mt-auto border-t border-border/20">
      <div>{extraLeft}</div>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={saving}
            className="h-7 text-[10px]"
          >
            <RotateCcw size={11} className="mr-1.5" /> Discard
          </Button>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          className="h-7 px-4 rounded-md bg-primary text-primary-foreground font-semibold text-[11px] disabled:opacity-40"
        >
          {saving ? (
            <><Loader2 size={11} className="animate-spin mr-1.5" /> Saving…</>
          ) : (
            <><Save size={11} className="mr-1.5" /> Save</>
          )}
        </Button>
      </div>
    </footer>
  )
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/PanelFooter.test.tsx
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/PanelFooter.tsx apps/desktop/src/features/agents/components/PanelFooter.test.tsx
git commit -m "feat(agents): PanelFooter primitive with save/discard"
```

---

### Task 4: ScopeToggle component

**Files:**
- Create: `apps/desktop/src/features/agents/components/ScopeToggle.tsx`
- Create: `apps/desktop/src/features/agents/components/ScopeToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ScopeToggle.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScopeToggle } from './ScopeToggle'

describe('ScopeToggle', () => {
  it('renders Global and project label', () => {
    render(<ScopeToggle scope="GLOBAL" projectName="Nautilus" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /global/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nautilus/i })).toBeInTheDocument()
  })

  it('marks active scope', () => {
    render(<ScopeToggle scope="PROJECT" projectName="Nautilus" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /nautilus/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /global/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange when clicking inactive', () => {
    const onChange = vi.fn()
    render(<ScopeToggle scope="GLOBAL" projectName="Nautilus" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /nautilus/i }))
    expect(onChange).toHaveBeenCalledWith('PROJECT')
  })

  it('hides project side when projectName is null', () => {
    render(<ScopeToggle scope="GLOBAL" projectName={null} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /nautilus/i })).toBeNull()
    expect(screen.getByText(/global only/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ScopeToggle.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement ScopeToggle.tsx**

```tsx
// apps/desktop/src/features/agents/components/ScopeToggle.tsx
import type { Scope } from '../types'

interface ScopeToggleProps {
  scope: Scope
  projectName: string | null
  onChange: (next: Scope) => void
}

export function ScopeToggle({ scope, projectName, onChange }: ScopeToggleProps) {
  if (!projectName) {
    return (
      <div className="text-[10px] font-mono uppercase tracking-wider text-foreground/40 px-2">
        Global only
      </div>
    )
  }
  return (
    <div role="group" className="inline-flex h-7 rounded-md border border-border/40 overflow-hidden text-[10.5px]">
      <button
        type="button"
        aria-pressed={scope === 'GLOBAL'}
        onClick={() => onChange('GLOBAL')}
        className={`px-3 ${scope === 'GLOBAL'
          ? 'bg-foreground/10 text-foreground font-medium'
          : 'text-foreground/50 hover:text-foreground/80'}`}
      >
        Global
      </button>
      <button
        type="button"
        aria-pressed={scope === 'PROJECT'}
        onClick={() => onChange('PROJECT')}
        className={`px-3 border-l border-border/40 ${scope === 'PROJECT'
          ? 'bg-accent/15 text-accent font-medium'
          : 'text-foreground/50 hover:text-foreground/80'}`}
      >
        {projectName}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ScopeToggle.test.tsx
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/ScopeToggle.tsx apps/desktop/src/features/agents/components/ScopeToggle.test.tsx
git commit -m "feat(agents): ScopeToggle segmented control"
```

---

### Task 5: ProjectSelector component

**Files:**
- Create: `apps/desktop/src/features/agents/components/ProjectSelector.tsx`
- Create: `apps/desktop/src/features/agents/components/ProjectSelector.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ProjectSelector.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSelector } from './ProjectSelector'

const projects = [
  { id: 'p1', name: 'Nautilus' },
  { id: 'p2', name: 'Orchestra' },
]

describe('ProjectSelector', () => {
  it('renders selected project name', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/nautilus/i)
  })

  it('renders Global only label when selectedId is null', () => {
    render(<ProjectSelector projects={projects} selectedId={null} onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent(/global only/i)
  })

  it('shows Global only option in dropdown', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/global only — hide project column/i)).toBeInTheDocument()
  })

  it('lists projects in dropdown', () => {
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: /orchestra/i })).toBeInTheDocument()
  })

  it('calls onChange(null) when Global only selected', () => {
    const onChange = vi.fn()
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText(/global only — hide project column/i))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('calls onChange with project id when project selected', () => {
    const onChange = vi.fn()
    render(<ProjectSelector projects={projects} selectedId="p1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /orchestra/i }))
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ProjectSelector.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement ProjectSelector.tsx**

```tsx
// apps/desktop/src/features/agents/components/ProjectSelector.tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Globe } from 'lucide-react'

interface ProjectSelectorProps {
  projects: Array<{ id: string; name: string }>
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function ProjectSelector({ projects, selectedId, onChange }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = selectedId ? projects.find(p => p.id === selectedId) : null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <span className="text-[10px] text-foreground/40 mr-2">vs</span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/40 bg-background hover:bg-foreground/[0.04] text-[11px] text-foreground/85"
      >
        {selected ? (
          <FolderOpen size={11} className="text-foreground/50" />
        ) : (
          <Globe size={11} className="text-foreground/50" />
        )}
        <span className="truncate max-w-[140px]">
          {selected ? selected.name : 'Global only'}
        </span>
        <ChevronDown size={10} className="text-foreground/40" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-md border border-border/50 bg-popover shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-foreground/[0.04] ${selectedId === null ? 'bg-foreground/[0.06]' : ''}`}
          >
            <Globe size={11} className="text-foreground/50 shrink-0" />
            <span className="flex-1 truncate">Global only — hide project column</span>
          </button>
          {projects.length > 0 && <div className="h-px bg-border/40" />}
          {projects.map(p => (
            <button
              key={p.id}
              role="menuitem"
              type="button"
              onClick={() => { onChange(p.id); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-foreground/[0.04] ${selectedId === p.id ? 'bg-foreground/[0.06]' : ''}`}
            >
              <FolderOpen size={11} className="text-foreground/50 shrink-0" />
              <span className="flex-1 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ProjectSelector.test.tsx
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/ProjectSelector.tsx apps/desktop/src/features/agents/components/ProjectSelector.test.tsx
git commit -m "feat(agents): ProjectSelector with Global-only option"
```

---

### Task 6: EmptyStateCard component

**Files:**
- Create: `apps/desktop/src/features/agents/components/EmptyStateCard.tsx`

- [ ] **Step 1: Implement EmptyStateCard.tsx (no test — pure render, covered by panel tests)**

```tsx
// apps/desktop/src/features/agents/components/EmptyStateCard.tsx
import { Button } from '@ui/button'
import { Plus } from 'lucide-react'

interface EmptyStateCardProps {
  title: string
  description: string
  ctaLabel: string
  onCreate: () => void
  pending?: boolean
}

export function EmptyStateCard({ title, description, ctaLabel, onCreate, pending }: EmptyStateCardProps) {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[200px]">
      <div className="max-w-sm text-center space-y-3 px-6 py-8">
        <h3 className="text-[13px] font-semibold text-foreground/85">{title}</h3>
        <p className="text-[11px] text-foreground/50 leading-relaxed">{description}</p>
        <Button onClick={onCreate} disabled={pending} size="sm" className="h-7 text-[11px] mt-2">
          <Plus size={11} className="mr-1.5" />
          {pending ? 'Creating…' : ctaLabel}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/agents/components/EmptyStateCard.tsx
git commit -m "feat(agents): EmptyStateCard primitive"
```

---

### Task 7: ErrorStrip component

**Files:**
- Create: `apps/desktop/src/features/agents/components/ErrorStrip.tsx`
- Create: `apps/desktop/src/features/agents/components/ErrorStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ErrorStrip.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorStrip } from './ErrorStrip'

describe('ErrorStrip', () => {
  it('renders message', () => {
    render(<ErrorStrip message="save failed" onDismiss={() => {}} />)
    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  it('returns null when message empty', () => {
    const { container } = render(<ErrorStrip message="" onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onDismiss when X clicked', () => {
    const onDismiss = vi.fn()
    render(<ErrorStrip message="x" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ErrorStrip.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement ErrorStrip.tsx**

```tsx
// apps/desktop/src/features/agents/components/ErrorStrip.tsx
import { AlertCircle, X } from 'lucide-react'

interface ErrorStripProps {
  message: string
  onDismiss: () => void
}

export function ErrorStrip({ message, onDismiss }: ErrorStripProps) {
  if (!message) return null
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/[0.06] text-[11px] text-red-400">
      <AlertCircle size={12} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 text-red-400/60 hover:text-red-400"
      >
        <X size={12} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/ErrorStrip.test.tsx
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/ErrorStrip.tsx apps/desktop/src/features/agents/components/ErrorStrip.test.tsx
git commit -m "feat(agents): ErrorStrip inline error primitive"
```

---

### Task 8: InheritedField wrapper

**Files:**
- Create: `apps/desktop/src/features/agents/components/InheritedField.tsx`
- Create: `apps/desktop/src/features/agents/components/InheritedField.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// InheritedField.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InheritedField } from './InheritedField'

describe('InheritedField', () => {
  it('renders inherited placeholder when state is inherited', () => {
    render(
      <InheritedField inherited inheritedValue="sonnet" onSetHere={() => {}}>
        <input data-testid="local-input" />
      </InheritedField>
    )
    expect(screen.getByText(/inherits from global/i)).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
  })

  it('renders children when not inherited', () => {
    render(
      <InheritedField inherited={false} inheritedValue="sonnet" onSetHere={() => {}}>
        <input data-testid="local-input" />
      </InheritedField>
    )
    expect(screen.getByTestId('local-input')).toBeInTheDocument()
    expect(screen.queryByText(/inherits from global/i)).toBeNull()
  })

  it('calls onSetHere when Set here clicked', () => {
    const onSetHere = vi.fn()
    render(
      <InheritedField inherited inheritedValue="sonnet" onSetHere={onSetHere}>
        <input />
      </InheritedField>
    )
    fireEvent.click(screen.getByRole('button', { name: /set here/i }))
    expect(onSetHere).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/InheritedField.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement InheritedField.tsx**

```tsx
// apps/desktop/src/features/agents/components/InheritedField.tsx
import { TOKENS } from '../tokens'

interface InheritedFieldProps {
  inherited: boolean
  inheritedValue: string | null
  onSetHere: () => void
  children: React.ReactNode
}

export function InheritedField({ inherited, inheritedValue, onSetHere, children }: InheritedFieldProps) {
  if (!inherited) return <>{children}</>
  return (
    <div className="group flex items-center gap-3 h-9 px-3 rounded-md border border-dashed border-border/30 bg-foreground/[0.015]">
      <span className={`${TOKENS.textInherit} not-italic text-[10px] uppercase tracking-wider text-foreground/30`}>
        inherits from global
      </span>
      <span className={`${TOKENS.textInherit} flex-1 truncate`}>
        {inheritedValue ?? '—'}
      </span>
      <button
        type="button"
        onClick={onSetHere}
        className="text-[10px] text-accent/80 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Set here
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/InheritedField.test.tsx
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/InheritedField.tsx apps/desktop/src/features/agents/components/InheritedField.test.tsx
git commit -m "feat(agents): InheritedField wrapper with Set-here affordance"
```

---

### Task 9: OverviewRow component

**Files:**
- Create: `apps/desktop/src/features/agents/components/OverviewRow.tsx`
- Create: `apps/desktop/src/features/agents/components/OverviewRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// OverviewRow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewRow } from './OverviewRow'

describe('OverviewRow', () => {
  it('renders name and value', () => {
    render(<OverviewRow name="Model" value="claude-sonnet-4-6" status="set" onClick={() => {}} />)
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  it('renders override pill when status is override', () => {
    render(<OverviewRow name="Model" value="opus" status="override" pillText="override" onClick={() => {}} />)
    expect(screen.getByText('override')).toBeInTheDocument()
  })

  it('renders inherited styling when status is inherited', () => {
    render(<OverviewRow name="Hooks" value="inherited" status="inherited" onClick={() => {}} />)
    const value = screen.getByText('inherited')
    expect(value.className).toMatch(/italic/)
  })

  it('calls onClick when row clicked', () => {
    const onClick = vi.fn()
    render(<OverviewRow name="Model" value="x" status="set" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/OverviewRow.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement OverviewRow.tsx**

```tsx
// apps/desktop/src/features/agents/components/OverviewRow.tsx
import { ChevronRight } from 'lucide-react'
import { TOKENS } from '../tokens'

type Status = 'set' | 'inherited' | 'override' | 'empty'

interface OverviewRowProps {
  name: string
  value: string
  status: Status
  pillText?: string
  hint?: string
  onClick: () => void
}

export function OverviewRow({ name, value, status, pillText, hint, onClick }: OverviewRowProps) {
  const valueClass =
    status === 'override' ? TOKENS.textOverride
    : status === 'inherited' ? TOKENS.textInherit
    : status === 'empty' ? `${TOKENS.textInherit} text-foreground/30`
    : TOKENS.textValue

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left flex items-start gap-3 py-3 border-b border-border/[0.04] last:border-b-0 hover:bg-foreground/[0.015] -mx-3 px-3 rounded-md transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-foreground/60">{name}</span>
          {pillText && (
            <span className={`${TOKENS.pillBase} ${status === 'override' ? TOKENS.pillOverride : TOKENS.pillInherit}`}>
              {pillText}
            </span>
          )}
        </div>
        <div className={`${valueClass} mt-1 truncate`}>{value}</div>
        {hint && <div className={`${TOKENS.textMeta} mt-1`}>{hint}</div>}
      </div>
      <ChevronRight size={13} className="text-foreground/30 group-hover:text-foreground/60 shrink-0 mt-1" />
    </button>
  )
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/components/OverviewRow.test.tsx
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/components/OverviewRow.tsx apps/desktop/src/features/agents/components/OverviewRow.test.tsx
git commit -m "feat(agents): OverviewRow with override/inherited statuses"
```

---

## Phase 2 — Overview Panel & Dashboard shell

### Task 10: Add 'overview' to CategoryId and constants

**Files:**
- Modify: `apps/desktop/src/features/agents/types.ts`
- Modify: `apps/desktop/src/features/agents/constants.ts`

- [ ] **Step 1: Add 'overview' to CategoryId union**

In `types.ts`, change the `CategoryId` union to include `'overview'`:

```ts
export type CategoryId =
  | 'overview'
  | 'settings'
  | 'config'
  | 'approvals'
  | 'models'
  | 'environment'
  | 'profiles'
  | 'instructions'
  | 'context'
  | 'agents'
  | 'skills'
  | 'hooks'
  | 'mcp'
  | 'rules'
  | 'commands'
  | 'permissions'
```

- [ ] **Step 2: Prepend overview to every category list in constants.ts**

Add the import for `LayoutDashboard` from lucide-react if not already imported. For each of `CLAUDE_CATEGORIES`, `CODEX_CATEGORIES`, `GEMINI_CATEGORIES`, `OPENCODE_CATEGORIES`, `EIGHTGENT_CATEGORIES`, prepend:

```ts
{ id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/agents/types.ts apps/desktop/src/features/agents/constants.ts
git commit -m "feat(agents): add overview category to all providers"
```

---

### Task 11: Add agent hub UI state to store

**Files:**
- Modify: `apps/desktop/src/core/store/slices/ui.slice.ts` (or whichever slice owns dashboard UI)

- [ ] **Step 1: Inspect current ui slice**

```bash
grep -n "activeAgentProvider\|agentScope\|agentHubProjectId" apps/desktop/src/core/store/slices/*.ts
```

- [ ] **Step 2: Add `agentHubProjectId` and `agentHubScope` to the ui slice**

Add to the slice state shape:
```ts
agentHubProjectId: string | null   // null means "Global only"
agentHubScope: 'GLOBAL' | 'PROJECT'
```

Add to the slice actions:
```ts
setAgentHubProjectId: (id: string | null) => void
setAgentHubScope: (scope: 'GLOBAL' | 'PROJECT') => void
```

Initial state: `agentHubProjectId: null` (resolved at render time to `selectedProjectID` if available), `agentHubScope: 'GLOBAL'`.

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/core/store/
git commit -m "feat(store): agentHub project + scope state"
```

---

### Task 12: OverviewPanel component (Claude)

**Files:**
- Create: `apps/desktop/src/features/agents/panels/OverviewPanel.tsx`
- Create: `apps/desktop/src/features/agents/panels/OverviewPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// OverviewPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OverviewPanel } from './OverviewPanel'

const baseProps = {
  provider: 'claude' as const,
  projectName: 'Nautilus',
  globalSummary: {
    model: 'claude-sonnet-4-6',
    instructionsLines: 42,
    skillsCount: 2,
    mcpCount: 1,
    hooksCount: 0,
    subAgentsCount: 2,
  },
  projectSummary: {
    model: 'claude-opus-4-7',
    instructionsLines: null,           // null = inherited
    skillsCount: 1,                    // 1 project-local skill
    skillsAddedNames: ['deploy-checklist'],
    mcpCount: 1,
    hooksCount: null,
    subAgentsCount: null,
  },
  onNavigate: vi.fn(),
}

describe('OverviewPanel', () => {
  it('renders global column with model', () => {
    render(<OverviewPanel {...baseProps} />)
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  it('renders project column with override pill', () => {
    render(<OverviewPanel {...baseProps} />)
    expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument()
    expect(screen.getAllByText(/override/i).length).toBeGreaterThan(0)
  })

  it('hides project column when projectName is null', () => {
    render(<OverviewPanel {...baseProps} projectName={null} />)
    expect(screen.queryByText('claude-opus-4-7')).toBeNull()
  })

  it('navigates when row clicked', () => {
    const onNavigate = vi.fn()
    render(<OverviewPanel {...baseProps} onNavigate={onNavigate} />)
    fireEvent.click(screen.getAllByRole('button', { name: /model/i })[0])
    expect(onNavigate).toHaveBeenCalledWith('models', 'GLOBAL')
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
cd apps/desktop && npx vitest run src/features/agents/panels/OverviewPanel.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Implement OverviewPanel.tsx**

```tsx
// apps/desktop/src/features/agents/panels/OverviewPanel.tsx
import { OverviewRow } from '../components/OverviewRow'
import { PanelHeader } from '../components/PanelHeader'
import { TOKENS } from '../tokens'
import type { Provider, CategoryId, Scope } from '../types'

export interface ProviderSummary {
  model: string | null
  instructionsLines: number | null     // null means inherited
  skillsCount: number | null
  skillsAddedNames?: string[]
  mcpCount: number | null
  hooksCount: number | null
  subAgentsCount: number | null
}

interface OverviewPanelProps {
  provider: Provider
  projectName: string | null
  globalSummary: ProviderSummary
  projectSummary: ProviderSummary | null
  onNavigate: (category: CategoryId, scope: Scope) => void
}

const providerLabel: Record<Provider, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode', '8gent': '8gent',
}

function renderRow(
  name: string,
  category: CategoryId,
  scope: Scope,
  status: 'set' | 'inherited' | 'override' | 'empty',
  value: string,
  pillText: string | undefined,
  hint: string | undefined,
  onNavigate: OverviewPanelProps['onNavigate'],
) {
  return (
    <OverviewRow
      name={name}
      value={value}
      status={status}
      pillText={pillText}
      hint={hint}
      onClick={() => onNavigate(category, scope)}
    />
  )
}

export function OverviewPanel({ provider, projectName, globalSummary, projectSummary, onNavigate }: OverviewPanelProps) {
  const label = providerLabel[provider]
  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={`${label} / Configuration`}
        title="Global & project overrides"
        sub={projectName
          ? `Side-by-side view of what applies everywhere and what's specific to ${projectName}.`
          : 'No project selected — showing global configuration only.'}
      />

      <div className={`grid ${projectName ? 'grid-cols-2' : 'grid-cols-1'} gap-3 flex-1 min-h-0 overflow-auto`}>

        {/* Global column */}
        <section className={`${TOKENS.surfaceGlobal} p-3`}>
          <header className={`${TOKENS.textEyebrow} pb-2 mb-1 border-b border-border/30`}>Global</header>
          {renderRow('Model', 'models', 'GLOBAL', globalSummary.model ? 'set' : 'empty',
            globalSummary.model ?? '—', undefined, undefined, onNavigate)}
          {renderRow('Instructions', 'instructions', 'GLOBAL',
            globalSummary.instructionsLines ? 'set' : 'empty',
            globalSummary.instructionsLines ? `${globalSummary.instructionsLines} lines` : 'not set',
            undefined,
            globalSummary.instructionsLines ? '~/.claude/CLAUDE.md' : undefined,
            onNavigate)}
          {renderRow('Skills', 'skills', 'GLOBAL',
            (globalSummary.skillsCount ?? 0) > 0 ? 'set' : 'empty',
            `${globalSummary.skillsCount ?? 0} enabled`,
            undefined, undefined, onNavigate)}
          {renderRow('Sub-agents', 'agents', 'GLOBAL',
            (globalSummary.subAgentsCount ?? 0) > 0 ? 'set' : 'empty',
            `${globalSummary.subAgentsCount ?? 0} configured`,
            undefined, undefined, onNavigate)}
          {renderRow('Hooks', 'hooks', 'GLOBAL',
            (globalSummary.hooksCount ?? 0) > 0 ? 'set' : 'empty',
            (globalSummary.hooksCount ?? 0) === 0 ? 'none' : `${globalSummary.hooksCount}`,
            undefined, undefined, onNavigate)}
          {renderRow('MCP servers', 'mcp', 'GLOBAL',
            (globalSummary.mcpCount ?? 0) > 0 ? 'set' : 'empty',
            (globalSummary.mcpCount ?? 0) === 0 ? 'none' : `${globalSummary.mcpCount} connected`,
            undefined, undefined, onNavigate)}
        </section>

        {/* Project column */}
        {projectName && projectSummary && (
          <section className={`${TOKENS.surfaceProject} p-3`}>
            <header className={`${TOKENS.textEyebrow} pb-2 mb-1 border-b border-accent/20`} style={{ color: 'rgb(130,182,255)' }}>{projectName}</header>

            {renderRow('Model', 'models', 'PROJECT',
              projectSummary.model ? 'override' : 'inherited',
              projectSummary.model ?? 'inherits global',
              projectSummary.model ? 'override' : undefined,
              undefined, onNavigate)}

            {renderRow('Instructions', 'instructions', 'PROJECT',
              projectSummary.instructionsLines ? 'override' : 'inherited',
              projectSummary.instructionsLines
                ? `+${projectSummary.instructionsLines} lines appended`
                : 'inherits global',
              projectSummary.instructionsLines ? 'override' : undefined,
              undefined, onNavigate)}

            {renderRow('Skills', 'skills', 'PROJECT',
              (projectSummary.skillsCount ?? 0) > 0 ? 'override' : 'inherited',
              (projectSummary.skillsAddedNames ?? []).join(', ') || 'inherits global',
              (projectSummary.skillsCount ?? 0) > 0 ? `+${projectSummary.skillsCount}` : undefined,
              undefined, onNavigate)}

            {renderRow('Sub-agents', 'agents', 'PROJECT',
              (projectSummary.subAgentsCount ?? 0) > 0 ? 'override' : 'inherited',
              (projectSummary.subAgentsCount ?? 0) > 0 ? `+${projectSummary.subAgentsCount}` : 'inherits global',
              (projectSummary.subAgentsCount ?? 0) > 0 ? `+${projectSummary.subAgentsCount}` : undefined,
              undefined, onNavigate)}

            {renderRow('Hooks', 'hooks', 'PROJECT',
              (projectSummary.hooksCount ?? 0) > 0 ? 'override' : 'inherited',
              (projectSummary.hooksCount ?? 0) > 0 ? `${projectSummary.hooksCount}` : 'inherits global',
              undefined, undefined, onNavigate)}

            {renderRow('MCP servers', 'mcp', 'PROJECT',
              (projectSummary.mcpCount ?? 0) > 0 ? 'override' : 'inherited',
              (projectSummary.mcpCount ?? 0) > 0 ? `+${projectSummary.mcpCount}` : 'inherits global',
              (projectSummary.mcpCount ?? 0) > 0 ? `+${projectSummary.mcpCount}` : undefined,
              undefined, onNavigate)}
          </section>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/panels/OverviewPanel.test.tsx
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/panels/OverviewPanel.tsx apps/desktop/src/features/agents/panels/OverviewPanel.test.tsx
git commit -m "feat(agents): OverviewPanel with side-by-side global/project view"
```

---

### Task 13: Build provider summary selectors

**Files:**
- Create: `apps/desktop/src/features/agents/hooks/use-overview-summary.ts`
- Create: `apps/desktop/src/features/agents/hooks/use-overview-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// use-overview-summary.test.ts
import { describe, it, expect } from 'vitest'
import { computeClaudeSummary } from './use-overview-summary'

describe('computeClaudeSummary', () => {
  it('counts skills from items', () => {
    const result = computeClaudeSummary({
      settings: { model: 'sonnet' },
      claudeMd: 'line1\nline2\nline3',
      skills: [{ name: 'a.md' }, { name: 'b.md' }],
      hooks: [],
      mcpServers: { github: {} },
      subAgents: [{ name: 'reviewer.md' }],
    })
    expect(result.model).toBe('sonnet')
    expect(result.instructionsLines).toBe(3)
    expect(result.skillsCount).toBe(2)
    expect(result.mcpCount).toBe(1)
    expect(result.subAgentsCount).toBe(1)
    expect(result.hooksCount).toBe(0)
  })

  it('returns nulls for missing data', () => {
    const result = computeClaudeSummary({
      settings: null, claudeMd: null, skills: [], hooks: [], mcpServers: {}, subAgents: [],
    })
    expect(result.model).toBeNull()
    expect(result.instructionsLines).toBeNull()
    expect(result.skillsCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
cd apps/desktop && npx vitest run src/features/agents/hooks/use-overview-summary.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement use-overview-summary.ts**

```ts
// apps/desktop/src/features/agents/hooks/use-overview-summary.ts
import type { ProviderSummary } from '../panels/OverviewPanel'

interface ClaudeBundle {
  settings: { model?: string | null } | null
  claudeMd: string | null
  skills: Array<{ name: string }>
  hooks: unknown[]
  mcpServers: Record<string, unknown>
  subAgents: Array<{ name: string }>
}

export function computeClaudeSummary(b: ClaudeBundle): ProviderSummary {
  return {
    model: b.settings?.model ?? null,
    instructionsLines: b.claudeMd ? b.claudeMd.split('\n').length : null,
    skillsCount: b.skills.length,
    skillsAddedNames: b.skills.slice(0, 5).map(s => s.name.replace(/\.md$/, '')),
    mcpCount: Object.keys(b.mcpServers ?? {}).length,
    hooksCount: b.hooks.length,
    subAgentsCount: b.subAgents.length,
  }
}

// Project-vs-global summary: returns project bundle but with nulls
// for fields that are absent at project scope (inherits from global).
export function computeClaudeProjectSummary(
  global: ClaudeBundle,
  project: Partial<ClaudeBundle> | null,
): ProviderSummary | null {
  if (!project) return null
  const projectOnlySkills = (project.skills ?? []).filter(
    s => !global.skills.find(g => g.name === s.name)
  )
  return {
    model: project.settings?.model ?? null,
    instructionsLines: project.claudeMd ? project.claudeMd.split('\n').length : null,
    skillsCount: projectOnlySkills.length || null,
    skillsAddedNames: projectOnlySkills.slice(0, 5).map(s => s.name.replace(/\.md$/, '')),
    mcpCount: project.mcpServers ? Object.keys(project.mcpServers).length || null : null,
    hooksCount: project.hooks ? project.hooks.length || null : null,
    subAgentsCount: project.subAgents ? project.subAgents.length || null : null,
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd apps/desktop && npx vitest run src/features/agents/hooks/use-overview-summary.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/hooks/use-overview-summary.ts apps/desktop/src/features/agents/hooks/use-overview-summary.test.ts
git commit -m "feat(agents): overview summary selectors"
```

---

### Task 14: Wire Overview into AgentsDashboard

**Files:**
- Modify: `apps/desktop/src/features/agents/AgentsDashboard.tsx`

- [ ] **Step 1: Read current AgentsDashboard.tsx in full**

```bash
cat apps/desktop/src/features/agents/AgentsDashboard.tsx | head -200
```

Identify: (a) where categories are rendered in the sidebar; (b) where the active panel is switched (likely a big switch on category); (c) where the top bar lives.

- [ ] **Step 2: Add Overview to the panel switch**

In the panel rendering switch (search for `case 'settings':` or similar), add:

```tsx
case 'overview':
  return (
    <OverviewPanel
      provider={provider}
      projectName={selectedProject?.name ?? null}
      globalSummary={overviewSummaryGlobal}
      projectSummary={overviewSummaryProject}
      onNavigate={(category, scope) => {
        setActiveCategory(category)
        setAgentHubScope(scope)
      }}
    />
  )
```

- [ ] **Step 3: Default the active category to 'overview' when provider changes**

Find the `useEffect` or initial state that picks the default category. Change to:
```ts
const [activeCategory, setActiveCategory] = useState<CategoryId>('overview')
```

And reset to `'overview'` when `provider` changes:
```ts
useEffect(() => { setActiveCategory('overview') }, [provider])
```

- [ ] **Step 4: Add the ProjectSelector to the top bar**

Find the top bar JSX. Add the selector to the right side:
```tsx
<ProjectSelector
  projects={projects}
  selectedId={agentHubProjectId}
  onChange={setAgentHubProjectId}
/>
```

- [ ] **Step 5: Add ScopeToggle next to it (visible only when not on Overview)**

```tsx
{activeCategory !== 'overview' && (
  <ScopeToggle
    scope={agentHubScope}
    projectName={selectedProject?.name ?? null}
    onChange={setAgentHubScope}
  />
)}
```

- [ ] **Step 6: Compute overview summaries via the hooks**

Within the component, pull the relevant data from existing hooks (`useClaudeConfig`, `useCodexConfig`, etc.) and feed them through `computeClaudeSummary` / equivalents. For non-Claude providers, define a minimal `ProviderSummary` stub (model + instructions only) until later tasks add provider-specific summary builders.

- [ ] **Step 7: Typecheck and run existing dashboard tests**

```bash
cd apps/desktop && npx tsc --noEmit && npx vitest run src/features/agents/AgentsDashboard.test.tsx
```
Expected: 0 type errors, existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/features/agents/AgentsDashboard.tsx
git commit -m "feat(agents): wire OverviewPanel + ProjectSelector + ScopeToggle into shell"
```

---

## Phase 3 — Canonical panel refactors

Each archetype gets ONE canonical refactor with full detail. Phase 4 then applies these patterns to all remaining panels with shorter task descriptions.

### Task 15: Refactor InstructionsPanel (Archetype B canonical)

**Files:**
- Modify: `apps/desktop/src/features/agents/panels/InstructionsPanel.tsx`

- [ ] **Step 1: Read the current panel**

```bash
cat apps/desktop/src/features/agents/panels/InstructionsPanel.tsx
```

Note the props it receives, the save function, and how it determines `exists`.

- [ ] **Step 2: Rewrite the panel using the new primitives**

```tsx
// apps/desktop/src/features/agents/panels/InstructionsPanel.tsx
import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useAppStore } from '@core/store'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'

interface InstructionsPanelProps {
  content: string
  path: string
  exists: boolean
  saving: string | null
  scope: Scope
  projectName: string | null
  onSave: (content: string) => Promise<void>
  onDelete?: () => Promise<void>
}

export function InstructionsPanel({
  content: propsContent, path, exists, saving, scope, projectName, onSave, onDelete,
}: InstructionsPanelProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [content, setContent] = useState(propsContent)
  const [error, setError] = useState('')
  const dirty = content !== propsContent

  useEffect(() => { setContent(propsContent); setError('') }, [propsContent])

  const sub = scope === 'GLOBAL'
    ? `Global instructions · ${path}`
    : `Project instructions for ${projectName ?? 'this workspace'} · appends to global · ${path}`

  if (!exists) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={scope === 'GLOBAL' ? 'Global / Instructions' : `${projectName ?? 'Project'} / Instructions`}
          title="CLAUDE.md"
          sub={`No instructions file at this scope · ${path}`}
        />
        <EmptyStateCard
          title="No CLAUDE.md at this scope"
          description={scope === 'GLOBAL'
            ? 'Global instructions apply to every project unless overridden.'
            : 'Project instructions append to global. Optional.'}
          ctaLabel="Create CLAUDE.md"
          onCreate={() => { void onSave('') }}
          pending={!!saving}
        />
      </div>
    )
  }

  const handleSave = async () => {
    setError('')
    try { await onSave(content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={scope === 'GLOBAL' ? 'Global / Instructions' : `${projectName ?? 'Project'} / Instructions`}
        title="CLAUDE.md"
        sub={sub}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 rounded-lg border border-border/30 overflow-hidden">
        <Editor
          language="markdown"
          value={content}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          onChange={(v) => { if (v !== undefined) setContent(v) }}
          options={{
            minimap: { enabled: false },
            fontSize: editorSettings.fontSize,
            fontFamily: editorSettings.fontFamily || undefined,
            lineNumbers: 'off',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: 'none',
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(propsContent)}
        extraLeft={
          onDelete && (
            <button
              type="button"
              onClick={() => { void onDelete() }}
              className="text-[10px] text-foreground/40 hover:text-red-400 transition-colors"
            >
              Delete file
            </button>
          )
        }
      />
    </div>
  )
}
```

- [ ] **Step 3: Update InstructionsPanel callers in AgentsDashboard.tsx**

Pass the new `scope` and `projectName` props at the call site:
```tsx
<InstructionsPanel
  content={claudeMd?.content ?? ''}
  path={claudeMd?.path ?? ''}
  exists={!!claudeMd?.exists}
  saving={saving}
  scope={agentHubScope}
  projectName={selectedProject?.name ?? null}
  onSave={handleSaveClaudeMd}
  onDelete={handleDeleteClaudeMd}
/>
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/panels/InstructionsPanel.tsx apps/desktop/src/features/agents/AgentsDashboard.tsx
git commit -m "refactor(agents): InstructionsPanel adopts Archetype B"
```

---

### Task 16: Refactor SettingsPanel (Archetype A canonical)

**Files:**
- Modify: `apps/desktop/src/features/agents/panels/SettingsPanel.tsx`

- [ ] **Step 1: Read current SettingsPanel**

```bash
cat apps/desktop/src/features/agents/panels/SettingsPanel.tsx
```

Note the existing form fields and props.

- [ ] **Step 2: Rewrite the panel with PanelHeader + PanelFooter + InheritedField for each field**

The full file is too long to paste in this step. Apply this structural template, preserving the existing form fields (model dropdown, max turns input, theme dropdown, env array editor, etc.):

```tsx
// apps/desktop/src/features/agents/panels/SettingsPanel.tsx
import { useState, useEffect } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { InheritedField } from '../components/InheritedField'
import type { Scope } from '../types'

interface SettingsPanelProps {
  settings: Record<string, unknown> | null
  globalSettings: Record<string, unknown> | null   // for inheritance hints
  scope: Scope
  projectName: string | null
  path: string                                      // e.g. '~/.claude/settings.json'
  saving: boolean
  onSave: (settings: Record<string, unknown>) => Promise<void>
}

export function SettingsPanel({
  settings: propsSettings, globalSettings, scope, projectName, path, saving, onSave,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(propsSettings ?? {})
  const [error, setError] = useState('')

  useEffect(() => { setDraft(propsSettings ?? {}); setError('') }, [propsSettings])

  const dirty = JSON.stringify(draft) !== JSON.stringify(propsSettings ?? {})

  const fieldInherited = (key: string) =>
    scope === 'PROJECT' && (draft[key] === undefined || draft[key] === null)

  const inheritedValue = (key: string) =>
    globalSettings ? String(globalSettings[key] ?? '—') : '—'

  const setField = (key: string, value: unknown) => setDraft(d => ({ ...d, [key]: value }))

  const handleSave = async () => {
    setError('')
    try { await onSave(draft) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={scope === 'GLOBAL' ? 'Global / Settings' : `${projectName ?? 'Project'} / Settings`}
        title="Settings"
        sub={`Writes to ${path}`}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 overflow-auto space-y-3 max-w-2xl">
        {/* Model */}
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-foreground/45">Model</label>
          <InheritedField
            inherited={fieldInherited('model')}
            inheritedValue={inheritedValue('model')}
            onSetHere={() => setField('model', globalSettings?.model ?? '')}
          >
            <input
              className="w-full h-9 px-3 rounded-md border border-border/40 bg-background text-[12px]"
              value={(draft.model as string) ?? ''}
              onChange={(e) => setField('model', e.target.value)}
              placeholder="claude-sonnet-4-6"
            />
          </InheritedField>
        </div>

        {/* Max turns */}
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-foreground/45">Max turns</label>
          <InheritedField
            inherited={fieldInherited('maxTurns')}
            inheritedValue={inheritedValue('maxTurns')}
            onSetHere={() => setField('maxTurns', globalSettings?.maxTurns ?? 50)}
          >
            <input
              type="number"
              className="w-full h-9 px-3 rounded-md border border-border/40 bg-background text-[12px]"
              value={(draft.maxTurns as number) ?? ''}
              onChange={(e) => setField('maxTurns', Number(e.target.value))}
            />
          </InheritedField>
        </div>

        {/* Theme, env, verbose etc — same pattern, preserving original fields */}
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setDraft(propsSettings ?? {})}
      />
    </div>
  )
}
```

- [ ] **Step 3: Update call site in AgentsDashboard.tsx**

Pass `scope`, `projectName`, `globalSettings`, `path` props at the call site.

- [ ] **Step 4: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/panels/SettingsPanel.tsx apps/desktop/src/features/agents/AgentsDashboard.tsx
git commit -m "refactor(agents): SettingsPanel adopts Archetype A (form + inheritance)"
```

---

### Task 17: Refactor SkillsPanel (Archetype C canonical)

**Files:**
- Modify: `apps/desktop/src/features/agents/panels/SkillsPanel.tsx`

- [ ] **Step 1: Read current SkillsPanel**

```bash
cat apps/desktop/src/features/agents/panels/SkillsPanel.tsx
```

Note: it has list + Monaco editor + create/delete dialogs.

- [ ] **Step 2: Apply the Archetype C structure**

Rewrite to use PanelHeader + PanelFooter + EmptyStateCard + ErrorStrip. The two-pane layout (list left, editor right) stays. Add `(G)` tag for inherited items.

```tsx
// apps/desktop/src/features/agents/panels/SkillsPanel.tsx
import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { useAppStore } from '@core/store'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { ClaudeFileEntry } from '@core/api/client'
import type { Scope } from '../types'

const SKILL_TEMPLATE = `---
name: {{NAME}}
description: Describe what this skill does
trigger: manual
---

# {{NAME}}

Skill instructions go here.
`

interface SkillsPanelProps {
  items: ClaudeFileEntry[]
  globalItems: ClaudeFileEntry[]      // for "(G)" inherited tag in PROJECT scope
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

export function SkillsPanel({
  items, globalItems, scope, projectName, saving, onSave, onDelete,
}: SkillsPanelProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')

  // Combine project and inherited-from-global items into one display list
  const inheritedItems = scope === 'PROJECT'
    ? globalItems.filter(g => !items.some(p => p.name === g.name))
    : []
  const displayItems = [
    ...items.map(i => ({ ...i, isInherited: false })),
    ...inheritedItems.map(i => ({ ...i, isInherited: true })),
  ]

  useEffect(() => {
    if (!selectedName && items.length > 0) setSelectedName(items[0].name)
  }, [selectedName, items])

  const selected = displayItems.find(i => i.name === selectedName) ?? null
  useEffect(() => { setContent(selected?.content ?? ''); setError('') }, [selected])

  const dirty = selected && !selected.isInherited ? content !== selected.content : false
  const projectCount = items.length
  const inheritedCount = inheritedItems.length

  if (displayItems.length === 0 && scope === 'PROJECT' && projectName) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={`${projectName} / Skills`}
          title="Skills"
          sub={`No project skills · inherits 0 from global`}
        />
        <EmptyStateCard
          title="No skills at this scope"
          description="Add a skill to make it available to this project."
          ctaLabel="New skill"
          onCreate={() => setCreateOpen(true)}
        />
      </div>
    )
  }

  const handleSave = async () => {
    if (!selected || selected.isInherited) return
    setError('')
    try { await onSave(selected.name, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={scope === 'GLOBAL' ? 'Global / Skills' : `${projectName ?? 'Project'} / Skills`}
        title="Skills"
        sub={`${displayItems.length} skill${displayItems.length === 1 ? '' : 's'} · ${projectCount} project, ${inheritedCount} inherited`}
        dirty={dirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        {/* Left rail */}
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New skill
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {displayItems.map(item => (
              <button
                key={item.name}
                type="button"
                onClick={() => setSelectedName(item.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                  item.name === selectedName ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                <span className="truncate flex-1">{item.name}</span>
                {item.isInherited && (
                  <span className="text-[8.5px] font-mono uppercase text-foreground/30">(G)</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Right pane */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono">
                {selected.name}
                {selected.isInherited && ' · inherited from global (read-only at this scope)'}
              </div>
              <div className="flex-1 min-h-0 rounded-md border border-border/30 overflow-hidden">
                <Editor
                  language="markdown"
                  value={content}
                  theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                  onChange={(v) => { if (v !== undefined && !selected.isInherited) setContent(v) }}
                  options={{
                    readOnly: selected.isInherited,
                    minimap: { enabled: false },
                    fontSize: editorSettings.fontSize,
                    fontFamily: editorSettings.fontFamily || undefined,
                    lineNumbers: 'off',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    padding: { top: 10, bottom: 10 },
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a skill or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(selected?.content ?? '')}
        extraLeft={
          selected && !selected.isInherited && (
            <button
              type="button"
              onClick={() => setDeleteTarget(selected.name)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          )
        }
      />

      {/* Create dialog — same as existing implementation */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>Creates a markdown file in the skills directory.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Name</label>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
              placeholder="e.g. refactor-helper"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); setCreateName('') }}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!createName.trim()) return
                await onSave(createName.trim(), SKILL_TEMPLATE.replaceAll('{{NAME}}', createName.trim()))
                setSelectedName(createName.trim())
                setCreateOpen(false); setCreateName('')
              }}
            >
              <Plus size={12} className="mr-2" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete skill</DialogTitle>
            <DialogDescription>This removes the file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return
              await onDelete(deleteTarget)
              setDeleteTarget(null)
              setSelectedName(null)
            }}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 3: Update call site in AgentsDashboard.tsx**

Pass `scope`, `projectName`, `globalItems` props.

- [ ] **Step 4: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/agents/panels/SkillsPanel.tsx apps/desktop/src/features/agents/AgentsDashboard.tsx
git commit -m "refactor(agents): SkillsPanel adopts Archetype C (list + editor + inheritance)"
```

---

## Phase 4 — Apply patterns to remaining panels

Each task here is a panel-specific refactor. Reference the corresponding canonical task (15 / 16 / 17) for the pattern. Each task contains the panel-specific configuration the engineer needs.

### Task 18: HooksPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/HooksPanel.tsx`

- [ ] **Step 1:** Read current implementation.
- [ ] **Step 2:** Apply Archetype A (Task 16 template) with these fields:
  - eyebrow: `'{Scope} / Hooks'`, title: `'Hooks'`, sub: `'Writes to .claude/settings.json :: hooks'`
  - Per hook event (from `HOOK_EVENTS_BY_PROVIDER['claude']`): a textarea for matching commands. Keep array editor UI.
  - Use `InheritedField` for the array — when project has no hooks for an event, show inherited list dimmed.
- [ ] **Step 3:** Update call site in AgentsDashboard (pass `scope`, `projectName`).
- [ ] **Step 4:** Typecheck (`npx tsc --noEmit`).
- [ ] **Step 5:** Commit: `refactor(agents): HooksPanel adopts Archetype A`

### Task 19: PermissionsPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/PermissionsPanel.tsx`

- [ ] Apply Archetype A.
  - Fields: `allow` (string[]), `deny` (string[]), `defaultMode` (enum from `APPROVAL_MODES.claude`)
  - Wrap each field in `InheritedField` where the project file lacks it.
- [ ] Update call site, typecheck, commit: `refactor(agents): PermissionsPanel adopts Archetype A`

### Task 20: MCPPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/MCPPanel.tsx`

- [ ] Apply Archetype C (Task 17 template). Each named-file is an MCP server.
  - Left rail: server names from `.mcp.json` (project) + inherited from global with `(G)` tag.
  - Right pane: JSON editor (Monaco, language='json') for the server config.
  - sub: `'.mcp.json · {N} servers ({P} project, {G} inherited)'`
- [ ] Update call site, typecheck, commit: `refactor(agents): MCPPanel adopts Archetype C`

### Task 21: RulesPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/RulesPanel.tsx`

- [ ] Apply Archetype C.
  - Each rule is a markdown file in `.claude/rules/`
  - List + Monaco markdown editor
  - sub: `'.claude/rules/ · {N} rules'`
- [ ] Update call site, typecheck, commit: `refactor(agents): RulesPanel adopts Archetype C`

### Task 22: SubAgentsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/SubAgentsPanel.tsx`

- [ ] Apply Archetype C.
  - Each file in `.claude/agents/` with frontmatter (name, description, model, tools)
  - List + Monaco markdown editor
  - sub: `'.claude/agents/ · {N} sub-agents'`
- [ ] Update call site, typecheck, commit: `refactor(agents): SubAgentsPanel adopts Archetype C`

---

## Phase 5 — Non-Claude providers

### Task 23: CodexConfigPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/CodexConfigPanel.tsx`

- [ ] Apply Archetype A. Fields based on `.codex/config.toml` keys: `model`, `approval_policy`, `sandbox_mode`, etc. Use `InheritedField` per key.
- [ ] eyebrow: `'{Scope} / Config'`, title: `'Codex configuration'`, sub: `'Writes to .codex/config.toml'`.
- [ ] Update call site, typecheck, commit: `refactor(agents): CodexConfigPanel adopts Archetype A`

### Task 24: CodexModelPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/CodexModelPanel.tsx`

- [ ] Apply Archetype A. Single field: `model` (from `MODELS_BY_PROVIDER.codex`) plus reasoning effort (from `EFFORT_LEVELS.codex`).
- [ ] Update call site, typecheck, commit: `refactor(agents): CodexModelPanel adopts Archetype A`

### Task 25: CodexInstructionsPanel → Archetype B

**File:** `apps/desktop/src/features/agents/panels/CodexInstructionsPanel.tsx`

- [ ] Apply Archetype B (Task 15 template). File path: `.codex/AGENTS.md` or `.codex/instructions.md`.
- [ ] Update call site, typecheck, commit: `refactor(agents): CodexInstructionsPanel adopts Archetype B`

### Task 26: CodexApprovalsPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/CodexApprovalsPanel.tsx`

- [ ] Apply Archetype A. Fields from `APPROVAL_MODES.codex`. Wrap in InheritedField.
- [ ] Update, typecheck, commit: `refactor(agents): CodexApprovalsPanel adopts Archetype A`

### Task 27: CodexEnvironmentPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/CodexEnvironmentPanel.tsx`

- [ ] Apply Archetype A. Field: env var key/value list editor.
- [ ] Update, typecheck, commit: `refactor(agents): CodexEnvironmentPanel adopts Archetype A`

### Task 28: CodexProfilesPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/CodexProfilesPanel.tsx`

- [ ] Apply Archetype C. Profiles as named TOML blocks; list left, editor right.
- [ ] Update, typecheck, commit: `refactor(agents): CodexProfilesPanel adopts Archetype C`

### Task 29: CodexSubAgentsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/CodexSubAgentsPanel.tsx`

- [ ] Apply Archetype C. Named markdown files.
- [ ] Update, typecheck, commit: `refactor(agents): CodexSubAgentsPanel adopts Archetype C`

### Task 30: CodexSkillsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/CodexSkillsPanel.tsx`

- [ ] Apply Archetype C. Same as Task 17 but Codex paths.
- [ ] Update, typecheck, commit: `refactor(agents): CodexSkillsPanel adopts Archetype C`

### Task 31: CodexRulesPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/CodexRulesPanel.tsx`

- [ ] Apply Archetype C.
- [ ] Update, typecheck, commit: `refactor(agents): CodexRulesPanel adopts Archetype C`

### Task 32: GeminiSettingsPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/GeminiSettingsPanel.tsx`

- [ ] Apply Archetype A. Fields based on `.gemini/settings.json`: `model`, `safetySettings.harassment`, `tools.googleSearch`, etc.
- [ ] Update, typecheck, commit: `refactor(agents): GeminiSettingsPanel adopts Archetype A`

### Task 33: GeminiModelPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/GeminiModelPanel.tsx`

- [ ] Apply Archetype A. Field: `model` from `MODELS_BY_PROVIDER.gemini`.
- [ ] Update, typecheck, commit: `refactor(agents): GeminiModelPanel adopts Archetype A`

### Task 34: GeminiPermissionsPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/GeminiPermissionsPanel.tsx`

- [ ] Apply Archetype A. Fields: `allow` (string[]), `deny` (string[]).
- [ ] Update, typecheck, commit: `refactor(agents): GeminiPermissionsPanel adopts Archetype A`

### Task 35: GeminiContextPanel → Archetype B

**File:** `apps/desktop/src/features/agents/panels/GeminiContextPanel.tsx`

- [ ] Apply Archetype B. File: `GEMINI.md`.
- [ ] Update, typecheck, commit: `refactor(agents): GeminiContextPanel adopts Archetype B`

### Task 36: GeminiCommandsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/GeminiCommandsPanel.tsx`

- [ ] Apply Archetype C. Custom slash commands as named files.
- [ ] Update, typecheck, commit: `refactor(agents): GeminiCommandsPanel adopts Archetype C`

### Task 37: OpenCodeConfigPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/OpenCodeConfigPanel.tsx`

- [ ] Apply Archetype A. Fields from `config.json`: `model`, providers, theme.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeConfigPanel adopts Archetype A`

### Task 38: OpenCodeModelPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/OpenCodeModelPanel.tsx`

- [ ] Apply Archetype A. Field: `model` from `MODELS_BY_PROVIDER.opencode`.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeModelPanel adopts Archetype A`

### Task 39: OpenCodeInstructionsPanel → Archetype B

**File:** `apps/desktop/src/features/agents/panels/OpenCodeInstructionsPanel.tsx`

- [ ] Apply Archetype B. File: per OpenCode convention (likely `AGENTS.md` or in-config text).
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeInstructionsPanel adopts Archetype B`

### Task 40: OpenCodeAgentsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/OpenCodeAgentsPanel.tsx`

- [ ] Apply Archetype C.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeAgentsPanel adopts Archetype C`

### Task 41: OpenCodeCommandsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/OpenCodeCommandsPanel.tsx`

- [ ] Apply Archetype C.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeCommandsPanel adopts Archetype C`

### Task 42: OpenCodeSkillsPanel → Archetype C

**File:** `apps/desktop/src/features/agents/panels/OpenCodeSkillsPanel.tsx`

- [ ] Apply Archetype C.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodeSkillsPanel adopts Archetype C`

### Task 43: OpenCodePermissionsPanel → Archetype A

**File:** `apps/desktop/src/features/agents/panels/OpenCodePermissionsPanel.tsx`

- [ ] Apply Archetype A.
- [ ] Update, typecheck, commit: `refactor(agents): OpenCodePermissionsPanel adopts Archetype A`

---

## Phase 6 — Polish & verification

### Task 44: Discard-on-scope-switch confirmation

**Files:**
- Modify: `apps/desktop/src/features/agents/AgentsDashboard.tsx`

- [ ] **Step 1: Track dirty state at the dashboard level**

Lift a `dirty` boolean up so the dashboard knows when any panel has unsaved changes. Pass `onDirtyChange` callback into the panels via props.

- [ ] **Step 2: Intercept scope and category switches**

When dirty and user attempts to change `agentHubScope`, `activeCategory`, or `agentHubProjectId`, show a small confirm dialog:

```tsx
<Dialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
  <DialogContent className="max-w-sm">
    <DialogHeader>
      <DialogTitle>Discard unsaved changes?</DialogTitle>
      <DialogDescription>
        You have unsaved edits. Switching scope will discard them.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter className="gap-2">
      <Button variant="outline" onClick={() => setConfirmDiscardOpen(false)}>Keep editing</Button>
      <Button variant="destructive" onClick={() => { applyPendingNav(); setConfirmDiscardOpen(false) }}>
        Discard
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/agents/AgentsDashboard.tsx
git commit -m "feat(agents): confirm discard on scope or category switch"
```

---

### Task 45: Full test suite + typecheck + smoke

- [ ] **Step 1: Run all agent tests**

```bash
cd apps/desktop && npx vitest run src/features/agents/
```
Expected: all pass.

- [ ] **Step 2: Run global typecheck**

```bash
cd apps/desktop && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Run the renderer smoke test**

```bash
cd apps/desktop && npm run test:smoke-renderer
```
Expected: pass.

- [ ] **Step 4: Boot the dev server and manually verify**

```bash
cd apps/desktop && npm run dev:linux
```

Manual checklist:
- Click the Agents tab → Claude tab → lands on Overview, not Settings.
- Project selector defaults to current selected project (top-right).
- Side-by-side global vs project columns render.
- Click a row → jumps into matching panel with correct scope pre-selected.
- Switching scope inside a panel with unsaved changes → confirm dialog.
- "Global only" selection → Overview becomes single column; scope toggle inside panels hides.
- Codex / Gemini / OpenCode tabs each have an Overview as first sidebar item.
- Every panel shows: eyebrow, title, sub, footer with Save (disabled until dirty).
- Empty state: delete CLAUDE.md → panel shows the centered "No CLAUDE.md at this scope" card.

- [ ] **Step 5: Commit the verification log**

```bash
git commit --allow-empty -m "test(agents): full verification pass for config hub redesign"
```

---

## Verification summary

The redesign is complete and correct when every item below is true:

- [ ] All 7 foundation primitives exist with passing tests.
- [ ] `OverviewPanel` exists and is the first sidebar item for every provider.
- [ ] `tokens.ts` is the single source for typography, pill, and surface styles used everywhere.
- [ ] Every panel uses `PanelHeader` and `PanelFooter` — no panel renders its own ad-hoc header or save button.
- [ ] `ProjectSelector` lives in the top bar; selecting "Global only" hides the project column on Overview and hides `ScopeToggle` inside panels.
- [ ] `ScopeToggle` segmented control is visible in every non-Overview panel.
- [ ] Project overrides on the Overview render with the override pill; inherited rows use `text-inherit`.
- [ ] Switching scope with unsaved edits prompts a confirm-discard dialog.
- [ ] `npx tsc --noEmit` returns zero errors.
- [ ] `npx vitest run src/features/agents/` is all green.
