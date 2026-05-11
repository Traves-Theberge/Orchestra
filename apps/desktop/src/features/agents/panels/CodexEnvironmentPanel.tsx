// apps/desktop/src/features/agents/panels/CodexEnvironmentPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { ProviderFileEntry } from '@core/api/client'

interface CodexEnvironmentPanelProps {
  items: ProviderFileEntry[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
}

export function CodexEnvironmentPanel({ items, scope, projectName, saving, onSave }: CodexEnvironmentPanelProps) {
  const config = items[0] ?? null
  const [content, setContent] = useState(config?.content ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    setContent(config?.content ?? '')
  }, [config?.content])

  const fields = useMemo(() => ({
    history: readTomlScalar(content, 'history.persistence'),
    historyMaxBytes: readTomlScalar(content, 'history.max_bytes'),
    inheritEnv: readTomlScalar(content, 'shell_environment_policy.inherit'),
    includeOnly: readTomlArray(content, 'shell_environment_policy.include_only'),
    exclude: readTomlArray(content, 'shell_environment_policy.exclude'),
    workspaceWriteNetwork: readTomlBoolean(content, 'sandbox_workspace_write.network_access'),
    writableRoots: readTomlArray(content, 'sandbox_workspace_write.writable_roots'),
    fileOpener: readTomlScalar(content, 'file_opener'),
    logDir: readTomlScalar(content, 'log_dir'),
    sqliteHome: readTomlScalar(content, 'sqlite_home'),
    showRawReasoning: readTomlBoolean(content, 'show_raw_agent_reasoning'),
    experimentalUseProfile: readTomlBoolean(content, 'shell_environment_policy.experimental_use_profile'),
    ignoreDefaultExcludes: readTomlBoolean(content, 'shell_environment_policy.ignore_default_excludes'),
    serviceTier: readTomlScalar(content, 'service_tier'),
    hideRateLimitNudge: readTomlBoolean(content, 'notice.hide_rate_limit_model_nudge'),
    hideWorldWritableWarning: readTomlBoolean(content, 'notice.hide_world_writable_warning'),
    notify: readTomlArray(content, 'notify'),
  }), [content])

  const isDirty = content !== (config?.content ?? '')

  const setField = (field: string, value: string) => setContent(prev => writeTomlScalar(prev, field, value))
  const setArrayField = (field: string, value: string) => setContent(prev => writeTomlArray(prev, field, value))
  const setBooleanField = (field: string, value: string) => setContent(prev => writeTomlBoolean(prev, field, value))
  const setNotify = (value: string) => setContent(prev => writeTomlArray(prev, 'notify', value))

  const eyebrow = scope === 'GLOBAL' ? 'Global / Environment' : `${projectName ?? 'Project'} / Environment`

  if (!config) {
    return (
      <div className="flex flex-col h-full p-[18px] space-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Environment"
          sub="env vars passed to codex"
        />
        <div className="flex-1 flex items-center justify-center text-foreground/30">
          <div className="text-center space-y-2">
            <p className="text-sm font-bold uppercase tracking-widest">No config found</p>
            <p className="text-[10px]">Create a Codex config file before editing environment settings.</p>
          </div>
        </div>
      </div>
    )
  }

  const handleSave = async () => {
    setError('')
    try { await onSave(config.path, content) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Environment"
        sub={`env vars passed to codex · ${config.path}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">History Persistence</h4>
        <input
          value={fields.history}
          onChange={(event) => setField('history.persistence', event.target.value)}
          placeholder="save-all"
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">History Max Bytes</h4>
        <input
          value={fields.historyMaxBytes}
          onChange={(event) => setField('history.max_bytes', event.target.value)}
          placeholder="1048576"
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Shell Environment Inherit</h4>
        <input
          value={fields.inheritEnv}
          onChange={(event) => setField('shell_environment_policy.inherit', event.target.value)}
          placeholder="all"
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Shell Include Only</h4>
        <input
          value={fields.includeOnly}
          onChange={(event) => setArrayField('shell_environment_policy.include_only', event.target.value)}
          placeholder="PATH HOME"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Shell Exclude</h4>
        <input
          value={fields.exclude}
          onChange={(event) => setArrayField('shell_environment_policy.exclude', event.target.value)}
          placeholder="AWS_SECRET_ACCESS_KEY"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Workspace Write Network Access</h4>
        <select
          value={fields.workspaceWriteNetwork}
          onChange={(event) => setBooleanField('sandbox_workspace_write.network_access', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Workspace Write Writable Roots</h4>
        <input
          value={fields.writableRoots}
          onChange={(event) => setArrayField('sandbox_workspace_write.writable_roots', event.target.value)}
          placeholder="/tmp /var/tmp"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">File Opener</h4>
        <input
          value={fields.fileOpener}
          onChange={(event) => setField('file_opener', event.target.value)}
          placeholder="vscode"
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Log Directory</h4>
        <input
          value={fields.logDir}
          onChange={(event) => setField('log_dir', event.target.value)}
          placeholder="~/.codex/log"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">SQLite Home</h4>
        <input
          value={fields.sqliteHome}
          onChange={(event) => setField('sqlite_home', event.target.value)}
          placeholder="~/.codex/sqlite"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Service Tier</h4>
        <select
          value={fields.serviceTier}
          onChange={(event) => setField('service_tier', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="fast">fast</option>
          <option value="flex">flex</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Show Raw Agent Reasoning</h4>
        <select
          value={fields.showRawReasoning}
          onChange={(event) => setBooleanField('show_raw_agent_reasoning', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Hide Rate Limit Model Nudge</h4>
        <select
          value={fields.hideRateLimitNudge}
          onChange={(event) => setBooleanField('notice.hide_rate_limit_model_nudge', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Hide World Writable Warning</h4>
        <select
          value={fields.hideWorldWritableWarning}
          onChange={(event) => setBooleanField('notice.hide_world_writable_warning', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Use Shell Profile</h4>
        <select
          value={fields.experimentalUseProfile}
          onChange={(event) => setBooleanField('shell_environment_policy.experimental_use_profile', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Ignore Default Excludes</h4>
        <select
          value={fields.ignoreDefaultExcludes}
          onChange={(event) => setBooleanField('shell_environment_policy.ignore_default_excludes', event.target.value)}
          className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Notify Command</h4>
        <input
          value={fields.notify}
          onChange={(event) => setNotify(event.target.value)}
          placeholder="terminal-notifier -message"
          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1">
        <p className="text-[11px] font-semibold">Partial structured coverage</p>
        <p className="text-[10px] text-foreground/50">This panel covers a few common environment keys. Advanced nested blocks still belong in the raw Codex config editor.</p>
      </div>
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === config.path}
        onSave={handleSave}
        onDiscard={() => setContent(config.content)}
      />
    </div>
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

function readTomlArray(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*\\[(.*?)\\]\\s*$`, 'm')
  const match = content.match(pattern)
  if (!match) return ''
  return match[1].split(',').map(part => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join(' ')
}

function readTomlBoolean(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*(true|false)\\s*$`, 'm')
  return content.match(pattern)?.[1] ?? ''
}

function writeTomlArray(content: string, field: string, value: string): string {
  const parts = value.trim() ? value.trim().split(/\s+/).map(part => `"${part}"`) : []
  const line = parts.length > 0 ? `${field} = [${parts.join(', ')}]` : ''
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=.*$`, 'm')
  if (pattern.test(content)) {
    if (!line) return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
    return content.replace(pattern, line)
  }
  if (!line) return content
  return `${content.trimEnd()}\n${line}\n`
}

function writeTomlBoolean(content: string, field: string, value: string): string {
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
