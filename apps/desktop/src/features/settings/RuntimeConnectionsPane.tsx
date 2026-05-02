import { useState, useEffect } from 'react'
import { Check, ChevronDown, ChevronRight, CircleDashed, CheckCircle2, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import type { BackendConfig, TailscaleConfig, KubernetesConfig } from '@core/api/client'
import {
  fetchTailscaleConfig,
  saveTailscaleConfig,
  deleteTailscaleConfig,
  testTailscaleConfig,
  fetchKubernetesConfig,
  saveKubernetesConfig,
  deleteKubernetesConfig,
  testKubernetesConfig,
} from '@core/api/client'

interface RuntimeConnectionsPaneProps {
  config: BackendConfig | null
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{children}</label>
  )
}

function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none disabled:opacity-50"
    />
  )
}

function StatusBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Configured
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <CircleDashed className="h-3.5 w-3.5" />
      Not configured
    </span>
  )
}

function StatusMessage({ message }: { message: string }) {
  if (!message) return null
  const isError = /fail|error|invalid/i.test(message)
  return (
    <p className={`text-[11px] font-medium ${isError ? 'text-red-500' : 'text-emerald-500'}`}>
      {message}
    </p>
  )
}

// ---------------------------------------------------------------------------
// TailscaleSection
// ---------------------------------------------------------------------------

function TailscaleSection({ config, disabled }: { config: BackendConfig | null; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false)
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
    <div className="rounded-xl border border-border/20 bg-muted/10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
          <span className="text-sm font-bold">Tailscale SSH</span>
          <span className="text-[10px] text-muted-foreground/60">Remote agent execution via SSH</span>
        </div>
        <StatusBadge configured={isConfigured} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/20 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>SSH Host</FieldLabel>
              <FieldInput
                type="text"
                value={form.ssh_host}
                onChange={(e) => setForm(f => ({ ...f, ssh_host: e.target.value }))}
                placeholder="100.x.y.z or hostname"
                disabled={disabled || saving}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>SSH Port</FieldLabel>
              <FieldInput
                type="number"
                value={form.ssh_port}
                onChange={(e) => setForm(f => ({ ...f, ssh_port: e.target.value }))}
                placeholder="22"
                disabled={disabled || saving}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>SSH User</FieldLabel>
              <FieldInput
                type="text"
                value={form.ssh_user}
                onChange={(e) => setForm(f => ({ ...f, ssh_user: e.target.value }))}
                placeholder="ubuntu"
                disabled={disabled || saving}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>SSH Key Path</FieldLabel>
              <FieldInput
                type="text"
                value={form.ssh_key_path}
                onChange={(e) => setForm(f => ({ ...f, ssh_key_path: e.target.value }))}
                placeholder="~/.ssh/id_ed25519"
                disabled={disabled || saving}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <FieldLabel>Worktree Root</FieldLabel>
              <FieldInput
                type="text"
                value={form.worktree_root}
                onChange={(e) => setForm(f => ({ ...f, worktree_root: e.target.value }))}
                placeholder="/home/ubuntu/orchestra-worktrees"
                disabled={disabled || saving}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={disabled || saving || !canSave}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              onClick={handleTest}
              disabled={disabled || testing || !isConfigured}
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
              Test
            </button>
            {isConfigured && (
              <button
                onClick={handleDelete}
                disabled={disabled || saving}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            )}
          </div>

          <StatusMessage message={message} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KubernetesSection
// ---------------------------------------------------------------------------

function KubernetesSection({ config, disabled }: { config: BackendConfig | null; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [cfg, setCfg] = useState<KubernetesConfig | null>(null)
  const [form, setForm] = useState({
    kubeconfig_path: '',
    namespace: '',
    image: '',
    git_repo_url: '',
    service_account: '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!config) return
    fetchKubernetesConfig(config)
      .then((data) => {
        setCfg(data)
        setForm({
          kubeconfig_path: data.kubeconfig_path || '',
          namespace: data.namespace || '',
          image: data.image || '',
          git_repo_url: data.git_repo_url || '',
          service_account: data.service_account || '',
        })
      })
      .catch(() => {})
  }, [config])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setMessage('')
    try {
      const result = await saveKubernetesConfig(config, {
        kubeconfig_path: form.kubeconfig_path,
        namespace: form.namespace,
        image: form.image,
        git_repo_url: form.git_repo_url,
        service_account: form.service_account,
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
      const result = await testKubernetesConfig(config)
      if (result.reachable) {
        setMessage(result.server_version ? `Cluster reachable — ${result.server_version}` : 'Cluster reachable.')
      } else {
        setMessage(`Unreachable: ${result.error ?? 'unknown error'}`)
      }
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
      await deleteKubernetesConfig(config)
      setCfg(null)
      setForm({ kubeconfig_path: '', namespace: '', image: '', git_repo_url: '', service_account: '' })
      setMessage('Configuration removed.')
    } catch (err) {
      setMessage(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const isConfigured = cfg?.configured ?? false
  const canSave = form.namespace.trim() && form.image.trim()

  return (
    <div className="rounded-xl border border-border/20 bg-muted/10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
          <span className="text-sm font-bold">Kubernetes</span>
          <span className="text-[10px] text-muted-foreground/60">Remote agent execution via pods</span>
        </div>
        <StatusBadge configured={isConfigured} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/20 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <FieldLabel>Kubeconfig Path</FieldLabel>
              <FieldInput
                type="text"
                value={form.kubeconfig_path}
                onChange={(e) => setForm(f => ({ ...f, kubeconfig_path: e.target.value }))}
                placeholder="~/.kube/config"
                disabled={disabled || saving}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Namespace</FieldLabel>
              <FieldInput
                type="text"
                value={form.namespace}
                onChange={(e) => setForm(f => ({ ...f, namespace: e.target.value }))}
                placeholder="orchestra"
                disabled={disabled || saving}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Service Account</FieldLabel>
              <FieldInput
                type="text"
                value={form.service_account}
                onChange={(e) => setForm(f => ({ ...f, service_account: e.target.value }))}
                placeholder="orchestra-agent"
                disabled={disabled || saving}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <FieldLabel>Agent Image</FieldLabel>
              <FieldInput
                type="text"
                value={form.image}
                onChange={(e) => setForm(f => ({ ...f, image: e.target.value }))}
                placeholder="ghcr.io/your-org/orchestra-agent:latest"
                disabled={disabled || saving}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <FieldLabel>Git Repo URL</FieldLabel>
              <FieldInput
                type="text"
                value={form.git_repo_url}
                onChange={(e) => setForm(f => ({ ...f, git_repo_url: e.target.value }))}
                placeholder="https://github.com/your-org/your-repo.git"
                disabled={disabled || saving}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={disabled || saving || !canSave}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              onClick={handleTest}
              disabled={disabled || testing || !isConfigured}
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
              Test
            </button>
            {isConfigured && (
              <button
                onClick={handleDelete}
                disabled={disabled || saving}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            )}
          </div>

          <StatusMessage message={message} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RuntimeConnectionsPane
// ---------------------------------------------------------------------------

export function RuntimeConnectionsPane({ config, disabled }: RuntimeConnectionsPaneProps) {
  return (
    <div className="space-y-3">
      <TailscaleSection config={config} disabled={disabled} />
      <KubernetesSection config={config} disabled={disabled} />
    </div>
  )
}
