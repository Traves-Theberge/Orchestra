import { useEffect, useState } from 'react'
import { Check, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import type { BackendConfig, KubernetesConfig } from '@core/api/client'
import {
  deleteKubernetesConfig,
  fetchKubernetesConfig,
  saveKubernetesConfig,
  testKubernetesConfig,
} from '@core/api/client'
import { FieldInput, FieldLabel, StatusMessage } from './sandbox-shared'

export function KubernetesTab({ config }: { config: BackendConfig | null }) {
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
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground/70">Dispatch agents as Kubernetes pods in your cluster.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <FieldLabel>Kubeconfig Path</FieldLabel>
          <FieldInput
            type="text"
            value={form.kubeconfig_path}
            onChange={(e) => setForm(f => ({ ...f, kubeconfig_path: e.target.value }))}
            placeholder="~/.kube/config"
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>Namespace</FieldLabel>
          <FieldInput
            type="text"
            value={form.namespace}
            onChange={(e) => setForm(f => ({ ...f, namespace: e.target.value }))}
            placeholder="orchestra"
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>Service Account</FieldLabel>
          <FieldInput
            type="text"
            value={form.service_account}
            onChange={(e) => setForm(f => ({ ...f, service_account: e.target.value }))}
            placeholder="orchestra-agent"
            disabled={saving}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <FieldLabel>Agent Image</FieldLabel>
          <FieldInput
            type="text"
            value={form.image}
            onChange={(e) => setForm(f => ({ ...f, image: e.target.value }))}
            placeholder="ghcr.io/your-org/orchestra-agent:latest"
            disabled={saving}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <FieldLabel>Git Repo URL</FieldLabel>
          <FieldInput
            type="text"
            value={form.git_repo_url}
            onChange={(e) => setForm(f => ({ ...f, git_repo_url: e.target.value }))}
            placeholder="https://github.com/your-org/your-repo.git"
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
