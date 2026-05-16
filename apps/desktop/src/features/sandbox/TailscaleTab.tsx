import { useEffect, useState } from 'react'
import { Check, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import type { BackendConfig, TailscaleConfig } from '@core/api/client'
import {
  deleteTailscaleConfig,
  fetchTailscaleConfig,
  saveTailscaleConfig,
  testTailscaleConfig,
} from '@core/api/client'
import { FieldInput, FieldLabel, StatusMessage } from './sandbox-shared'

export function TailscaleTab({ config }: { config: BackendConfig | null }) {
  const [cfg, setCfg] = useState<TailscaleConfig | null>(null)
  const [form, setForm] = useState({
    ssh_host: '',
    ssh_user: '',
    ssh_key_path: '',
    ssh_port: '22',
    worktree_root: '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!config) return
    fetchTailscaleConfig(config)
      .then((data) => {
        setCfg(data)
        setForm({
          ssh_host: data.ssh_host || '',
          ssh_user: data.ssh_user || '',
          ssh_key_path: data.ssh_key_path || '',
          ssh_port: String(data.ssh_port || 22),
          worktree_root: data.worktree_root || '',
        })
      })
      .catch(() => {})
  }, [config])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setMessage('')
    try {
      const result = await saveTailscaleConfig(config, {
        ssh_host: form.ssh_host,
        ssh_user: form.ssh_user,
        ssh_key_path: form.ssh_key_path,
        ssh_port: parseInt(form.ssh_port, 10) || 22,
        worktree_root: form.worktree_root,
      })
      setCfg(result)
      setMessage('Configuration saved.')
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!config) return
    setTesting(true)
    setMessage('')
    try {
      const result = await testTailscaleConfig(config)
      setMessage(result.reachable ? 'Host reachable.' : `Unreachable: ${result.error ?? 'unknown error'}`)
    } catch (err) {
      setMessage(`Test failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!config) return
    setSaving(true)
    setMessage('')
    try {
      await deleteTailscaleConfig(config)
      setCfg(null)
      setForm({ ssh_host: '', ssh_user: '', ssh_key_path: '', ssh_port: '22', worktree_root: '' })
      setMessage('Configuration removed.')
    } catch (err) {
      setMessage(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const isConfigured = cfg?.configured ?? false
  const canSave = form.ssh_host.trim() && form.ssh_user.trim()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground/70">Connect to a remote host over Tailscale SSH to run agents there.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel>SSH Host</FieldLabel>
          <FieldInput
            type="text"
            value={form.ssh_host}
            onChange={(e) => setForm(f => ({ ...f, ssh_host: e.target.value }))}
            placeholder="100.x.y.z or hostname"
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>SSH Port</FieldLabel>
          <FieldInput
            type="number"
            value={form.ssh_port}
            onChange={(e) => setForm(f => ({ ...f, ssh_port: e.target.value }))}
            placeholder="22"
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>SSH User</FieldLabel>
          <FieldInput
            type="text"
            value={form.ssh_user}
            onChange={(e) => setForm(f => ({ ...f, ssh_user: e.target.value }))}
            placeholder="ubuntu"
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>SSH Key Path</FieldLabel>
          <FieldInput
            type="text"
            value={form.ssh_key_path}
            onChange={(e) => setForm(f => ({ ...f, ssh_key_path: e.target.value }))}
            placeholder="~/.ssh/id_ed25519"
            disabled={saving}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <FieldLabel>Worktree Root</FieldLabel>
          <FieldInput
            type="text"
            value={form.worktree_root}
            onChange={(e) => setForm(f => ({ ...f, worktree_root: e.target.value }))}
            placeholder="/home/ubuntu/orchestra-worktrees"
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="size-3 animate-spin-smooth" /> : <Check className="size-3" />}
          Save
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !isConfigured}
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testing ? <Loader2 className="size-3 animate-spin-smooth" /> : <ShieldCheck className="size-3" />}
          Test
        </button>
        {isConfigured && (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="size-3" />
            Remove
          </button>
        )}
      </div>

      <StatusMessage message={message} />
    </div>
  )
}
