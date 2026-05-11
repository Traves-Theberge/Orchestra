// apps/desktop/src/features/agents/panels/CodexConfigPanel.tsx
import { useState } from 'react'
import { Code, Plus, Settings2 } from 'lucide-react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface CodexConfigPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function CodexConfigPanel({ items, scope, projectName, saving, onSave, onCreate }: CodexConfigPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Record<string, 'structured' | 'raw'>>({})
  const [error, setError] = useState('')

  const effectiveSelectedKey = selectedKey && items.some(item => item.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(item => item.key === effectiveSelectedKey) ?? null
  const content = selected ? (drafts[selected.key] ?? selected.content) : ''
  const editorMode = selected ? (mode[selected.key] ?? 'structured') : 'structured'
  const isDirty = selected ? content !== selected.content : false

  const tomlFields = selected ? {
    model: readTomlScalar(content, 'model'),
    approvalPolicy: readTomlScalar(content, 'approval_policy'),
    sandboxMode: readTomlScalar(content, 'sandbox_mode'),
    reasoningEffort: readTomlScalar(content, 'model_reasoning_effort'),
  } : null

  const setContentForSelected = (next: string) => {
    if (!selected) return
    setDrafts(prev => ({ ...prev, [selected.key]: next }))
  }

  const setTomlField = (field: string, value: string) => {
    setContentForSelected(writeTomlScalar(content, field, value))
  }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Codex Config' : `${projectName ?? 'Project'} / Codex Config`

  const handleSave = async () => {
    if (!selected) return
    setError('')
    try { await onSave(selected.path, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDiscard = () => {
    if (!selected) return
    setDrafts(prev => ({ ...prev, [selected.key]: selected.content }))
  }

  const modeToggle = selected ? (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setMode(prev => ({ ...prev, [selected.key]: (prev[selected.key] ?? 'structured') === 'structured' ? 'raw' : 'structured' }))}
      className="h-7 text-[10px] gap-1.5"
    >
      {editorMode === 'structured' ? <Code size={10} /> : <Settings2 size={10} />}
      {editorMode === 'structured' ? 'Raw' : 'Structured'}
    </Button>
  ) : null

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Codex config"
        sub={selected ? `Writes to ${selected.path}` : 'Writes to .codex/config.toml'}
        dirty={isDirty}
        rightSlot={modeToggle ?? undefined}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="px-3 pt-3 pb-2 shrink-0">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Codex Config</h3>
            <p className="text-[10px] text-foreground/35 mt-0.5">config.toml</p>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className={`w-full text-left px-2.5 py-2 rounded-md transition-colors border ${
                  item.key === effectiveSelectedKey
                    ? 'bg-primary/8 text-primary border-primary/20'
                    : 'text-foreground/65 hover:bg-foreground/[0.03] border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold truncate flex-1">{item.name}</span>
                  {item.badge ? <span className="text-[8px] font-bold uppercase tracking-wider rounded-full border border-border/40 px-1.5 py-0.5 text-foreground/50">{item.badge}</span> : null}
                </div>
                <p className="text-[9px] mt-1 font-mono text-foreground/35 truncate">{item.path}</p>
              </button>
            ))}
          </div>
          <div className="p-2 shrink-0 border-t border-border/30">
            <Button size="sm" variant="ghost" onClick={() => onCreate()} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> Create Config
            </Button>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            editorMode === 'structured' ? (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                <div className="max-w-2xl mx-auto space-y-5">
                  <StructuredField label="Model" value={tomlFields?.model ?? ''} onChange={(value) => setTomlField('model', value)} />
                  <StructuredField label="Approval Policy" value={tomlFields?.approvalPolicy ?? ''} onChange={(value) => setTomlField('approval_policy', value)} />
                  <StructuredField label="Sandbox Mode" value={tomlFields?.sandboxMode ?? ''} onChange={(value) => setTomlField('sandbox_mode', value)} />
                  <StructuredField label="Reasoning Effort" value={tomlFields?.reasoningEffort ?? ''} onChange={(value) => setTomlField('model_reasoning_effort', value)} />
                  <div className="rounded-lg border border-border/30 bg-muted/10 p-3">
                    <p className="text-[11px] font-semibold">TOML Config</p>
                    <p className="text-[10px] text-foreground/50 mt-1">This structured view only manages common top-level Codex keys. Switch to raw mode for nested or advanced settings.</p>
                  </div>
                </div>
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(event) => setContentForSelected(event.target.value)}
                className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
                spellCheck={false}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-foreground/30">
              <div className="text-center space-y-2 max-w-md">
                <p className="text-sm font-bold uppercase tracking-widest">No config found</p>
                <p className="text-[10px]">Codex configuration is file-based and scoped by global or project context.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === (selected?.path ?? '')}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function StructuredField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </section>
  )
}

function readTomlScalar(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function writeTomlScalar(content: string, field: string, value: string): string {
  const normalized = value.trim()
  const line = normalized ? `${field} = "${normalized}"` : ''
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=.*$`, 'm')
  if (pattern.test(content)) {
    if (!line) return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
    return content.replace(pattern, line)
  }
  if (!line) return content
  return `${content.trimEnd()}\n${line}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
