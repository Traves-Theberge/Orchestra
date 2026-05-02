import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Globe,
  Loader2,
  Play,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react'
import { CustomDropdown } from '@layout/shared/controls'
import type { BackendConfig, TailscaleConfig, KubernetesConfig } from '@core/api/client'
import {
  deleteTailscaleConfig,
  deleteKubernetesConfig,
  fetchKubernetesConfig,
  fetchTailscaleConfig,
  fetchUnsandboxSessions,
  fetchUnsandboxServices,
  fetchUnsandboxStatus,
  saveKubernetesConfig,
  saveTailscaleConfig,
  testKubernetesConfig,
  testTailscaleConfig,
  type UnsandboxExecuteResult,
  type UnsandboxSession,
  type UnsandboxService,
  type UnsandboxStatus,
} from '@core/api/client'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGES = [
  'bash',
  'python',
  'javascript',
  'typescript',
  'ruby',
  'go',
  'rust',
  'c',
  'cpp',
  'java',
  'php',
  'perl',
  'lua',
  'r',
  'elixir',
  'haskell',
  'swift',
]

const NETWORKS = ['semitrusted', 'zerotrust']

const MAX_HISTORY = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryEntry {
  id: string
  ts: string
  language: string
  network: string
  code: string
  status: string
  output: string
  error: string
  job_id: string
}

type TabId = 'unsandbox' | 'tailscale' | 'kubernetes'

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem('sandbox:history') || '[]') } catch { return [] }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem('sandbox:history', JSON.stringify(entries.slice(0, MAX_HISTORY)))
}

// ---------------------------------------------------------------------------
// Shared form helpers
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
// Tab status pill
// ---------------------------------------------------------------------------

type PillStatus = 'connected' | 'configured' | 'not-configured'

function TabStatusPill({ status }: { status: PillStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    )
  }
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-500">
        <CheckCircle2 className="h-3 w-3" />
        Configured
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/60">
      <CircleDashed className="h-3 w-3" />
      Not configured
    </span>
  )
}

// ---------------------------------------------------------------------------
// Unsandbox tab content
// ---------------------------------------------------------------------------

function UnsandboxTab({
  config,
  onOpenSettings,
}: {
  config: BackendConfig | null
  onOpenSettings?: () => void
}) {
  const [language, setLanguage] = useState(() => localStorage.getItem('sandbox:language') || 'bash')
  const [network, setNetwork] = useState(() => localStorage.getItem('sandbox:network') || 'semitrusted')
  const [code, setCode] = useState(() => localStorage.getItem('sandbox:code') || '')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<UnsandboxExecuteResult | null>(null)
  const [execError, setExecError] = useState('')
  const [progressStatus, setProgressStatus] = useState('')
  const [currentJobId, setCurrentJobId] = useState('')
  const [currentJobStatus, setCurrentJobStatus] = useState('')
  const [sessionLog] = useState<Array<{ type: string; message: string; ts: string }>>([])
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [expandedHistoryId, setExpandedHistoryId] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const [status, setStatus] = useState<UnsandboxStatus | null>(null)
  const [sessions, setSessions] = useState<UnsandboxSession[]>([])
  const [services, setServices] = useState<UnsandboxService[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  const [spinning, setSpinning] = useState(false)
  const wantsStop = useRef(false)

  useEffect(() => {
    if (loadingSessions) {
      wantsStop.current = false
      setSpinning(true)
    } else {
      wantsStop.current = true
    }
  }, [loadingSessions])

  const handleAnimationIteration = useCallback(() => {
    if (wantsStop.current) setSpinning(false)
  }, [])

  useEffect(() => { localStorage.setItem('sandbox:language', language) }, [language])
  useEffect(() => { localStorage.setItem('sandbox:network', network) }, [network])
  useEffect(() => { localStorage.setItem('sandbox:code', code) }, [code])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sessionLog])

  useEffect(() => {
    if (!config) return
    fetchUnsandboxStatus(config).then(setStatus).catch(() => {})
    refreshResources()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const refreshResources = async () => {
    if (!config) return
    setLoadingSessions(true)
    try {
      const [sessResp, svcResp] = await Promise.all([
        fetchUnsandboxSessions(config).catch(() => ({ sessions: [] })),
        fetchUnsandboxServices(config).catch(() => ({ services: [] })),
      ])
      setSessions(sessResp.sessions || [])
      setServices(svcResp.services || [])
    } finally {
      setLoadingSessions(false)
    }
  }

  const addToHistory = (entry: Omit<HistoryEntry, 'id' | 'ts'>) => {
    const newEntry: HistoryEntry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...entry,
    }
    setHistory((prev) => {
      const next = [newEntry, ...prev].slice(0, MAX_HISTORY)
      saveHistory(next)
      return next
    })
  }

  const handleExecute = async () => {
    if (!config || !code.trim()) return
    setExecuting(true)
    setResult(null)
    setExecError('')
    setProgressStatus('')
    setCurrentJobId('')
    setCurrentJobStatus('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (config.apiToken.trim()) headers.Authorization = `Bearer ${config.apiToken.trim()}`

      const submitUrl = new URL('/api/v1/unsandbox/execute', config.baseUrl)
      const submitResp = await fetch(submitUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ language, code, network: network || 'semitrusted' }),
        signal: controller.signal,
      })

      if (!submitResp.ok) {
        const text = await submitResp.text()
        setExecError(`HTTP ${submitResp.status}: ${text}`)
        return
      }

      const submitData = await submitResp.json()
      const jobId = submitData.job_id
      if (!jobId) {
        const res = { status: submitData.status || 'completed', output: submitData.output || '', error: submitData.error || '', job_id: '' }
        setResult(res)
        addToHistory({ language, network, code, ...res })
        return
      }

      setCurrentJobId(jobId)
      setCurrentJobStatus('pending')
      setProgressStatus(`${jobId.slice(0, 12)} pending...`)

      const pollUrl = new URL(`/api/v1/unsandbox/jobs/${jobId}`, config.baseUrl)
      let pollDelay = 1000
      while (!controller.signal.aborted) {
        await new Promise((r) => setTimeout(r, pollDelay))
        if (controller.signal.aborted) break

        const pollResp = await fetch(pollUrl.toString(), { headers, signal: controller.signal })
        if (!pollResp.ok) {
          setExecError(`Poll failed: HTTP ${pollResp.status}`)
          setCurrentJobStatus('failed')
          return
        }

        const job = await pollResp.json()
        const jobStatus = job.status || 'unknown'

        if (jobStatus === 'completed' || jobStatus === 'failed') {
          setCurrentJobStatus(jobStatus)
          const res = { status: jobStatus, output: job.output || '', error: job.error || '', job_id: jobId }
          setResult(res)
          addToHistory({ language, network, code, ...res })
          setProgressStatus('')
          refreshResources()
          return
        }

        setCurrentJobStatus(jobStatus)
        setProgressStatus(`${jobStatus}... (${jobId.slice(0, 12)})`)
        pollDelay = Math.min(pollDelay * 1.5, 5000)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExecError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      abortRef.current = null
      setExecuting(false)
      if (controller.signal.aborted) {
        setCurrentJobStatus('')
        setProgressStatus('')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleExecute()
    }
  }

  const isConfigured = status?.configured && status?.valid

  return (
    <div className="space-y-10">
      {/* Config status banner — shown when not configured */}
      {!isConfigured && (
        <div className="flex items-center justify-between rounded-xl border border-border/20 bg-muted/10 px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-[12px] font-semibold">Unsandbox not configured</p>
            <p className="text-[11px] text-muted-foreground/70">Add your API keys in Settings to run code remotely.</p>
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11px] font-semibold tracking-tight transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Open Settings
            </button>
          )}
        </div>
      )}

      {/* Execute */}
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language">
            <CustomDropdown
              className="w-full"
              value={language}
              options={LANGUAGES.map((l) => ({ label: l, value: l }))}
              onChange={setLanguage}
            />
          </Field>
          <Field label="Network">
            <CustomDropdown
              className="w-full"
              value={network}
              options={NETWORKS.map((n) => ({ label: n, value: n }))}
              onChange={setNetwork}
            />
          </Field>
        </div>

        <Field label="Code">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={language === 'bash' ? 'echo "hello from unsandbox"' : `print("hello from unsandbox")`}
            rows={10}
            className="w-full rounded-md bg-muted/20 px-3 py-2.5 text-[13px] font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y transition-all"
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExecute}
            disabled={executing || !code.trim() || !isConfigured}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[12px] font-semibold tracking-tight disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin-smooth" /> : <Play className="h-3.5 w-3.5" />}
            Execute
          </button>
          <span className="text-[11px] text-muted-foreground/70 font-mono">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
          </span>
        </div>

        {executing && progressStatus && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/20 text-[12px] font-mono text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin-smooth text-primary" />
            {progressStatus}
          </div>
        )}

        {sessionLog.length > 0 && (
          <SectionBlock label={`Session Activity (${sessionLog.length})`}>
            <div className="max-h-[280px] overflow-auto space-y-1 scroll-smooth font-mono text-[11px]">
              {sessionLog.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground/50 shrink-0">{entry.ts}</span>
                  <span className={`shrink-0 font-semibold ${
                    entry.type === 'assistant' ? 'text-primary' :
                    entry.type === 'result' ? 'text-emerald-500' :
                    'text-muted-foreground/70'
                  }`}>
                    {entry.type.slice(0, 8).padEnd(8)}
                  </span>
                  <span className="text-foreground/80 break-all">{entry.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </SectionBlock>
        )}

        {(result || execError) && (
          <SectionBlock
            label="Output"
            trailing={result && (
              <div className="flex items-center gap-3 text-[11px]">
                <span className={`font-semibold ${result.status === 'completed' ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {result.status}
                </span>
                {result.job_id && (
                  <span className="font-mono text-muted-foreground/60">{result.job_id}</span>
                )}
              </div>
            )}
          >
            {execError && (
              <pre className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-[12px] font-mono text-destructive whitespace-pre-wrap overflow-auto max-h-[280px]">
                {execError}
              </pre>
            )}
            {result?.output && (
              <pre className="rounded-md bg-muted/20 p-3 text-[12px] font-mono whitespace-pre-wrap overflow-auto max-h-[400px]">
                {result.output}
              </pre>
            )}
            {result?.error && (
              <pre className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-[12px] font-mono text-destructive whitespace-pre-wrap overflow-auto max-h-[200px]">
                {result.error}
              </pre>
            )}
          </SectionBlock>
        )}
      </section>

      {/* History */}
      {history.length > 0 && (
        <SectionBlock
          label={`History · ${history.length}`}
          trailing={
            <button
              onClick={() => { setHistory([]); saveHistory([]) }}
              className="text-muted-foreground/50 hover:text-destructive transition-colors"
              title="Clear history"
            >
              <Trash2 size={13} />
            </button>
          }
        >
          <div className="flex flex-col divide-y divide-border/40 max-h-[400px] overflow-auto">
            {history.map((entry) => (
              <div key={entry.id}>
                <button
                  onClick={() => setExpandedHistoryId(expandedHistoryId === entry.id ? '' : entry.id)}
                  className="flex items-center justify-between w-full px-2 py-2 text-left hover:bg-foreground/[0.03] rounded-sm transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 text-[11px]">
                    {expandedHistoryId === entry.id
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                    <Clock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <span className="text-muted-foreground/70 shrink-0 tabular-nums">
                      {new Date(entry.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-muted-foreground/70 shrink-0">{entry.language}</span>
                    <span className="font-mono truncate text-foreground/80">{entry.code.slice(0, 60)}</span>
                  </div>
                  <span className={`text-[10px] font-semibold shrink-0 ml-2 ${
                    entry.status === 'completed' ? 'text-emerald-500' :
                    entry.status === 'failed' ? 'text-destructive' : 'text-muted-foreground/60'
                  }`}>
                    {entry.status}
                  </span>
                </button>
                {expandedHistoryId === entry.id && (
                  <div className="px-2 pb-2 space-y-2">
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => { setCode(entry.code); setLanguage(entry.language); setNetwork(entry.network) }}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        Load into editor
                      </button>
                      {entry.job_id && (
                        <span className="text-[10px] font-mono text-muted-foreground/50">{entry.job_id}</span>
                      )}
                    </div>
                    <pre className="rounded-md bg-muted/20 p-2 text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[120px]">
                      {entry.code}
                    </pre>
                    {entry.output && (
                      <pre className="rounded-md bg-muted/10 p-2 text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[200px]">
                        {entry.output}
                      </pre>
                    )}
                    {entry.error && (
                      <pre className="rounded-md bg-destructive/5 border border-destructive/20 p-2 text-[11px] font-mono text-destructive whitespace-pre-wrap overflow-auto max-h-[100px]">
                        {entry.error}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionBlock>
      )}

      {/* Active Resources */}
      <SectionBlock
        label="Active Resources"
        trailing={
          <button
            onClick={refreshResources}
            disabled={loadingSessions}
            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCcw
              size={13}
              className={spinning ? 'animate-refresh-spin' : ''}
              onAnimationIteration={handleAnimationIteration}
            />
          </button>
        }
      >
        {currentJobId && (
          <ResourceRow
            icon={<Zap className={`h-3.5 w-3.5 ${currentJobStatus === 'running' || currentJobStatus === 'pending' ? 'text-primary animate-pulse' : 'text-muted-foreground/60'}`} />}
            label="Current job"
            id={currentJobId.slice(0, 12)}
            meta={language}
            statusLabel={currentJobStatus}
            statusColor={
              currentJobStatus === 'completed' ? 'text-emerald-500' :
              currentJobStatus === 'failed' ? 'text-destructive' :
              currentJobStatus === 'running' ? 'text-primary' :
              'text-amber-500'
            }
          />
        )}

        {sessions.map((s) => (
          <ResourceRow
            key={s.id}
            icon={<Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />}
            id={s.id.slice(0, 12)}
            meta={s.language}
            statusLabel={s.status}
            statusColor={s.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground/60'}
          />
        ))}

        {services.map((s) => (
          <ResourceRow
            key={s.id}
            icon={<Globe className="h-3.5 w-3.5 text-muted-foreground/60" />}
            id={s.id.slice(0, 12)}
            statusLabel={s.status}
            statusColor={s.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground/60'}
          />
        ))}

        {sessions.length === 0 && services.length === 0 && !currentJobId && !loadingSessions && (
          <p className="text-[11px] text-muted-foreground/60 px-2 py-2">No active sessions or services.</p>
        )}
      </SectionBlock>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tailscale tab content
// ---------------------------------------------------------------------------

function TailscaleTab({ config }: { config: BackendConfig | null }) {
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
          {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
          Save
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !isConfigured}
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
          Test
        </button>
        {isConfigured && (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        )}
      </div>

      <StatusMessage message={message} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kubernetes tab content
// ---------------------------------------------------------------------------

function KubernetesTab({ config }: { config: BackendConfig | null }) {
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
          {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
          Save
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !isConfigured}
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
          Test
        </button>
        {isConfigured && (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        )}
      </div>

      <StatusMessage message={message} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main SandboxDashboard
// ---------------------------------------------------------------------------

export function SandboxDashboard({ config, onOpenSettings }: { config: BackendConfig | null; onOpenSettings?: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>('unsandbox')

  // Track pill statuses for each tab
  const [unsandboxStatus, setUnsandboxStatus] = useState<UnsandboxStatus | null>(null)
  const [tailscaleConfigured, setTailscaleConfigured] = useState(false)
  const [kubernetesConfigured, setKubernetesConfigured] = useState(false)

  useEffect(() => {
    if (!config) return
    fetchUnsandboxStatus(config).then(setUnsandboxStatus).catch(() => {})
    fetchTailscaleConfig(config).then((d) => setTailscaleConfigured(d.configured ?? false)).catch(() => {})
    fetchKubernetesConfig(config).then((d) => setKubernetesConfigured(d.configured ?? false)).catch(() => {})
  }, [config])

  if (!config) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No backend connected.
      </div>
    )
  }

  const unsandboxPill: PillStatus =
    unsandboxStatus?.configured && unsandboxStatus?.valid ? 'connected' : 'not-configured'
  const tailscalePill: PillStatus = tailscaleConfigured ? 'configured' : 'not-configured'
  const kubernetesPill: PillStatus = kubernetesConfigured ? 'configured' : 'not-configured'

  const tabs: Array<{ id: TabId; label: string; pill: PillStatus }> = [
    { id: 'unsandbox', label: 'Unsandbox', pill: unsandboxPill },
    { id: 'tailscale', label: 'Tailscale', pill: tailscalePill },
    { id: 'kubernetes', label: 'Kubernetes', pill: kubernetesPill },
  ]

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-3xl mx-auto px-10 pt-10 pb-16 space-y-8">
        {/* Header */}
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Compute</p>
            <h1 className="text-4xl font-black tracking-tight">Remote Execution</h1>
          </div>
        </header>

        {/* Tab bar */}
        <div className="flex items-end gap-1 border-b border-border/30">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold tracking-tight transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground/60 hover:text-foreground/80 hover:border-border'
              }`}
            >
              {tab.label}
              <TabStatusPill status={tab.pill} />
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'unsandbox' && (
          <UnsandboxTab config={config} onOpenSettings={onOpenSettings} />
        )}
        {activeTab === 'tailscale' && (
          <TailscaleTab config={config} />
        )}
        {activeTab === 'kubernetes' && (
          <KubernetesTab config={config} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold tracking-tight text-muted-foreground/70">{label}</label>
      {children}
    </div>
  )
}

function SectionBlock({ label, trailing, children }: { label: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground/60">{label}</h3>
        {trailing}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function ResourceRow({ icon, label, id, meta, statusLabel, statusColor }: {
  icon: React.ReactNode
  label?: string
  id: string
  meta?: string
  statusLabel: string
  statusColor: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 h-9 rounded-md hover:bg-foreground/[0.03] transition-colors">
      <div className="flex items-center gap-2.5 min-w-0 text-[11.5px]">
        {icon}
        {label && <span className="text-muted-foreground/70">{label}</span>}
        <span className="font-mono text-foreground/80 truncate">{id}</span>
        {meta && <span className="text-muted-foreground/60">{meta}</span>}
      </div>
      <span className={`text-[10px] font-semibold shrink-0 ${statusColor}`}>{statusLabel}</span>
    </div>
  )
}
