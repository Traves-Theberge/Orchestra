// apps/desktop/src/features/agents/panels/CodexSubAgentsPanel.tsx
import { useId, useMemo, useReducer } from 'react'
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

const EMPTY_NICKNAMES: string[] = []

type GlobalSettings = {
  maxThreads: string
  maxDepth: string
  jobRuntime: string
}

type PanelState = {
  selectedPath: string | null
  drafts: Record<string, string>
  createOpen: boolean
  createName: string
  deleteTarget: string | null
  error: string
}

type PanelAction =
  | { type: 'select', path: string | null }
  | { type: 'set-draft', path: string, value: string }
  | { type: 'reset-draft', path: string, value: string }
  | { type: 'open-create' }
  | { type: 'close-create' }
  | { type: 'set-create-name', value: string }
  | { type: 'set-delete-target', value: string | null }
  | { type: 'set-error', value: string }

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedPath: action.path }
    case 'set-draft':
      return { ...state, drafts: { ...state.drafts, [action.path]: action.value } }
    case 'reset-draft':
      return { ...state, drafts: { ...state.drafts, [action.path]: action.value } }
    case 'open-create':
      return { ...state, createOpen: true }
    case 'close-create':
      return { ...state, createOpen: false, createName: '' }
    case 'set-create-name':
      return { ...state, createName: action.value }
    case 'set-delete-target':
      return { ...state, deleteTarget: action.value }
    case 'set-error':
      return { ...state, error: action.value }
  }
}

type ConfigState = {
  description: string
  configFile: string
  nicknameCandidates: string
}

type ConfigAction =
  | { type: 'set-description', value: string }
  | { type: 'set-config-file', value: string }
  | { type: 'set-nicknames', value: string }

function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case 'set-description': return { ...state, description: action.value }
    case 'set-config-file': return { ...state, configFile: action.value }
    case 'set-nicknames': return { ...state, nicknameCandidates: action.value }
  }
}

type GlobalState = GlobalSettings

type GlobalAction =
  | { type: 'set-max-threads', value: string }
  | { type: 'set-max-depth', value: string }
  | { type: 'set-job-runtime', value: string }

function globalReducer(state: GlobalState, action: GlobalAction): GlobalState {
  switch (action.type) {
    case 'set-max-threads': return { ...state, maxThreads: action.value }
    case 'set-max-depth': return { ...state, maxDepth: action.value }
    case 'set-job-runtime': return { ...state, jobRuntime: action.value }
  }
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
  const [state, dispatch] = useReducer(panelReducer, undefined as never, () => ({
    selectedPath: items[0]?.path ?? null,
    drafts: {},
    createOpen: false,
    createName: '',
    deleteTarget: null,
    error: '',
  }))
  const configBlocks = useMemo(() => parseAgentConfigBlocks(configContent), [configContent])
  const globalSettings = useMemo(() => parseAgentGlobalSettings(configContent), [configContent])

  const effectiveSelectedPath = state.selectedPath && items.some(item => item.path === state.selectedPath)
    ? state.selectedPath
    : (items[0]?.path ?? null)
  const selected = items.find(item => item.path === effectiveSelectedPath) ?? null
  const content = selected ? (state.drafts[selected.path] ?? selected.content) : ''
  const isDirty = selected ? content !== selected.content : false
  const agentName = selected ? selected.path.split('/').pop()?.replace(/\.toml$/i, '') ?? '' : ''
  const agentConfig: AgentConfigBlock = configBlocks.find(block => block.name === agentName) ?? { name: agentName, description: '', configFile: '', nicknameCandidates: EMPTY_NICKNAMES }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Sub-agents' : `${projectName ?? 'Project'} / Sub-agents`

  const handleCreate = async () => {
    if (!state.createName.trim()) return
    try { await onCreate(state.createName.trim()) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to create' })
      return
    }
    dispatch({ type: 'close-create' })
  }

  const handleSaveAgent = async () => {
    if (!selected) return
    dispatch({ type: 'set-error', value: '' })
    try { await onSave(selected.path, content) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  const handleDelete = async () => {
    if (!state.deleteTarget) return
    try { await onDelete(state.deleteTarget) } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to delete' })
    }
    dispatch({ type: 'set-delete-target', value: null })
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Sub-agents"
          sub=".codex/agents/ · 0 sub-agents"
        />
        <EmptyStateCard
          title="No sub-agents at this scope"
          description="Create a Codex subagent to manage both the agent TOML file and its config routing block."
          ctaLabel="New sub-agent"
          onCreate={() => dispatch({ type: 'open-create' })}
        />
        <CreateDialog
          open={state.createOpen}
          name={state.createName}
          setName={(value) => dispatch({ type: 'set-create-name', value })}
          onCancel={() => dispatch({ type: 'close-create' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  const configKey = `${agentName}::${agentConfig.description}::${agentConfig.configFile}::${agentConfig.nicknameCandidates.join(' ')}`
  const globalKey = `${globalSettings.maxThreads}::${globalSettings.maxDepth}::${globalSettings.jobRuntime}`

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Sub-agents"
        sub={`.codex/agents/ · ${items.length} sub-agent${items.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'open-create' })} className="w-full h-7 text-[10px]">
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
                  onClick={() => dispatch({ type: 'select', path: item.path })}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] ${
                    item.path === effectiveSelectedPath ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
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
                onChange={(event) => dispatch({ type: 'set-draft', path: selected.path, value: event.target.value })}
                className="min-h-[200px] bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-y transition-colors"
                spellCheck={false}
              />

              <ConfigBlockSection
                key={configKey}
                agentName={agentName}
                agentConfig={agentConfig}
                configPath={configPath}
                configContent={configContent}
                saving={saving}
                onSaveConfig={onSaveConfig}
                onError={(value) => dispatch({ type: 'set-error', value })}
              />

              <GlobalLimitsSection
                key={globalKey}
                globalSettings={globalSettings}
                configPath={configPath}
                configContent={configContent}
                saving={saving}
                onSaveConfig={onSaveConfig}
                onError={(value) => dispatch({ type: 'set-error', value })}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a sub-agent or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={state.error} onDismiss={() => dispatch({ type: 'set-error', value: '' })} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === (selected?.path ?? '')}
        onSave={handleSaveAgent}
        onDiscard={() => selected && dispatch({ type: 'reset-draft', path: selected.path, value: selected.content })}
        extraLeft={
          selected ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'set-delete-target', value: agentName })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={state.createOpen}
        name={state.createName}
        setName={(value) => dispatch({ type: 'set-create-name', value })}
        onCancel={() => dispatch({ type: 'close-create' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!state.deleteTarget} onOpenChange={(o) => !o && dispatch({ type: 'set-delete-target', value: null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete sub-agent</DialogTitle>
            <DialogDescription>This removes the agent TOML file from disk. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{state.deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'set-delete-target', value: null })}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ConfigBlockSectionProps {
  agentName: string
  agentConfig: AgentConfigBlock
  configPath: string
  configContent: string
  saving: string | null
  onSaveConfig: (path: string, content: string) => Promise<void>
  onError: (value: string) => void
}

function ConfigBlockSection({ agentName, agentConfig, configPath, configContent, saving, onSaveConfig, onError }: ConfigBlockSectionProps) {
  const [config, dispatch] = useReducer(configReducer, undefined as never, () => ({
    description: agentConfig.description,
    configFile: agentConfig.configFile,
    nicknameCandidates: agentConfig.nicknameCandidates.join(' '),
  }))

  const isConfigDirty =
    config.description !== agentConfig.description ||
    config.configFile !== agentConfig.configFile ||
    config.nicknameCandidates !== agentConfig.nicknameCandidates.join(' ')

  const handleSaveConfigBlock = async () => {
    if (!configPath || !agentName) return
    onError('')
    try {
      await onSaveConfig(configPath, upsertAgentConfigBlock(configContent, {
        name: agentName,
        description: config.description,
        configFile: config.configFile,
        nicknameCandidates: config.nicknameCandidates.split(/\s+/).flatMap((item: string) => {
          const trimmed = item.trim()
          return trimmed ? [trimmed] : []
        }),
      }))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="rounded-lg border border-border/30 bg-background p-3 shrink-0 space-y-3">
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
      <AgentField label="Description" value={config.description} onChange={(value) => dispatch({ type: 'set-description', value })} />
      <AgentField label="Config File" value={config.configFile} onChange={(value) => dispatch({ type: 'set-config-file', value })} placeholder=".codex/agents/reviewer.toml" />
      <AgentField label="Nickname Candidates" value={config.nicknameCandidates} onChange={(value) => dispatch({ type: 'set-nicknames', value })} placeholder="reviewer critic analyst" />
    </div>
  )
}

interface GlobalLimitsSectionProps {
  globalSettings: GlobalSettings
  configPath: string
  configContent: string
  saving: string | null
  onSaveConfig: (path: string, content: string) => Promise<void>
  onError: (value: string) => void
}

function GlobalLimitsSection({ globalSettings, configPath, configContent, saving, onSaveConfig, onError }: GlobalLimitsSectionProps) {
  const [limits, dispatch] = useReducer(globalReducer, undefined as never, () => ({
    maxThreads: globalSettings.maxThreads,
    maxDepth: globalSettings.maxDepth,
    jobRuntime: globalSettings.jobRuntime,
  }))

  const isGlobalDirty =
    limits.maxThreads !== globalSettings.maxThreads ||
    limits.maxDepth !== globalSettings.maxDepth ||
    limits.jobRuntime !== globalSettings.jobRuntime

  const handleSaveGlobalSettings = async () => {
    if (!configPath) return
    onError('')
    try {
      await onSaveConfig(configPath, upsertAgentGlobalSettings(configContent, {
        maxThreads: limits.maxThreads,
        maxDepth: limits.maxDepth,
        jobRuntime: limits.jobRuntime,
      }))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="rounded-lg border border-border/30 bg-background p-3 shrink-0 space-y-3">
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
      <AgentField label="Max Threads" value={limits.maxThreads} onChange={(value) => dispatch({ type: 'set-max-threads', value })} placeholder="6" />
      <AgentField label="Max Depth" value={limits.maxDepth} onChange={(value) => dispatch({ type: 'set-max-depth', value })} placeholder="1" />
      <AgentField label="Job Runtime Seconds" value={limits.jobRuntime} onChange={(value) => dispatch({ type: 'set-job-runtime', value })} placeholder="1800" />
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
  const nameId = useId()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New sub-agent</DialogTitle>
          <DialogDescription>Creates a Codex subagent TOML file for the selected scope.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Sub-agent name</label>
          <input
            id={nameId}
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
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">{label}</h4>
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
      current.nicknameCandidates = array[1].split(',').flatMap(item => {
        const cleaned = item.trim().replace(/^["']|["']$/g, '')
        return cleaned ? [cleaned] : []
      })
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

function parseAgentGlobalSettings(content: string): GlobalSettings {
  return {
    maxThreads: readGlobalScalar(content, 'agents.max_threads'),
    maxDepth: readGlobalScalar(content, 'agents.max_depth'),
    jobRuntime: readGlobalScalar(content, 'agents.job_max_runtime_seconds'),
  }
}

function upsertAgentGlobalSettings(content: string, settings: GlobalSettings): string {
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
