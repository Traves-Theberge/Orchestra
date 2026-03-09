import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Database, FolderTree, Gauge, History, LayoutDashboard, ListTodo, RefreshCcw, Settings2, ShieldCheck, Ticket, Cpu, Zap, FileText } from 'lucide-react'
import { SidebarNav } from '@/components/app-shell/sidebar-nav'
import { TopBar } from '@/components/app-shell/top-bar'
import {
  IssueDetailView,
  CreateTaskDialog,
  CreateProjectDialog,
  DashboardOverview,
  KanbanBoard,
  MetricCard,
  OperationsQueueCard,
  SettingsCard,
  TimelineCard,
} from '@/components/app-shell/panels'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { periodFilters, type SidebarItem, type TimelineItem } from '@/components/app-shell/types'
import {
  applyWorkspaceMigration,
  fetchAgentConfig,
  fetchAgents,
  fetchIssueDetail,
  fetchIssues,
  fetchProjectStats,
  fetchProjects,
  fetchState,
  fetchWarehouseStats,
  fetchWorkspaceMigrationPlan,
  isUnauthorizedError,
  normalizeEventEnvelope,
  normalizeSnapshotPayload,
  postRefresh,
  updateAgentConfig,
  searchIssues,
  stopIssueSession,
  toDisplayError,
  updateIssue,
  createProject,
  createIssue,
  deleteProject,
  deleteIssue,
  fetchSessionDetail,
  type BackendConfig,
} from '@/lib/orchestra-client'
import { startRuntimeSync } from '@/lib/runtime-sync'
import { appendTimelineEvent, applySnapshotUpdate } from '@/lib/runtime-store'
import type { GlobalStats, Project, ProjectStats, SnapshotPayload } from '@/lib/orchestra-types'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import { ProjectDetailView } from '@/components/projects/ProjectDetailView'
import { AnalyticsDashboard } from '@/components/warehouse/AnalyticsDashboard'
import { SessionDetailView } from '@/components/warehouse/SessionDetailView'
import { AgentsDashboard } from '@/components/agents/AgentsDashboard'
import { DocsDashboard } from '@/components/docs/DocsDashboard'
import { Command } from 'cmdk'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'

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
    id: 'issues',
    label: 'Tasks',
    description: 'Task board and inspector',
    icon: Ticket,
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Local workspace grouping',
    icon: FolderTree,
  },
  {
    id: 'running',
    label: 'Running',
    description: 'Active issue sessions',
    icon: ListTodo,
  },
  {
    id: 'timeline',
    label: 'Activity Feed',
    description: 'Real-time lifecycle events',
    icon: History,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Global agent configurations',
    icon: Cpu,
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    description: 'Token analytics and archives',
    icon: Database,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Backend and migration controls',
    icon: Settings2,
  },
  {
    id: 'docs',
    label: 'Documentation',
    description: 'User & engineering guides',
    icon: FileText,
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
  const [boardIssues, setBoardIssues] = useState<any[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [profilesPending, setProfilesPending] = useState(false)
  const [backendProfiles, setBackendProfiles] = useState<BackendProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [agentConfig, setAgentConfig] = useState<{ commands: Record<string, string>; agent_provider: string } | null>(null)
  const [availableAgents, setAvailableAgents] = useState<string[]>([])
  const [allTools, setAllTools] = useState<any[]>([])
  const [agentTokens, setAgentTokens] = useState<Record<string, string>>({})
  const [loadingState, setLoadingState] = useState(true)
  const [usePolling, setUsePolling] = useState(false)
  const syncControls = useRef<{ startPolling: () => void; stopPolling: () => void } | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [migrationFrom, setMigrationFrom] = useState('')
  const [migrationTo, setMigrationTo] = useState('')
  const [migrationPlan, setMigrationPlan] = useState<Record<string, unknown> | null>(null)
  const [migrationPending, setMigrationPending] = useState(false)
  const [issueLookupId, setIssueLookupId] = useState('')
  const [issueLookupPending, setIssueLookupPending] = useState(false)
  const [issueLookupResult, setIssueLookupResult] = useState<Record<string, unknown> | null>(null)
  const [issueLookupError, setIssueLookupError] = useState('')
  const [sessionLookupResult, setSessionLookupResult] = useState<any>(null)
  const [sessionLookupPending, setSessionLookupPending] = useState(false)
  const [sessionLookupError, setSessionLookupError] = useState('')
  const [refreshPending, setRefreshPending] = useState(false)
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false)
  const [sessionInspectDialogOpen, setSessionInspectDialogOpen] = useState(false)
  const [createTaskDialogOpen, setCreateTaskDialogOpen] = useState(false)
  const [createTaskInitialState, setCreateTaskInitialState] = useState('Todo')
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('dashboard')
  const [activePeriod, setActivePeriod] = useState<'Today' | 'Week' | 'Month'>('Week')
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  // Projects & Warehouse State
  const [projects, setProjects] = useState<Project[]>([])
  const [projectStats, setProjectStats] = useState<Record<string, ProjectStats>>({})
  const [warehouseStats, setWarehouseStats] = useState<GlobalStats | null>(null)
  const [selectedProjectID, setSelectedProjectID] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(false)

  const sidebarWidth = sidebarCollapsed ? 64 : 220
  const sectionVisibility = {
    showDashboard: activeSection === 'dashboard',
    showRunning: activeSection === 'running',
    showTimeline: activeSection === 'timeline',
    showIssueBoard: activeSection === 'issues',
    showProjects: activeSection === 'projects',
    showAgents: activeSection === 'agents',
    showWarehouse: activeSection === 'warehouse',
    showSettings: activeSection === 'settings',
    showDocs: activeSection === 'docs',
  }
  const sectionMeta: Record<string, { label: string; title: string }> = {
    dashboard: { label: 'Operations', title: 'Dashboard' },
    running: { label: 'Operations', title: 'Running' },
    timeline: { label: 'Diagnostics', title: 'Activity Feed' },
    issues: { label: 'Tracker', title: 'Tasks' },
    projects: { label: 'Workspace', title: 'Projects' },
    agents: { label: 'Compute', title: 'Agents' },
    warehouse: { label: 'Analytics', title: 'Warehouse' },
    settings: { label: 'System', title: 'Settings' },
    docs: { label: 'Knowledge', title: 'Documentation' },
  }
  const currentSectionMeta = sectionMeta[activeSection] ?? sectionMeta.dashboard

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

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
    if (!config) return

    let mounted = true

    // Non-blocking metadata fetches
    fetchAgentConfig(config)
      .then(cfg => mounted && setAgentConfig(cfg))
      .catch(() => mounted && setAgentConfig(null))
    if (config) {
      fetchAgents(config)
        .then(agents => mounted && setAvailableAgents(agents))
        .catch(() => mounted && setAvailableAgents([]))

      fetchMCPTools(config)
        .then(tools => mounted && setAllTools(tools))
        .catch(() => mounted && setAllTools([]))
    }
    // Section-specific data loading with global loading state
    const loadRequiredData = async () => {
      // Always fetch projects if we have none yet
      const needsProjects = projects.length === 0 || activeSection === 'projects' || activeSection === 'dashboard'
      const needsWarehouse = activeSection === 'warehouse' || activeSection === 'dashboard'

      if (!needsProjects && !needsWarehouse) return

      setDataLoading(true)
      try {
        if (needsProjects) {
          const projs = await fetchProjects(config)
          if (!mounted) return
          setProjects(projs)

          // Fetch stats for projects that don't have them yet
          const statsMap: Record<string, ProjectStats> = { ...projectStats }
          let statsUpdated = false
          for (const p of projs) {
            if (statsMap[p.id]) continue
            try {
              const s = await fetchProjectStats(config, p.id)
              statsMap[p.id] = s
              statsUpdated = true
            } catch (e) {
              console.error(`failed to fetch stats for project ${p.id}`, e)
            }
          }
          if (mounted && statsUpdated) setProjectStats(statsMap)
        }

        if (needsWarehouse) {
          const stats = await fetchWarehouseStats(config)
          if (mounted) setWarehouseStats(stats)
        }
      } catch (err) {
        if (mounted) setOperatorError('failed to fetch section data', err)
      } finally {
        if (mounted) setDataLoading(false)
      }
    }

    loadRequiredData()

    return () => {
      mounted = false
    }
  }, [config, activeSection])

  const handleAgentConfigSave = async (nextAgentConfig: { commands: Record<string, string>; agent_provider: string }) => {
    if (!config) return
    setSavingConfig(true)
    try {
      await updateAgentConfig(config, nextAgentConfig)
      setAgentConfig(nextAgentConfig)
      setStatusMessage('Agent configuration updated.')
    } catch (err) {
      setOperatorError('save agent config failed', err)
    } finally {
      setSavingConfig(false)
    }
  }

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
          // Fetch board issues to populate the Kanban board persistence
          fetchIssues(config)
            .then(setBoardIssues)
            .catch(() => { })
        },
        onTimelineEvent: (eventType, envelope) => {
          setTimeline((previous) => appendTimelineEvent(previous, { type: envelope.type, at: envelope.timestamp, data: envelope.data }))
          if (eventType === 'run_succeeded') {
            const issueId = (envelope.data.issue_id as string) || ''
            const issueIdentifier = (envelope.data.issue_identifier as string) || ''
            if (issueId && issueIdentifier) {
              setBoardIssues((prev) => {
                if (prev.find((i) => i.issue_id === issueId)) {
                  return prev
                }
                return [
                  ...prev,
                  {
                    issue_id: issueId,
                    issue_identifier: issueIdentifier,
                    state: 'Done',
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

    syncControls.current = { startPolling: sync.startPolling, stopPolling: sync.stopPolling }

    return () => {
      sync.stop()
      syncControls.current = null
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
      }
    }

    const remaining = typeof snapshot.rate_limits?.remaining === 'number' ? String(snapshot.rate_limits.remaining) : ''
    return {
      running: String(snapshot.counts.running ?? 0),
      retrying: String(snapshot.counts.retrying ?? 0),
      totalTokens: String(snapshot.codex_totals?.total_tokens ?? 0),
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

  const handleIssueUpdate = async (identifier: string, updates: Record<string, unknown>) => {
    if (!config) return
    try {
      await updateIssue(config, identifier, updates)

      // Instantly update the board issues for snappy drag-and-drop
      const updatedIssues = await fetchIssues(config)
      setBoardIssues(updatedIssues)

      // Refetch state immediately to show updates in Kanban/lists
      void handleRefresh()
      // Also refetch the specific issue to update the detail view if it's open
      void executeIssueLookup(identifier)
    } catch (err) {
      setErrorMessage(`update issue failed: ${toDisplayError(err)}`)
    }
  }

  const handleStopSession = async (identifier: string, provider?: string) => {
    if (!config) return
    try {
      await stopIssueSession(config, identifier, provider)
      setStatusMessage(`Session for ${identifier}${provider ? ` (${provider})` : ''} termination signaled.`)
      void handleRefresh()
      void executeIssueLookup(identifier)
    } catch (err) {
      setErrorMessage(`stop session failed: ${toDisplayError(err)}`)
    }
  }

  const handleCreateIssue = (initialState: string) => {
    setCreateTaskInitialState(initialState)
    setCreateTaskDialogOpen(true)
  }

  const handleTaskSubmit = async (payload: {
    title: string;
    description: string;
    state: string;
    priority: number;
    assignee_id: string;
    project_id: string;
    provider?: string;
    disabled_tools?: string[];
  }) => {
    if (!config) return
    try {
      await createIssue(config, payload)
      setStatusMessage(`Task "${payload.title}" created.`)

      // Instantly update the board issues so it appears without waiting for an SSE cycle
      const updatedIssues = await fetchIssues(config)
      setBoardIssues(updatedIssues)

      void handleRefresh()
    } catch (err) {
      setErrorMessage(`create task failed: ${toDisplayError(err)}`)
    }
  }

  const handleIssueDelete = async (identifier: string) => {
    if (!config) return
    if (!window.confirm(`Are you sure you want to delete task ${identifier}?`)) return

    try {
      await deleteIssue(config, identifier)
      setStatusMessage(`Task ${identifier} deleted.`)

      // Instantly update the board issues
      const updatedIssues = await fetchIssues(config)
      setBoardIssues(updatedIssues)

      void handleRefresh()
      if (issueLookupId === identifier) {
        setIssueLookupResult(null)
        setIssueLookupId('')
      }
    } catch (err) {
      setErrorMessage(`delete issue failed: ${toDisplayError(err)}`)
    }
  }

  const handleInspectIssueFromList = async (issueIdentifier: string) => {
    setIssueLookupId(issueIdentifier)
    setInspectDialogOpen(true)
    await executeIssueLookup(issueIdentifier)
  }

  const handleInspectSession = async (sessionId: string) => {
    if (!config) return
    setSessionInspectDialogOpen(true)
    setSessionLookupPending(true)
    setSessionLookupError('')
    try {
      const result = await fetchSessionDetail(config, sessionId)
      setSessionLookupResult(result)
    } catch (err) {
      setSessionLookupError(toDisplayError(err))
    } finally {
      setSessionLookupPending(false)
    }
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
      setErrorMessage(`switch profile failed: ${toDisplayError(err)}`)
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
      setErrorMessage(`create profile failed: ${toDisplayError(err)}`)
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
      setErrorMessage(`delete profile failed: ${toDisplayError(err)}`)
    } finally {
      setProfilesPending(false)
    }
  }

  const handleAddProject = async (path: string) => {
    if (!path || !config) return

    try {
      await createProject(config, path)
      setStatusMessage(`Project at ${path} added successfully.`)

      // Refresh projects
      const projs = await fetchProjects(config)
      setProjects(projs)

      // Refresh stats for the new project
      for (const p of projs) {
        if (!projectStats[p.id]) {
          try {
            const s = await fetchProjectStats(config, p.id)
            setProjectStats(prev => ({ ...prev, [p.id]: s }))
          } catch (e) {
            console.error('failed to fetch stats for new project', e)
          }
        }
      }
    } catch (err) {
      setErrorMessage(`failed to add project: ${toDisplayError(err)}`)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    if (!config) return
    try {
      await deleteProject(config, projectId)
      setStatusMessage('Project removed.')
      setProjects(prev => prev.filter(p => p.id !== projectId))
      setSelectedProjectID(null)
    } catch (err) {
      setErrorMessage(`failed to delete project: ${toDisplayError(err)}`)
    }
  }

  const handleTogglePolling = () => {
    if (!syncControls.current) return
    if (usePolling) {
      syncControls.current.stopPolling()
      setStatusMessage('Switched to SSE live stream.')
    } else {
      syncControls.current.startPolling()
      setStatusMessage('Switched to high-frequency polling.')
    }
    setUsePolling(!usePolling)
  }

  useEffect(() => {
    let mounted = true
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge) return

    desktopBridge.getAgentTokens().then((tokens) => {
      if (mounted) setAgentTokens(tokens)
    })

    return () => {
      mounted = false
    }
  }, [])

  const handleSaveAgentToken = async (name: string, value: string | null) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge) return
    try {
      await desktopBridge.setAgentToken(name, value)
      const nextTokens = await desktopBridge.getAgentTokens()
      setAgentTokens(nextTokens)
      setStatusMessage(value ? `Token ${name} stored securely.` : `Token ${name} removed.`)
    } catch (err) {
      setOperatorError('save token failed', err)
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
      <div className="flex h-full w-full relative">
        <SidebarNav
          items={sidebarItems}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          sidebarCollapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
          sidebarWidth={sidebarWidth}
        />

        <OverlayScrollbarsComponent
          element="main"
          options={osOptions}
          className="min-w-0 flex-1 bg-gradient-to-b from-background via-background to-muted/30 h-full"
        >
          <div className="px-6 pb-6 pt-4 lg:px-8 w-full max-w-[1800px] mx-auto flex flex-col min-h-full transition-all duration-500 origin-top-left" style={{ zoom: 0.6 }}>
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
              onSearch={(query) => (config ? searchIssues(config, query) : Promise.resolve([]))}
              onResultClick={handleInspectIssueFromList}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              generatedAt={generatedAt}
              usePolling={usePolling}
              onDownloadDiagnostics={handleDownloadDiagnostics}
              onTogglePolling={handleTogglePolling}
            />

            <div className="mt-4 grid min-w-0 grid-cols-12 gap-3 flex-1">
              {sectionVisibility.showDashboard ? (
                <>
                  <section className="col-span-12 grid grid-cols-3 gap-3 h-fit">
                    <MetricCard title="Active Sessions" value={metrics.running} icon={<Activity className="h-3.5 w-3.5 text-primary" />} hint="Issues currently being processed" />
                    <MetricCard title="Pending Retries" value={metrics.retrying} icon={<RefreshCcw className="h-3.5 w-3.5 text-amber-500" />} hint="Work items in backoff queue" />
                    <MetricCard title="Fleet Token Usage" value={metrics.totalTokens} icon={<Zap className="h-3.5 w-3.5 text-blue-500" />} hint="Aggregate compute consumption" />
                  </section>

                  <section className="col-span-12 h-fit">
                    <DashboardOverview
                      projects={projects}
                      stats={projectStats}
                      warehouseStats={warehouseStats}
                      onCreateTask={() => setCreateTaskDialogOpen(true)}
                      onProjectClick={(id) => {
                        if (id) {
                          setSelectedProjectID(id)
                          setActiveSection('projects')
                        } else {
                          setActiveSection('projects')
                        }
                      }}
                    />
                  </section>

                  <section className="col-span-12 lg:col-span-8 min-h-[450px] flex flex-col">
                    <OperationsQueueCard loadingState={loadingState} snapshot={snapshot} onInspectIssue={handleInspectIssueFromList} />
                  </section>

                  <section className="col-span-12 lg:col-span-4 min-h-[450px] flex flex-col">
                    <TimelineCard timeline={timeline.slice(0, 15)} />
                  </section>
                </>
              ) : null}

              {sectionVisibility.showProjects ? (
                <section className="col-span-12 flex flex-col flex-1">
                  {selectedProjectID && projects.find(p => p.id === selectedProjectID) ? (
                    <ProjectDetailView
                      project={projects.find(p => p.id === selectedProjectID)!}
                      stats={projectStats[selectedProjectID]}
                      config={config}
                      snapshot={snapshot}
                      boardIssues={boardIssues}
                      availableAgents={availableAgents}
                      loadingState={loadingState}
                      onBack={() => setSelectedProjectID(null)}
                      onInspectIssue={handleInspectIssueFromList}
                      onIssueUpdate={handleIssueUpdate}
                      onCreateIssue={handleCreateIssue}
                      onDeleteProject={handleDeleteProject}
                    />
                  ) : (
                    <ProjectGrid
                      projects={projects}
                      stats={projectStats}
                      loading={dataLoading}
                      onProjectClick={(id) => setSelectedProjectID(id)}
                      onAddProject={() => setCreateProjectDialogOpen(true)}
                      onDeleteProject={handleDeleteProject}
                    />
                  )}
                </section>
              ) : null}

              {sectionVisibility.showAgents ? (
                <section className="col-span-12 flex flex-col flex-1">
                  <AgentsDashboard config={config} snapshot={snapshot} />
                </section>
              ) : null}

              {sectionVisibility.showWarehouse ? (
                <section className="col-span-12 flex flex-col">
                  <AnalyticsDashboard
                    stats={warehouseStats}
                    loading={dataLoading}
                    onInspectSession={handleInspectSession}
                  />
                </section>
              ) : null}

              {sectionVisibility.showIssueBoard ? (
                <section className="col-span-12 flex flex-col min-h-[600px]">
                  <KanbanBoard
                    loadingState={loadingState}
                    snapshot={snapshot}
                    boardIssues={boardIssues}
                    projects={projects}
                    availableAgents={availableAgents}
                    onInspectIssue={handleInspectIssueFromList}
                    onIssueUpdate={handleIssueUpdate}
                    onIssueDelete={handleIssueDelete}
                    onStopSession={handleStopSession}
                    onCreateIssue={handleCreateIssue}
                  />
                </section>
              ) : null}

              {sectionVisibility.showRunning ? (
                <section className="col-span-12 flex flex-col">
                  <OperationsQueueCard loadingState={loadingState} snapshot={snapshot} onInspectIssue={handleInspectIssueFromList} />
                </section>
              ) : null}

              {sectionVisibility.showTimeline ? (
                <section className="col-span-12 flex flex-col">
                  <TimelineCard timeline={timeline} />
                </section>
              ) : null}

              {sectionVisibility.showDocs ? (
                <section className="col-span-12 flex flex-col flex-1">
                  <DocsDashboard config={config} />
                </section>
              ) : null}

              {sectionVisibility.showSettings ? (
                <section className="col-span-12 flex flex-col">
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
                    agentConfig={agentConfig}
                    agentTokens={agentTokens}
                    onMigrationFromChange={setMigrationFrom}
                    onMigrationToChange={setMigrationTo}
                    onMigrationPlan={handleMigrationPlan}
                    onMigrationApply={handleMigrationApply}
                    onSaveBackendConfig={handleBackendConfigSave}
                    onSetActiveProfile={handleSetActiveProfile}
                    onCreateProfile={handleCreateProfile}
                    onDeleteProfile={handleDeleteProfile}
                    onSaveAgentConfig={handleAgentConfigSave}
                    onSaveAgentToken={handleSaveAgentToken}
                  />
                </section>
              ) : null}
            </div>
          </div>
        </OverlayScrollbarsComponent>
      </div>

      <Dialog open={inspectDialogOpen} onOpenChange={setInspectDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Issue Inspection</DialogTitle>
            <DialogDescription>View detailed status and diagnostics for this issue.</DialogDescription>
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
            ) : (issueLookupResult && typeof issueLookupResult === 'object') ? (
              <IssueDetailView
                result={issueLookupResult}
                config={config}
                timeline={timeline}
                availableAgents={availableAgents}
                allTools={allTools}
                onUpdate={(updates) => handleIssueUpdate(issueLookupId, updates)}
                onStopSession={(p) => handleStopSession(issueLookupId, p)}
              />
            ) : (
              <p className="text-center text-sm text-muted-foreground py-10">No issue data available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sessionInspectDialogOpen} onOpenChange={setSessionInspectDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Historical Session Analysis</DialogTitle>
            <DialogDescription>Review historical execution logs and token usage for this session.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {sessionLookupPending ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-[200px]" />
                <Skeleton className="h-[200px] w-full" />
              </div>
            ) : sessionLookupError ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200">
                {sessionLookupError}
              </div>
            ) : sessionLookupResult ? (
              <SessionDetailView session={sessionLookupResult} />
            ) : (
              <p className="text-center text-sm text-muted-foreground">No session selected.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CreateTaskDialog
        open={createTaskDialogOpen}
        onOpenChange={setCreateTaskDialogOpen}
        initialState={createTaskInitialState}
        availableAgents={availableAgents}
        projects={projects}
        initialProjectID={selectedProjectID || ''}
        onSubmit={handleTaskSubmit}
      />

      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
        onSubmit={handleAddProject}
      />

      <Command.Dialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        label="Global Command Palette"
        className="fixed top-1/2 left-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl z-[100] overflow-hidden"
      >
        <Command.Input
          autoFocus
          placeholder="Type a command or search..."
          className="w-full border-b border-border bg-transparent p-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          <Command.Empty className="p-4 text-center text-sm text-muted-foreground">No results found.</Command.Empty>

          <Command.Group heading="Navigation" className="px-2 py-1 text-xs font-semibold text-muted-foreground">
            <Command.Item
              onSelect={() => { setActiveSection('dashboard'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <LayoutDashboard className="h-4 w-4" /> Go to Dashboard
            </Command.Item>
            <Command.Item
              onSelect={() => { setActiveSection('issues'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <Ticket className="h-4 w-4" /> Go to Tasks
            </Command.Item>
            <Command.Item
              onSelect={() => { setActiveSection('projects'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <FolderTree className="h-4 w-4" /> Go to Projects
            </Command.Item>
            <Command.Item
              onSelect={() => { setActiveSection('warehouse'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <Database className="h-4 w-4" /> Go to Analytics Warehouse
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Actions" className="px-2 py-1 mt-2 text-xs font-semibold text-muted-foreground border-t border-border/40">
            <Command.Item
              onSelect={() => { handleCreateIssue('Todo'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <Ticket className="h-4 w-4" /> Create New Task
            </Command.Item>
            <Command.Item
              onSelect={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <Settings2 className="h-4 w-4" /> Toggle Theme
            </Command.Item>
            <Command.Item
              onSelect={() => { handleTogglePolling(); setPaletteOpen(false) }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
            >
              <Activity className="h-4 w-4" /> Toggle Connection Mode (SSE/Polling)
            </Command.Item>
          </Command.Group>

          {projects.length > 0 && (
            <Command.Group heading="Projects" className="px-2 py-1 mt-2 text-xs font-semibold text-muted-foreground border-t border-border/40">
              {projects.map(p => (
                <Command.Item
                  key={p.id}
                  onSelect={() => {
                    setActiveSection('projects')
                    setSelectedProjectID(p.id)
                    setPaletteOpen(false)
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50"
                >
                  <FolderTree className="h-4 w-4" /> {p.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command.Dialog>
    </div>
  )
}
