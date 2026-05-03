// apps/desktop/src/features/settings/TrackerConnectionDrawer.tsx
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { BackendConfig } from '@core/api/client'
import { createTrackerConfig, updateTrackerConfig } from '@core/api/client'
import type { TrackerConfig } from '@/entities/tracker/types'

interface Props {
  config: BackendConfig | null
  existing: TrackerConfig | null
  onClose: () => void
  onSaved: () => void
}

const PROVIDERS = [
  { value: 'linear', label: 'Linear' },
  { value: 'jira', label: 'Jira' },
  { value: 'github', label: 'GitHub' },
] as const

const ENDPOINT_LABEL: Record<string, string> = {
  linear: 'Team Key (e.g. ENG)',
  jira: 'Base URL (e.g. https://acme.atlassian.net)',
  github: 'Owner/Repo (e.g. owner/repo)',
}

const TOKEN_LABEL: Record<string, string> = {
  linear: 'Linear API Key',
  jira: 'Personal Access Token',
  github: 'GitHub Token',
}

/**
 * Slide-in drawer for adding or editing a tracker connection.
 * On Save, calls the API and invokes onSaved (which should reload the parent list).
 */
export function TrackerConnectionDrawer({ config, existing, onClose, onSaved }: Props) {
  const [type, setType] = useState<string>(existing?.type ?? 'linear')
  const [displayName, setDisplayName] = useState(existing?.display_name ?? '')
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '')
  const [authMethod, setAuthMethod] = useState<'apikey' | 'oauth'>(
    (existing?.auth_method as 'apikey' | 'oauth') ?? 'apikey',
  )
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = existing == null

  // GitHub does not support OAuth in this flow — force apikey when provider changes
  useEffect(() => {
    if (type === 'github' && authMethod === 'oauth') {
      setAuthMethod('apikey')
    }
  }, [type, authMethod])

  const handleSave = async () => {
    if (!config) return
    if (!displayName.trim()) { setError('Display name is required'); return }
    if (isNew && !endpoint.trim()) { setError('Endpoint is required'); return }
    if (isNew && authMethod === 'apikey' && !token.trim()) {
      setError('Token is required for new connections')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await createTrackerConfig(config, {
          type,
          display_name: displayName.trim(),
          endpoint: endpoint.trim(),
          auth_method: authMethod,
          token,
        })
      } else {
        const patch: { display_name?: string; endpoint?: string; token?: string } = {
          display_name: displayName.trim(),
          endpoint: endpoint.trim(),
        }
        if (token) patch.token = token
        await updateTrackerConfig(config, existing.id, patch)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-background border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">
            {isNew ? 'Add Connection' : 'Edit Connection'}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isNew && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Provider</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full text-sm bg-background border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Linear Engineering"
              className="w-full text-sm bg-background border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {ENDPOINT_LABEL[type] ?? 'Endpoint'}
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {isNew && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Auth Method</label>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    value="apikey"
                    checked={authMethod === 'apikey'}
                    onChange={() => setAuthMethod('apikey')}
                  />
                  API Key / PAT
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    value="oauth"
                    checked={authMethod === 'oauth'}
                    onChange={() => setAuthMethod('oauth')}
                    disabled={type === 'github'}
                  />
                  OAuth
                </label>
              </div>
            </div>
          )}

          {authMethod === 'apikey' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {TOKEN_LABEL[type] ?? 'Token'}
                {!isNew && <span className="text-muted-foreground/50"> (leave blank to keep current)</span>}
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={isNew ? 'Paste token…' : '••••••••'}
                className="w-full text-sm bg-background border border-border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </div>
          )}

          {authMethod === 'oauth' && (
            <div>
              <button
                type="button"
                onClick={() => {
                  const bridge = (window as unknown as { orchestraDesktop?: { openOAuthWindow?: (p: string) => Promise<string> } }).orchestraDesktop
                  if (!bridge?.openOAuthWindow) {
                    setError('OAuth requires the Orchestra desktop app (not browser dev mode)')
                    return
                  }
                  setError(null)
                  bridge.openOAuthWindow(type)
                    .then((accessToken) => {
                      setToken(accessToken)
                    })
                    .catch((err: Error) => {
                      setError(err.message)
                    })
                }}
                className="w-full text-sm px-3 py-2 rounded border border-border hover:bg-muted transition-colors inline-flex items-center justify-center gap-2"
              >
                Authorize with {PROVIDERS.find((p) => p.value === type)?.label} →
              </button>
              {token && (
                <p className="text-xs text-emerald-400 mt-2">Token received</p>
              )}
              <p className="text-[11px] text-muted-foreground/60 mt-2">
                Requires {type === 'linear' ? 'LINEAR_CLIENT_ID/LINEAR_CLIENT_SECRET' : 'JIRA_CLIENT_ID/JIRA_CLIENT_SECRET'} env vars on the Orchestra process.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !config}
            className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Add Connection' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
