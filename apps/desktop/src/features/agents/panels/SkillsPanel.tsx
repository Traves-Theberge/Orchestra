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
import { usePublishDirty } from '../hooks/use-publish-dirty'

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
  globalItems: ClaudeFileEntry[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (name: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

type DisplayItem = ClaudeFileEntry & { isInherited: boolean }

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

  const inheritedItems: ClaudeFileEntry[] = scope === 'PROJECT'
    ? globalItems.filter(g => !items.some(p => p.name === g.name))
    : []
  const displayItems: DisplayItem[] = [
    ...items.map(i => ({ ...i, isInherited: false as boolean })),
    ...inheritedItems.map(i => ({ ...i, isInherited: true as boolean })),
  ]

  useEffect(() => {
    if (!selectedName && displayItems.length > 0) setSelectedName(displayItems[0].name)
  }, [selectedName, displayItems])

  useEffect(() => {
    if (selectedName && !displayItems.find(i => i.name === selectedName)) {
      setSelectedName(displayItems.length > 0 ? displayItems[0].name : null)
    }
  }, [selectedName, displayItems])

  const selected = displayItems.find(i => i.name === selectedName) ?? null
  useEffect(() => { setContent(selected?.content ?? ''); setError('') }, [selected])

  const dirty = selected && !selected.isInherited ? content !== selected.content : false
  usePublishDirty(!!dirty)
  const projectCount = items.length
  const inheritedCount = inheritedItems.length

  if (displayItems.length === 0 && scope === 'PROJECT' && projectName) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={`${projectName} / Skills`}
          title="Skills"
          sub="No project skills · inherits 0 from global"
        />
        <EmptyStateCard
          title="No skills at this scope"
          description="Add a skill to make it available to this project."
          ctaLabel="New skill"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createOpen}
          name={createName}
          setName={setCreateName}
          onCancel={() => { setCreateOpen(false); setCreateName('') }}
          onCreate={async () => {
            const n = createName.trim()
            if (!n) return
            await onSave(n, SKILL_TEMPLATE.replaceAll('{{NAME}}', n))
            setSelectedName(n)
            setCreateOpen(false); setCreateName('')
          }}
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
        dirty={!!dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => setContent(selected?.content ?? '')}
        extraLeft={
          selected && !selected.isInherited ? (
            <button
              type="button"
              onClick={() => setDeleteTarget(selected.name)}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={createOpen}
        name={createName}
        setName={setCreateName}
        onCancel={() => { setCreateOpen(false); setCreateName('') }}
        onCreate={async () => {
          const n = createName.trim()
          if (!n) return
          await onSave(n, SKILL_TEMPLATE.replaceAll('{{NAME}}', n))
          setSelectedName(n)
          setCreateOpen(false); setCreateName('')
        }}
      />

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

function CreateDialog({
  open, name, setName, onCancel, onCreate,
}: {
  open: boolean
  name: string
  setName: (s: string) => void
  onCancel: () => void
  onCreate: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>Creates a markdown file in the skills directory.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
            placeholder="e.g. refactor-helper"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim()}>
            <Plus size={12} className="mr-2" /> Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
