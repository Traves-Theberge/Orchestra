// apps/desktop/src/features/agents/panels/CodexSubAgentsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Scope } from '../types'
import type { ProviderFileEntry } from '@core/api/client'

interface CodexSubAgentsPanelProps {
  items: ProviderFileEntry[]
  configContent: string
  configPath: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onSaveConfig: (path: string, content: string) => Promise<void>
}

type AgentConfigBlock = {
  name: string
  description: string
  configFile: string
  nicknameCandidates: string[]
}

export function CodexSubAgentsPanel({
  items,
  configContent,
  configPath,
  scope,
  projectName,
  saving,
  onSave,
  onDelete,
  onCreate,
  onSaveConfig,
}: CodexSubAgentsPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(items[0]?.path ?? null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [error, setError] = useState('')
  const configBlocks = useMemo(() => parseAgentConfigBlocks(configContent), [configContent])

  useEffect(() => {
    if (!selectedPath && items.length > 0) setSelectedPath(items[0].path)
    if (selectedPath && !items.some(item => item.path === selectedPath)) {
      setSelectedPath(items[0]?.path ?? null)
    }
  }, [items, selectedPath])

  const selected = items.find(item => item.path === selectedPath) ?? null
  const content = selected ? (drafts[selected.path] ?? selected.content) : ''
  const isDirty = selected ? content !== selected.content : false
  const agentName = selected ? selected.path.split('/').pop()?.replace(/\.toml$/i, '') ?? '' : ''
  const agentConfig: AgentConfigBlock = configBlocks.find(block => block.name === agentName) ?? { name: agentName, description: '', configFile: '', nicknameCandidates: [] }
  const [description, setDescription] = useState(agentConfig.description)
  const [configFile, setConfigFile] = useState(agentConfig.configFile)
  const [nicknameCandidates, setNicknameCandidates] = useState(agentConfig.nicknameCandidates.join(' '))
  const globalSettings = useMemo(() => parseAgentGlobalSettings(configContent), [configContent])
  const [maxThreads, setMaxThreads] = useState(globalSettings.maxThreads)
  const [maxDepth, setMaxDepth] = useState(globalSettings.maxDepth)
  const [jobRuntime, setJobRuntime] = useState(globalSettings.jobRuntime)

  useEffect(() => {
    setDescription(agentConfig.description)
    setConfigFile(agentConfig.configFile)
    setNicknameCandidates(agentConfig.nicknameCandidates.join(' '))
  }, [agentConfig.description, agentConfig.configFile, agentConfig.nicknameCandidates, agentName])

  useEffect(() => {
    setMaxThreads(globalSettings.maxThreads)
    setMaxDepth(globalSettings.maxDepth)
    setJobRuntime(globalSettings.jobRuntime)
  }, [globalSettings.jobRuntime, globalSettings.maxDepth, globalSettings.maxThreads])

  const isConfigDirty =
    description !== agentConfig.description ||
    configFile !== agentConfig.configFile ||
    nicknameCandidates !== agentConfig.nicknameCandidates.join(' ')
  const isGlobalDirty =
    maxThreads !== globalSettings.maxThreads ||
    maxDepth !== globalSettings.maxDepth ||
    jobRuntime !== globalSettings.jobRuntime

  const eyebrow = scope === 'GLOBAL' ? 'Global / Sub-agents' : `${projectName ?? 'Project'} / Sub-agents`

  const handleCreate = async () => {
    if (!createName.trim()) return
    try { await onCreate(createName.trim()) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      return
    }
    setCreateOpen(false)
    setCreateName('')
  }

  const handleSaveAgent = async () => {
    if (!selected) return
    setError('')
    try { await onSave(selected.path, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleSaveConfigBlock = async () => {
    if (!configPath || !agentName) return
    setError('')
    try {
      await onSaveConfig(configPath, upsertAgentConfigBlock(configContent, {
        name: agentName,
        description,
        configFile,
        nicknameCandidates: nicknameCandidates.split(/\s+/).map((item: string) => item.trim()).filter(Boolean),
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleSaveGlobalSettings = async () => {
    if (!configPath) return
    setError('')
    try {
      await onSaveConfig(configPath, upsertAgentGlobalSettings(configContent, {
        maxThreads,
        maxDepth,
        jobRuntime,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await onDelete(deleteTarget) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
    setDeleteTarget(null)
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px] space-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Sub-agents"
          sub=".codex/agents/ · 0 sub-agents"
        />
        <EmptyStateCard
          title="No sub-agents at this scope"
          description="Create a Codex subagent to manage both the agent TOML file and its config routing block."
          ctaLabel="New sub-agent"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createOpen}
          name={createName}
          setName={setCreateName}
          onCancel={() => { setCreateOpen(false); setCreateName('') }}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Sub-agents"
        sub={`.codex/agents/ · ${items.length} sub-agent${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New sub-agent
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => {
              const name = item.path.split('/').pop()?.replace(/\.toml$/i, '') ?? item.name
              const block = configBlocks.find(candidate => candidate.name === name)
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] ${
                    item.path === selectedPath ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                  }`}
                >
                  <div className="truncate font-semibold">{item.name}</div>
                  {block?.description ? <p className="text-[9px] mt-0.5 text-foreground/35 truncate">{block.description}</p> : null}
                </button>
              )
            })}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono">
                {selected.path}
              </div>

              <textarea
                value={content}
                onChange={(event) => setDrafts(prev => ({ ...prev, [selected.path]: event.target.value }))}
                className="min-h-[200px] bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-y transition-colors"
                spellCheck={false}
              />

              <div className="rounded-lg border border-border/30 bg-background px-3 py-3 shrink-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Agent Routing Config</p>
                    <p className="text-[10px] text-foreground/50 mt-1">Writes the <code className="font-mono">[agents.{agentName}]</code> block inside the active Codex config.</p>
                  </div>
                  {isConfigDirty ? (
                    <Button
                      size="sm"
                      onClick={handleSaveConfigBlock}
                      disabled={saving === configPath}
                      className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
                    >
                      {saving === configPath ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
                      Save block
                    </Button>
                  ) : null}
                </div>
                <AgentField label="Description" value={description} onChange={setDescription} />
                <AgentField label="Config File" value={configFile} onChange={setConfigFile} placeholder=".codex/agents/reviewer.toml" />
                <AgentField label="Nickname Candidates" value={nicknameCandidates} onChange={setNicknameCandidates} placeholder="reviewer critic analyst" />
              </div>

              <div className="rounded-lg border border-border/30 bg-background px-3 py-3 shrink-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Global Agent Limits</p>
                    <p className="text-[10px] text-foreground/50 mt-1">Writes top-level <code className="font-mono">agents.max_threads</code>, <code className="font-mono">agents.max_depth</code>, and <code className="font-mono">agents.job_max_runtime_seconds</code>.</p>
                  </div>
                  {isGlobalDirty ? (
                    <Button
                      size="sm"
                      onClick={handleSaveGlobalSettings}
                      disabled={saving === configPath}
                      className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
                    >
                      {saving === configPath ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
                      Save limits
                    </Button>
                  ) : null}
                </div>
                <AgentField label="Max Threads" value={maxThreads} onChange={setMaxThreads} placeholder="6" />
                <AgentField label="Max Depth" value={maxDepth} onChange={setMaxDepth} placeholder="1" />
                <AgentField label="Job Runtime Seconds" value={jobRuntime} onChange={setJobRuntime} placeholder="1800" />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a sub-agent or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === (selected?.path ?? '')}
        onSave={handleSaveAgent}
        onDiscard={() => selected && setDrafts(prev => ({ ...prev, [selected.path]: selected.content }))}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => setDeleteTarget(agentName)}
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
        onCreate={handleCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete sub-agent</DialogTitle>
            <DialogDescription>This removes the agent TOML file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
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
          <DialogTitle>New sub-agent</DialogTitle>
          <DialogDescription>Creates a Codex subagent TOML file for the selected scope.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Sub-agent name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, '-'))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. reviewer"
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
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

function AgentField({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (value: string) => void, placeholder?: string }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </section>
  )
}

function parseAgentConfigBlocks(content: string): AgentConfigBlock[] {
  const lines = content.split('\n')
  const blocks: AgentConfigBlock[] = []
  let current: AgentConfigBlock | null = null

  for (const line of lines) {
    const header = line.match(/^\[agents\.([^\]]+)\]\s*$/)
    if (header) {
      if (current) blocks.push(current)
      current = { name: header[1], description: '', configFile: '', nicknameCandidates: [] }
      continue
    }
    if (!current) continue
    if (/^\[.*\]\s*$/.test(line)) {
      blocks.push(current)
      current = null
      continue
    }

    const scalar = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*["']?([^"'\n]+)["']?\s*$/)
    const array = line.match(/^nickname_candidates\s*=\s*\[(.*?)\]\s*$/)
    if (array) {
      current.nicknameCandidates = array[1].split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      continue
    }
    if (!scalar) continue
    if (scalar[1] === 'description') current.description = scalar[2].trim()
    if (scalar[1] === 'config_file') current.configFile = scalar[2].trim()
  }

  if (current) blocks.push(current)
  return blocks
}

function upsertAgentConfigBlock(content: string, block: AgentConfigBlock): string {
  const section = buildAgentSection(block)
  const pattern = new RegExp(`\\[agents\\.${escapeRegExp(block.name)}\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, section).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  }
  return `${content.trimEnd()}\n\n${section}\n`
}

function buildAgentSection(block: AgentConfigBlock): string {
  const lines = [`[agents.${block.name}]`]
  if (block.description.trim()) lines.push(`description = "${block.description.trim()}"`)
  if (block.configFile.trim()) lines.push(`config_file = "${block.configFile.trim()}"`)
  if (block.nicknameCandidates.length > 0) {
    lines.push(`nickname_candidates = [${block.nicknameCandidates.map(item => `"${item}"`).join(', ')}]`)
  }
  return lines.join('\n')
}

function parseAgentGlobalSettings(content: string): { maxThreads: string, maxDepth: string, jobRuntime: string } {
  return {
    maxThreads: readGlobalScalar(content, 'agents.max_threads'),
    maxDepth: readGlobalScalar(content, 'agents.max_depth'),
    jobRuntime: readGlobalScalar(content, 'agents.job_max_runtime_seconds'),
  }
}

function upsertAgentGlobalSettings(content: string, settings: { maxThreads: string, maxDepth: string, jobRuntime: string }): string {
  let next = content
  next = writeGlobalNumber(next, 'agents.max_threads', settings.maxThreads)
  next = writeGlobalNumber(next, 'agents.max_depth', settings.maxDepth)
  next = writeGlobalNumber(next, 'agents.job_max_runtime_seconds', settings.jobRuntime)
  return next
}

function readGlobalScalar(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function writeGlobalNumber(content: string, field: string, value: string): string {
  const normalized = value.trim()
  const line = normalized ? `${field} = ${normalized}` : ''
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
