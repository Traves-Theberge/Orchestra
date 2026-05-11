// apps/desktop/src/features/agents/panels/OpenCodeInstructionsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface OpenCodeInstructionsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function OpenCodeInstructionsPanel({ items, scope, projectName, saving, onSave, onCreate }: OpenCodeInstructionsPanelProps) {
  const selected = items[0] ?? null
  const parsed = useMemo(() => safeParse(selected?.content ?? ''), [selected?.content])
  const [instructions, setInstructions] = useState(readInstructions(parsed))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setInstructions(readInstructions(parsed))
    setError('')
  }, [parsed])

  const eyebrow = scope === 'GLOBAL' ? 'Global / Instructions' : `${projectName ?? 'Project'} / Instructions`

  if (!selected) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Instructions"
          sub="Configures the `instructions` array in opencode.json"
        />
        <EmptyStateCard
          title="No config at this scope"
          description="OpenCode instructions are configured through the `instructions` array in opencode.json. Create a config file first."
          ctaLabel="Create Config"
          onCreate={() => { void onCreate() }}
          pending={!!saving}
        />
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Instructions"
          sub={`Writes to ${selected.path}`}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
            <p className="text-[10px]">This OpenCode config could not be parsed cleanly. Use the Config panel raw editor first.</p>
          </div>
        </div>
      </div>
    )
  }

  const isDirty = JSON.stringify(instructions) !== JSON.stringify(readInstructions(parsed))

  const addInstruction = () => {
    const next = draft.trim()
    if (next && !instructions.includes(next)) {
      setInstructions([...instructions, next])
      setDraft('')
    }
  }

  const removeInstruction = (item: string) => {
    setInstructions(instructions.filter((entry) => entry !== item))
  }

  const handleDiscard = () => {
    setInstructions(readInstructions(parsed))
    setDraft('')
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(selected.path, buildConfig(parsed, instructions))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Instructions"
        sub={`Writes to ${selected.path}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1">
            <p className="text-[11px] font-semibold">Instruction Paths</p>
            <p className="text-[10px] text-muted-foreground/50">Use file paths or glob patterns like <code className="font-mono">CONTRIBUTING.md</code>, <code className="font-mono">docs/guidelines.md</code>, or <code className="font-mono">.cursor/rules/*.md</code>.</p>
          </div>

          <section className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {instructions.length > 0 ? instructions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => removeInstruction(item)}
                  className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono"
                >
                  {item}
                </button>
              )) : <span className="text-[10px] italic text-muted-foreground/35">No instruction paths configured</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addInstruction()
                  }
                }}
                placeholder=".cursor/rules/*.md"
                className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <Button size="sm" variant="outline" onClick={addInstruction} className="h-9">Add</Button>
            </div>
          </section>
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === selected.path}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function buildConfig(base: Record<string, unknown>, instructions: string[]) {
  const next = structuredClone(base)
  if (instructions.length > 0) next.instructions = instructions
  else delete next.instructions
  return `${JSON.stringify(next, null, 2)}\n`
}

function readInstructions(parsed: Record<string, unknown> | null): string[] {
  const value = parsed?.instructions
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}
