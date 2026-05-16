import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Play,
  RefreshCcw,
  Settings2,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react'
import { CustomDropdown } from '@layout/shared/controls'
import type { BackendConfig } from '@core/api/client'
import {
  fetchUnsandboxSessions,
  fetchUnsandboxServices,
  fetchUnsandboxStatus,
  type UnsandboxExecuteResult,
  type UnsandboxSession,
  type UnsandboxService,
  type UnsandboxStatus,
} from '@core/api/client'
import { Field, ResourceRow, SectionBlock } from './sandbox-shared'

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

const SANDBOX_HISTORY_KEY = 'sandbox:history:v1'

function loadHistory(): HistoryEntry[] {
  try {
    const versioned = localStorage.getItem(SANDBOX_HISTORY_KEY)
    if (versioned) return JSON.parse(versioned)
    const legacy = localStorage.getItem('sandbox:history')
    if (legacy) {
      localStorage.setItem(SANDBOX_HISTORY_KEY, legacy)
      localStorage.removeItem('sandbox:history')
      return JSON.parse(legacy)
    }
    return []
  } catch { return [] }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(SANDBOX_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
}

export function UnsandboxTab({
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
              <Settings2 className="size-3.5" />
              Open Settings
            </button>
          )}
        </div>
      )}

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
            {executing ? <Loader2 className="size-3.5 animate-spin-smooth" /> : <Play className="size-3.5" />}
            Execute
          </button>
          <span className="text-[11px] text-muted-foreground/70 font-mono">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
          </span>
        </div>

        {executing && progressStatus && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/20 text-[12px] font-mono text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin-smooth text-primary" />
            {progressStatus}
          </div>
        )}

        {sessionLog.length > 0 && (
          <SectionBlock label={`Session Activity (${sessionLog.length})`}>
            <div className="max-h-[280px] overflow-auto space-y-1 scroll-smooth font-mono text-[11px]">
              {sessionLog.map((entry, i) => (
                <div key={`${entry.ts}-${i}`} className="flex gap-2">
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
                  className="flex items-center justify-between w-full p-2 text-left hover:bg-foreground/[0.03] rounded-sm transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 text-[11px]">
                    {expandedHistoryId === entry.id
                      ? <ChevronDown className="size-3 text-muted-foreground/60 shrink-0" />
                      : <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />}
                    <Clock className="size-3 text-muted-foreground/50 shrink-0" />
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

      <SectionBlock
        label="Active Resources"
        trailing={
          <button
            onClick={refreshResources}
            disabled={loadingSessions}
            className="size-7 grid place-items-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-40"
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
            icon={<Zap className={`size-3.5 ${currentJobStatus === 'running' || currentJobStatus === 'pending' ? 'text-primary animate-pulse' : 'text-muted-foreground/60'}`} />}
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
            icon={<Terminal className="size-3.5 text-muted-foreground/60" />}
            id={s.id.slice(0, 12)}
            meta={s.language}
            statusLabel={s.status}
            statusColor={s.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground/60'}
          />
        ))}

        {services.map((s) => (
          <ResourceRow
            key={s.id}
            icon={<Globe className="size-3.5 text-muted-foreground/60" />}
            id={s.id.slice(0, 12)}
            statusLabel={s.status}
            statusColor={s.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground/60'}
          />
        ))}

        {sessions.length === 0 && services.length === 0 && !currentJobId && !loadingSessions && (
          <p className="text-[11px] text-muted-foreground/60 p-2">No active sessions or services.</p>
        )}
      </SectionBlock>
    </div>
  )
}
