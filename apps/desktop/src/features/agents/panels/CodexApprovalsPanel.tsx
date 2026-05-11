// apps/desktop/src/features/agents/panels/CodexApprovalsPanel.tsx
import { useEffect, useState } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { ProviderPermissions } from '@core/api/client'
import { APPROVAL_MODES } from '../constants'

interface CodexApprovalsPanelProps {
  permissions: ProviderPermissions
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (perms: ProviderPermissions) => Promise<void>
}

const SANDBOX_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'read-only', label: 'Read Only' },
  { value: 'workspace-write', label: 'Workspace Write' },
  { value: 'danger-full-access', label: 'Danger Full Access' },
]

export function CodexApprovalsPanel({ permissions, scope, projectName, saving, onSave }: CodexApprovalsPanelProps) {
  const [mode, setMode] = useState(permissions.approval_mode)
  const [sandbox, setSandbox] = useState(permissions.sandbox ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    setMode(permissions.approval_mode)
    setSandbox(permissions.sandbox ?? '')
  }, [permissions])

  const isDirty = mode !== permissions.approval_mode || sandbox !== (permissions.sandbox ?? '')

  const eyebrow = scope === 'GLOBAL' ? 'Global / Approvals & Sandbox' : `${projectName ?? 'Project'} / Approvals & Sandbox`

  const handleDiscard = () => {
    setMode(permissions.approval_mode)
    setSandbox(permissions.sandbox ?? '')
  }

  const handleSave = async () => {
    setError('')
    try { await onSave({ ...permissions, approval_mode: mode, sandbox }) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Approvals"
        sub="Writes to .codex/config.toml"
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Approval Policy</h4>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className="w-full max-w-sm px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {APPROVAL_MODES.codex.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Sandbox Mode</h4>
            <select
              value={sandbox}
              onChange={(event) => setSandbox(event.target.value)}
              className="w-full max-w-sm px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {SANDBOX_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1">
            <p className="text-[11px] font-semibold">Scope-aware</p>
            <p className="text-[10px] text-foreground/50">These controls write to the selected global or project <code className="font-mono">.codex/config.toml</code>.</p>
          </div>
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
