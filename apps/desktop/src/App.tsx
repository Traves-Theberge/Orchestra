import { useEffect, useMemo, useState } from 'react'
import { Activity, Gauge, History, LayoutDashboard, ListTodo, RefreshCcw, Settings2, ShieldCheck, Ticket } from 'lucide-react'
import { SidebarNav } from '@/components/app-shell/sidebar-nav'
import { TopBar } from '@/components/app-shell/top-bar'
import {
  IssueInspectorCard,
  IssueDetailView,
  IntegrationUtilityCard,
  KanbanBoard,
  MetricCard,
  OperationsQueueCard,
  RetryQueueCard,
  RunningIssuesCard,
  SettingsCard,
  StatusStrip,
  TimelineCard,
} from '@/components/app-shell/panels'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { periodFilters, type SidebarItem, type TimelineItem } from '@/components/app-shell/types'
import {
  applyWorkspaceMigration,
  fetchIssueDetail,
  fetchState,
  fetchWorkspaceMigrationPlan,
  isUnauthorizedError,
  normalizeEventEnvelope,
  normalizeSnapshotPayload,
  postRefresh,
  toDisplayError,
  type BackendConfig,
} from '@/lib/orchestra-client'
import { startRuntimeSync } from '@/lib/runtime-sync'
import { appendTimelineEvent, applySnapshotUpdate } from '@/lib/runtime-store'
import type { SnapshotPayload } from '@/lib/orchestra-types'

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

const sidebarItems: SidebarItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Live runtime overview',
    icon: LayoutDashboard,
  },
  {
    id: 'running',
    label: 'Running',
    description: 'Active issue sessions',
    icon: ListTodo,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Lifecycle event stream',
    icon: History,
  },
  {
    id: 'issues',
    label: 'Issues',
    description: 'Issue board and inspector',
    icon: Ticket,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Backend and migration controls',
    icon: Settings2,
  },
]

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') {
      return 'dark'
    }
    const stored = window.localStorage.getItem('orchestra-theme')
    return stored === 'light' ? 'light' : 'dark'
  })

  const [config, setConfig] = useState<BackendConfig | null>(null)
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [doneIssues, setDoneIssues] = useState<any[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [profilesPending, setProfilesPending] = useState(false)
  const [backendProfiles, setBackendProfiles] = useState<BackendProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [loadingState, setLoadingState] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [migrationFrom, setMigrationFrom] = useState('')
  const [migrationTo, setMigrationTo] = useState('')
  const [migrationPlan, setMigrationPlan] = useState<Record<string, unknown> | null>(null)
  const [migrationPending, setMigrationPending] = useState(false)
  const [issueLookupId, setIssueLookupId] = useState('')
  const [issueLookupPending, setIssueLookupPending] = useState(false)
  const [issueLookupResult, setIssueLookupResult] = useState<Record<string, unknown> | null>(null)
  const [issueLookupError, setIssueLookupError] = useState('')
  const [refreshPending, setRefreshPending] = useState(false)
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('dashboard')
  const [activePeriod, setActivePeriod] = useState<(typeof periodFilters)[number]>('Week')

  const sidebarWidth = sidebarCollapsed ? 76 : 264
  const showDashboard = activeSection === 'dashboard'
  const showRunning = activeSection === 'dashboard' || activeSection === 'running'
  const showTimeline = activeSection === 'dashboard' || activeSection === 'timeline'
  const showIssueBoard = activeSection === 'issues'
  const showSettings = activeSection === 'settings'

  const sectionMeta: Record<string, { label: string; title: string }> = {
    dashboard: { label: 'Operations', title: 'Dashboard' },
    running: { label: 'Operations', title: 'Running' },
    timeline: { label: 'Diagnostics', title: 'Timeline' },
    issues: { label: 'Tracker', title: 'Issue Board' },
    settings: { label: 'System', title: 'Settings' },
  }
  const currentSectionMeta = sectionMeta[activeSection] ?? sectionMeta.dashboard

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    window.localStorage.setItem('orchestra-theme', theme)
  }, [theme])

  useEffect(() => {
    let mounted = true
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.getBackendConfig !== 'function') {
      setErrorMessage('desktop bridge unavailable: preload API not found')
      setLoadingConfig(false)
      return () => {
        mounted = false
      }
    }

    desktopBridge
      .getBackendConfig()
      .then((value) => {
        if (mounted) {
          setConfig(value)
        }
      })
      .then(async () => {
        if (!mounted || typeof desktopBridge.getBackendProfiles !== 'function') {
          return
        }
        const payload = await desktopBridge.getBackendProfiles()
        if (!mounted) {
          return
        }
        setBackendProfiles(payload.profiles)
        setActiveProfileId(payload.activeProfileId)
      })
      .catch((err: unknown) => {
        if (mounted) {
          setErrorMessage(`config load failed: ${toDisplayError(err)}`)
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingConfig(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!config) {
      return
    }

    const sync = startRuntimeSync(
      config,
      {
        onSnapshot: (next) => {
          setSnapshot((previous) => applySnapshotUpdate(previous, next))
          setLoadingState(false)
          setErrorMessage('')
        },
        onTimelineEvent: (eventType, envelope) => {
          setTimeline((previous) => appendTimelineEvent(previous, { type: envelope.type, at: envelope.timestamp, data: envelope.data }))
          if (eventType === 'run_succeeded') {
            const issueId = (envelope.data.issue_id as string) || ''
            const issueIdentifier = (envelope.data.issue_identifier as string) || ''
            if (issueId && issueIdentifier) {
              setDoneIssues((prev) => {
                if (prev.find((i) => i.issue_id === issueId)) {
                  return prev
                }
                return [
                  ...prev,
                  {
                    issue_id: issueId,
                    issue_identifier: issueIdentifier,
                    state: 'Completed',
                    at: envelope.timestamp,
                  },
                ]
              })
            }
          }
        },
        onStatus: (message) => {
          setStatusMessage(message)
        },
        onError: (message) => {
          setErrorMessage(message)
          if (isUnauthorizedError(message) || message.includes('unauthorized:')) {
            setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
          }
          setLoadingState(false)
        },
      },
      {
        fetchSnapshot: fetchState,
        normalizeSnapshot: normalizeSnapshotPayload,
        normalizeEnvelope: normalizeEventEnvelope,
        createEventSource: (url) => new EventSource(url),
        setIntervalFn: (cb, ms) => window.setInterval(cb, ms),
        clearIntervalFn: (id) => window.clearInterval(id),
        setTimeoutFn: (cb, ms) => window.setTimeout(cb, ms),
        clearTimeoutFn: (id) => window.clearTimeout(id),
      },
    )

    return () => {
      sync.stop()
    }
  }, [config])

  useEffect(() => {
    if (!config || backendProfiles.length > 0) {
      return
    }

    setBackendProfiles([
      {
        id: 'active',
        name: 'Active',
        baseUrl: config.baseUrl,
        apiToken: config.apiToken,
      },
    ])
    setActiveProfileId('active')
  }, [config, backendProfiles.length])

  const metrics = useMemo(() => {
    if (!snapshot) {
      return {
        running: '0',
        retrying: '0',
        totalTokens: '0',
        rateLimits: 'n/a',
      }
    }

    const remaining = typeof snapshot.rate_limits?.remaining === 'number' ? String(snapshot.rate_limits.remaining) : 'n/a'
    return {
      running: String(snapshot.counts.running ?? 0),
      retrying: String(snapshot.counts.retrying ?? 0),
      totalTokens: String(snapshot.codex_totals?.total_tokens ?? 0),
      rateLimits: remaining,
    }
  }, [snapshot])

  const generatedAt = snapshot?.generated_at ? new Date(snapshot.generated_at).toLocaleString() : 'waiting for first snapshot'

  const setOperatorError = (prefix: string, err: unknown) => {
    const message = toDisplayError(err)
    setErrorMessage(`${prefix}: ${message}`)
    if (isUnauthorizedError(err) || message.startsWith('unauthorized:')) {
      setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
    }
  }

  const handleRefresh = async () => {
    if (!config) {
      return
    }
    setRefreshPending(true)
    setStatusMessage('')
    setErrorMessage('')
    try {
      await postRefresh(config)
      setStatusMessage('Refresh queued successfully.')
    } catch (err) {
      setOperatorError('refresh failed', err)
    } finally {
      setRefreshPending(false)
    }
  }

  const handleMigrationPlan = async () => {
    if (!config) {
      return
    }
    setMigrationPending(true)
    setErrorMessage('')
    try {
      const plan = await fetchWorkspaceMigrationPlan(config, migrationFrom, migrationTo)
      setMigrationPlan(plan)
      setStatusMessage('Migration plan loaded.')
    } catch (err) {
      setOperatorError('migration plan failed', err)
    } finally {
      setMigrationPending(false)
    }
  }

  const handleMigrationApply = async () => {
    if (!config) {
      return
    }
    setMigrationPending(true)
    setErrorMessage('')
    try {
      const result = await applyWorkspaceMigration(config, migrationFrom, migrationTo)
      setMigrationPlan(result)
      setStatusMessage('Migration apply request accepted.')
    } catch (err) {
      setOperatorError('migration apply failed', err)
    } finally {
      setMigrationPending(false)
    }
  }

  const executeIssueLookup = async (identifier: string) => {
    if (!config) {
      return
    }

    const normalized = identifier.trim()
    if (normalized === '') {
      setIssueLookupError('Issue identifier is required.')
      setIssueLookupResult(null)
      return
    }

    setIssueLookupPending(true)
    setIssueLookupError('')
    try {
      const result = await fetchIssueDetail(config, normalized)
      setIssueLookupResult(result as unknown as Record<string, unknown>)
      setStatusMessage(`Issue lookup loaded: ${normalized}`)
    } catch (err) {
      const message = toDisplayError(err)
      setIssueLookupError(message)
      if (isUnauthorizedError(err) || message.startsWith('unauthorized:')) {
        setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
      }
      setIssueLookupResult(null)
    } finally {
      setIssueLookupPending(false)
    }
  }

  const handleIssueLookup = async () => {
    await executeIssueLookup(issueLookupId)
  }

  const handleInspectIssueFromList = async (issueIdentifier: string) => {
    setIssueLookupId(issueIdentifier)
    setInspectDialogOpen(true)
    await executeIssueLookup(issueIdentifier)
  }

  const handleBackendConfigSave = async (nextConfig: BackendConfig) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.setBackendConfig !== 'function') {
      setErrorMessage('desktop bridge unavailable: cannot save backend config')
      return
    }

    try {
      new URL(nextConfig.baseUrl)
    } catch {
      setErrorMessage('backend config save failed: base URL must be a valid absolute URL')
      return
    }

    setSavingConfig(true)
    setErrorMessage('')
    try {
      const saved = await desktopBridge.setBackendConfig(nextConfig)
      setConfig(saved)
      if (typeof desktopBridge.getBackendProfiles === 'function') {
        const payload = await desktopBridge.getBackendProfiles()
        setBackendProfiles(payload.profiles)
        setActiveProfileId(payload.activeProfileId)
      }
      setStatusMessage('Backend configuration saved.')
    } catch (err) {
      setOperatorError('backend config save failed', err)
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSetActiveProfile = async (profileId: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.setActiveBackendProfile !== 'function') {
      setErrorMessage('desktop bridge unavailable: cannot change active profile')
      return
    }

    setProfilesPending(true)
    setErrorMessage('')
    try {
      const nextConfig = await desktopBridge.setActiveBackendProfile(profileId)
      setConfig(nextConfig)
      if (typeof desktopBridge.getBackendProfiles === 'function') {
        const payload = await desktopBridge.getBackendProfiles()
        setBackendProfiles(payload.profiles)
        setActiveProfileId(payload.activeProfileId)
      }
      setStatusMessage('Active backend profile switched.')
    } catch (err) {
      setOperatorError('switch profile failed', err)
    } finally {
      setProfilesPending(false)
    }
  }

  const handleCreateProfile = async (name: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.saveBackendProfile !== 'function') {
      setErrorMessage('desktop bridge unavailable: cannot save profile')
      return
    }

    const fromConfig = config ?? { baseUrl: 'http://127.0.0.1:4000', apiToken: '' }
    setProfilesPending(true)
    setErrorMessage('')
    try {
      const payload = await desktopBridge.saveBackendProfile({
        name: name.trim(),
        baseUrl: fromConfig.baseUrl,
        apiToken: fromConfig.apiToken,
        makeActive: true,
      })
      setBackendProfiles(payload.profiles)
      setActiveProfileId(payload.activeProfileId)
      const active = payload.profiles.find((profile) => profile.id === payload.activeProfileId)
      if (active) {
        setConfig({ baseUrl: active.baseUrl, apiToken: active.apiToken })
      }
      setStatusMessage('Backend profile created and activated.')
    } catch (err) {
      setOperatorError('create profile failed', err)
    } finally {
      setProfilesPending(false)
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.deleteBackendProfile !== 'function') {
      setErrorMessage('desktop bridge unavailable: cannot delete profile')
      return
    }

    setProfilesPending(true)
    setErrorMessage('')
    try {
      const payload = await desktopBridge.deleteBackendProfile(profileId)
      setBackendProfiles(payload.profiles)
      setActiveProfileId(payload.activeProfileId)
      const active = payload.profiles.find((profile) => profile.id === payload.activeProfileId)
      if (active) {
        setConfig({ baseUrl: active.baseUrl, apiToken: active.apiToken })
      }
      setStatusMessage('Backend profile deleted.')
    } catch (err) {
      setOperatorError('delete profile failed', err)
    } finally {
      setProfilesPending(false)
    }
  }

  const handleDownloadDiagnostics = () => {
    const data = {
      app: 'orchestra-desktop',
      timestamp: new Date().toISOString(),
      config: {
        baseUrl: config?.baseUrl,
        activeProfileId,
      },
      snapshot,
      timeline,
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `orchestra-diagnostics-${new Date().getTime()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full w-full">
        <SidebarNav
          items={sidebarItems}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          sidebarCollapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
          sidebarWidth={sidebarWidth}
        />

        <main className="min-w-0 flex-1 overflow-auto bg-gradient-to-b from-background via-background to-muted/30">
          <div className="px-6 pb-8 pt-6 lg:px-8">
            <TopBar
              sectionLabel={currentSectionMeta.label}
              sectionTitle={currentSectionMeta.title}
              theme={theme}
              setTheme={setTheme}
              activePeriod={activePeriod}
              setActivePeriod={setActivePeriod}
              refreshPending={refreshPending}
              configReady={Boolean(config)}
              onOpenSettings={() => setActiveSection('settings')}
              onRefresh={handleRefresh}
            />

            <StatusStrip
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              generatedAt={generatedAt}
              onDownloadDiagnostics={handleDownloadDiagnostics}
            />

            <div className="mt-5 grid min-w-0 grid-cols-12 gap-5">
              {showDashboard ? (
                <section className="col-span-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard title="Running" value={metrics.running} icon={<Activity className="h-4 w-4" />} hint="Active sessions" />
                  <MetricCard title="Retrying" value={metrics.retrying} icon={<RefreshCcw className="h-4 w-4" />} hint="Queue entries" />
                  <MetricCard title="Codex Total Tokens" value={metrics.totalTokens} icon={<Gauge className="h-4 w-4" />} hint="Snapshot aggregate" />
                  <MetricCard title="Rate Limits" value={metrics.rateLimits} icon={<ShieldCheck className="h-4 w-4" />} hint="Latest provider payload" />
                </section>
              ) : null}

              {showDashboard ? (
                <section className="col-span-12">
                  <IntegrationUtilityCard tokenConfigured={Boolean(config?.apiToken?.trim())} />
                </section>
              ) : null}

              {showIssueBoard ? (
                <section className="col-span-12">
                  <KanbanBoard loadingState={loadingState} snapshot={snapshot} doneItems={doneIssues} onInspectIssue={handleInspectIssueFromList} />
                </section>
              ) : null}

              {showRunning ? (
                <section className="col-span-12 xl:col-span-8">
                  <RunningIssuesCard loadingState={loadingState} snapshot={snapshot} onInspectIssue={handleInspectIssueFromList} />
                </section>
              ) : null}

              {showRunning ? (
                <section className="col-span-12 xl:col-span-4">
                  <RetryQueueCard snapshot={snapshot} onInspectIssue={handleInspectIssueFromList} />
                </section>
              ) : null}

              {showDashboard || showRunning || showIssueBoard ? (
                <section className="col-span-12">
                  <IssueInspectorCard
                    configReady={Boolean(config)}
                    issueLookupId={issueLookupId}
                    issueLookupPending={issueLookupPending}
                    issueLookupError={issueLookupError}
                    issueLookupResult={issueLookupResult}
                    onIssueLookupIdChange={setIssueLookupId}
                    onIssueLookup={handleIssueLookup}
                  />
                </section>
              ) : null}

              {showTimeline ? (
                <section className="col-span-12">
                  <TimelineCard timeline={timeline} />
                </section>
              ) : null}

              {showSettings ? (
                <section className="col-span-12">
                  <SettingsCard
                    loadingConfig={loadingConfig}
                    savingConfig={savingConfig}
                    profilesPending={profilesPending}
                    config={config}
                    backendProfiles={backendProfiles}
                    activeProfileId={activeProfileId}
                    migrationPending={migrationPending}
                    migrationFrom={migrationFrom}
                    migrationTo={migrationTo}
                    migrationPlan={migrationPlan}
                    onMigrationFromChange={setMigrationFrom}
                    onMigrationToChange={setMigrationTo}
                    onMigrationPlan={handleMigrationPlan}
                    onMigrationApply={handleMigrationApply}
                    onSaveBackendConfig={handleBackendConfigSave}
                    onSetActiveProfile={handleSetActiveProfile}
                    onCreateProfile={handleCreateProfile}
                    onDeleteProfile={handleDeleteProfile}
                  />
                </section>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      <Dialog open={inspectDialogOpen} onOpenChange={setInspectDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Issue Inspection</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {issueLookupPending ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-[200px]" />
                <Skeleton className="h-[200px] w-full" />
              </div>
            ) : issueLookupError ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200">
                {issueLookupError}
              </div>
            ) : issueLookupResult ? (
              <IssueDetailView result={issueLookupResult} />
            ) : (
              <p className="text-center text-sm text-muted-foreground">No issue selected.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
