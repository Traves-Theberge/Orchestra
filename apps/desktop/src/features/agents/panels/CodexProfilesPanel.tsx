// apps/desktop/src/features/agents/panels/CodexProfilesPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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

interface CodexProfilesPanelProps {
  items: ProviderFileEntry[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
}

type ProfileSummary = {
  name: string
  model: string
  approvalPolicy: string
  sandboxMode: string
}

export function CodexProfilesPanel({ items, scope, projectName, saving, onSave }: CodexProfilesPanelProps) {
  const config = items[0] ?? null
  const profiles = useMemo(() => extractProfiles(config?.content ?? ''), [config?.content])
  const [selectedName, setSelectedName] = useState<string | null>(profiles[0]?.name ?? null)
  const [draft, setDraft] = useState<ProfileSummary | null>(profiles[0] ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedName && profiles.length > 0) setSelectedName(profiles[0].name)
    if (selectedName && !profiles.some(profile => profile.name === selectedName)) {
      setSelectedName(profiles[0]?.name ?? null)
    }
  }, [profiles, selectedName])

  useEffect(() => {
    const selected = profiles.find(profile => profile.name === selectedName) ?? null
    setDraft(selected)
  }, [profiles, selectedName])

  const selected = profiles.find(profile => profile.name === selectedName) ?? null
  const isDirty = JSON.stringify(draft) !== JSON.stringify(selected)

  const eyebrow = scope === 'GLOBAL' ? 'Global / Profiles' : `${projectName ?? 'Project'} / Profiles`

  if (!config) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Codex profiles"
          sub="Named TOML configurations"
        />
        <div className="flex-1 flex items-center justify-center text-foreground/30">
          <div className="text-center space-y-2">
            <p className="text-sm font-bold uppercase tracking-widest">No config found</p>
            <p className="text-[10px]">Create a Codex config file before editing profiles.</p>
          </div>
        </div>
      </div>
    )
  }

  const saveDraft = async () => {
    if (!draft) return
    setError('')
    try { await onSave(config.path, upsertProfile(config.content, draft)) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const deleteSelected = async () => {
    if (!deleteTarget) return
    setError('')
    try {
      await onSave(config.path, removeProfile(config.content, deleteTarget))
      setDeleteTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const createProfile = async () => {
    const name = createName.trim()
    if (!name || !config) return
    const profile: ProfileSummary = { name, model: '', approvalPolicy: '', sandboxMode: '' }
    try { await onSave(config.path, upsertProfile(config.content, profile)) } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      return
    }
    setCreateOpen(false)
    setCreateName('')
    setSelectedName(name)
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col h-full p-[18px] space-y-[14px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Codex profiles"
          sub={`Named TOML configurations · 0 profiles`}
        />
        <EmptyStateCard
          title="No profiles at this scope"
          description="Add a profile to create a [profiles.*] block in the Codex config."
          ctaLabel="New profile"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog
          open={createOpen}
          name={createName}
          setName={setCreateName}
          onCancel={() => { setCreateOpen(false); setCreateName('') }}
          onCreate={createProfile}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Codex profiles"
        sub={`Named TOML configurations · ${profiles.length} profile${profiles.length === 1 ? '' : 's'}`}
        dirty={isDirty}
      />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[200px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New profile
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {profiles.map(profile => (
              <button
                key={profile.name}
                type="button"
                onClick={() => setSelectedName(profile.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] ${
                  profile.name === selectedName ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                <div className="truncate font-semibold">{profile.name}</div>
                {profile.model ? <p className="text-[9px] mt-0.5 font-mono text-foreground/35 truncate">{profile.model}</p> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {draft ? (
            <div className="overflow-y-auto pr-1 max-w-2xl mx-auto w-full flex flex-col gap-4">
              <div className="text-[10px] text-foreground/45 font-mono">
                {draft.name} · [profiles.{draft.name}]
              </div>
              <ProfileField label="Model" value={draft.model} onChange={(value) => setDraft(current => current ? { ...current, model: value } : current)} />
              <ProfileField label="Approval Policy" value={draft.approvalPolicy} onChange={(value) => setDraft(current => current ? { ...current, approvalPolicy: value } : current)} />
              <ProfileField label="Sandbox Mode" value={draft.sandboxMode} onChange={(value) => setDraft(current => current ? { ...current, sandboxMode: value } : current)} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a profile or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={!!isDirty}
        saving={saving === config.path}
        onSave={saveDraft}
        onDiscard={() => setDraft(selected)}
        extraLeft={
          selected ? (
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
        onCreate={createProfile}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete profile</DialogTitle>
            <DialogDescription>This removes the [profiles.*] block from the Codex config.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteSelected}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProfileField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </section>
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
          <DialogTitle>New profile</DialogTitle>
          <DialogDescription>Creates a new [profiles.*] block in the current Codex config.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Profile name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="e.g. review"
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

function extractProfiles(content: string): ProfileSummary[] {
  const lines = content.split('\n')
  const profiles: ProfileSummary[] = []
  let current: ProfileSummary | null = null

  for (const line of lines) {
    const header = line.match(/^\[profiles\.([^\]]+)\]\s*$/)
    if (header) {
      if (current) profiles.push(current)
      current = { name: header[1], model: '', approvalPolicy: '', sandboxMode: '' }
      continue
    }
    if (!current) continue
    if (/^\[.*\]\s*$/.test(line)) {
      profiles.push(current)
      current = null
      continue
    }

    const scalar = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*["']?([^"'\n]+)["']?\s*$/)
    if (!scalar) continue

    if (scalar[1] === 'model') current.model = scalar[2].trim()
    if (scalar[1] === 'approval_policy') current.approvalPolicy = scalar[2].trim()
    if (scalar[1] === 'sandbox_mode') current.sandboxMode = scalar[2].trim()
  }

  if (current) profiles.push(current)
  return profiles
}

function upsertProfile(content: string, profile: ProfileSummary): string {
  const section = buildProfileSection(profile)
  const pattern = new RegExp(`\\[profiles\\.${escapeRegExp(profile.name)}\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, section).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  }
  return `${content.trimEnd()}\n\n${section}\n`
}

function removeProfile(content: string, name: string): string {
  const pattern = new RegExp(`\\n?\\[profiles\\.${escapeRegExp(name)}\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`, 'm')
  return content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function buildProfileSection(profile: ProfileSummary): string {
  const lines = [`[profiles.${profile.name}]`]
  if (profile.model.trim()) lines.push(`model = "${profile.model.trim()}"`)
  if (profile.approvalPolicy.trim()) lines.push(`approval_policy = "${profile.approvalPolicy.trim()}"`)
  if (profile.sandboxMode.trim()) lines.push(`sandbox_mode = "${profile.sandboxMode.trim()}"`)
  return lines.join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
