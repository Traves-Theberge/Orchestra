import { lazy, Suspense, useEffect, useRef } from 'react'
import {
  searchIssues,
  toDisplayError,
  isUnauthorizedError,
  type BackendConfig,
} from '@core/api/client'
import type { SessionSummary } from '@core/api/types'
import { ProjectGrid } from '@features/projects/ProjectGrid'
import { ProjectDetailView } from '@features/projects/ProjectDetailView'
import { UsagePage } from '@features/usage/UsagePage'
import { UsageStatusBar } from '@features/usage/UsageStatusBar'
import { TerminalMultiplexer } from '@features/terminal/TerminalMultiplexer'
import { AppShell } from '@layout/AppShell'
import {
  getCurrentSectionMeta,
  getSectionVisibility,
  isSectionID,
  sidebarItems,
  type SectionID,
} from '@layout/sections'
import { KanbanBoard } from '@features/kanban'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { SectionErrorBoundary } from '@ui/section-error-boundary'
import { EmbeddedAgentWidget } from '@features/embedded-agent'
import { AppCommandPalette } from '@layout/AppCommandPalette'
import { AppDialogs } from '@layout/AppDialogs'
import {
  useBackendConfig,
  useNotifications,
  useIssueLookup,
  useWorkspaceMigration,
  useAppSync,
  useIssueActions,
  useProjectActions,
  useBackendProfiles,
} from '@/hooks'
import { useAppStore } from '@core/store'

// Lazy-loaded heavy sections
const AgentsDashboard = lazy(() => import('@features/agents/AgentsDashboard').then(m => ({ default: m.AgentsDashboard })))
const DocsDashboard = lazy(() => import('@features/docs/DocsDashboard').then(m => ({ default: m.DocsDashboard })))
const SettingsPage = lazy(() => import('@layout/panels').then(m => ({ default: m.SettingsPage })))
const WorkspaceLayout = lazy(() => import('@features/workspace/WorkspaceLayout').then(m => ({ default: m.WorkspaceLayout })))
const SandboxDashboard = lazy(() => import('@features/sandbox/SandboxDashboard').then(m => ({ default: m.SandboxDashboard })))
const TrackerViewer = lazy(() => import('@features/tracker').then(m => ({ default: m.TrackerViewer })))

const SectionLoader = () => (
  <div className="flex-1 grid place-items-center text-muted-foreground text-sm">Loading…</div>
)

/** Root application component that manages backend sync, navigation, and top-level UI state. */
export default function App() {
  // ---------------------------------------------------------------------------
  // Zustand store selectors
  // ---------------------------------------------------------------------------
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const reapplyTheme = useAppStore(s => s.reapply)
  const activeThemeId = useAppStore(s => s.activeThemeId)
  const modeOverride = useAppStore(s => s.modeOverride)
  // Apply the active theme on mount and whenever the active id or mode flips.
  useEffect(() => {
    reapplyTheme()
  }, [reapplyTheme, activeThemeId, modeOverride])
  // Follow OS theme changes when mode is `auto`.
  useEffect(() => {
    if (modeOverride !== 'auto') return
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => reapplyTheme()
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      return undefined
    }
  }, [modeOverride, reapplyTheme])

  const activeSection = useAppStore(s => s.activeSection)
  const setActiveSection = useAppStore(s => s.setActiveSection)
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed)
  const setCreateProjectDialogOpen = useAppStore(s => s.setCreateProjectDialogOpen)
  const settingsInitialTab = useAppStore(s => s.settingsInitialTab)
  const setSettingsInitialTab = useAppStore(s => s.setSettingsInitialTab)
  const activePeriod = useAppStore(s => s.activePeriod)
  const setActivePeriod = useAppStore(s => s.setActivePeriod)

  const snapshot = useAppStore(s => s.snapshot)
  const timeline = useAppStore(s => s.timeline)
  const loadingState = useAppStore(s => s.loadingState)
  const statusMessage = useAppStore(s => s.statusMessage)
  const usePolling = useAppStore(s => s.usePolling)
  const refreshPending = useAppStore(s => s.refreshPending)

  const boardIssues = useAppStore(s => s.boardIssues)
  const allBoardIssues = useAppStore(s => s.allBoardIssues)

  const projects = useAppStore(s => s.projects)
  const projectStats = useAppStore(s => s.projectStats)
  const selectedProjectID = useAppStore(s => s.selectedProjectID)
  const setSelectedProjectID = useAppStore(s => s.setSelectedProjectID)
  const dataLoading = useAppStore(s => s.dataLoading)

  const agentConfig = useAppStore(s => s.agentConfig)
  const availableAgents = useAppStore(s => s.availableAgents)
  const openTerminals = useAppStore(s => s.openTerminals)
  const setOpenTerminals = useAppStore(s => s.setOpenTerminals)

  // ---------------------------------------------------------------------------
  // Custom hooks (bridged to store where needed)
  // ---------------------------------------------------------------------------
  const {
    config, setConfig: setConfigHook,
    loadingConfig, savingConfig, setSavingConfig,
    backendProfiles, setBackendProfiles,
    activeProfileId, setActiveProfileId,
    profilesPending, setProfilesPending,
    errorMessage, setErrorMessage,
  } = useBackendConfig()

  // Bridge useBackendConfig state into the store for consumers
  const storeSetConfig = useAppStore(s => s.setConfig)
  const storeSetLoadingConfig = useAppStore(s => s.setLoadingConfig)
  useEffect(() => {
    storeSetConfig(config)
    storeSetLoadingConfig(loadingConfig)
  }, [config, loadingConfig, storeSetConfig, storeSetLoadingConfig])

  const setConfig = (cfg: BackendConfig | null) => {
    setConfigHook(cfg)
    storeSetConfig(cfg)
  }

  const setStatusMessage = useAppStore(s => s.setStatusMessage)

  const {
    notifSound, setNotifSound,
    notifMuted, setNotifMuted,
    notifVolume, setNotifVolume,
    playNotification,
  } = useNotifications()

  const setOperatorError = (prefix: string, err: unknown) => {
    const message = toDisplayError(err)
    setErrorMessage(`${prefix}: ${message}`)
    if (isUnauthorizedError(err) || message.startsWith('unauthorized:')) {
      setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
    }
  }

  const {
    issueLookupId, setIssueLookupId,
    issueLookupPending, setIssueLookupPending,
    issueLookupResult, setIssueLookupResult,
    issueLookupError, setIssueLookupError,
    executeIssueLookup,
  } = useIssueLookup(config, setStatusMessage)

  const {
    migrationFrom, setMigrationFrom,
    migrationTo, setMigrationTo,
    migrationPlan, setMigrationPlan: _setMigrationPlan,
    migrationPending,
    handleMigrationPlan,
    handleMigrationApply,
  } = useWorkspaceMigration(config, setStatusMessage, setOperatorError)

  // ---------------------------------------------------------------------------
  // Extracted hooks
  // ---------------------------------------------------------------------------
  const { handleRefresh, handleTogglePolling, generatedAt } = useAppSync(config, {
    issueLookupId,
    executeIssueLookup,
    playNotification,
    setErrorMessage,
  })

  // Keep a ref so keyboard shortcuts can always call the latest handleRefresh
  const handleRefreshRef = useRef(handleRefresh)
  handleRefreshRef.current = handleRefresh

  const {
    handleIssueUpdate,
    handleStopSession,
    handleCreateIssue,
    handleTaskSubmit,
    handleIssueDelete,
    handleInspectIssueFromList,
    handleInspectSession,
    sessionLookupResult,
    sessionLookupPending,
    sessionLookupError,
  } = useIssueActions(config, {
    onRefresh: handleRefresh,
    executeIssueLookup,
    issueLookupId,
    setIssueLookupId,
    setIssueLookupResult,
    setIssueLookupError,
    setIssueLookupPending,
    setErrorMessage,
    setStatusMessage,
  })

  const { handleAddProject, handleDeleteProject, refreshProjectsAndStats } = useProjectActions(
    config,
    activeSection,
    { setErrorMessage, setStatusMessage },
  )

  const {
    handleBackendConfigSave,
    handleSetActiveProfile,
    handleCreateProfile,
    handleDeleteProfile,
    handleAgentConfigSave,
  } = useBackendProfiles(config, {
    setConfig,
    setErrorMessage,
    setStatusMessage,
    savingConfig,
    setSavingConfig,
    setBackendProfiles,
    setActiveProfileId,
    setProfilesPending,
  })

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useAppStore.getState().togglePalette()
      }
      if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleRefreshRef.current?.()
      }
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useAppStore.getState().toggleSidebar()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        useAppStore.getState().openBrowserTab()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        useAppStore.getState().setActiveLeftPanel('explorer')
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useAppStore.getState().setActiveLeftPanel('search')
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        useAppStore.getState().toggleLeftSidebar()
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        useAppStore.getState().toggleRightSidebar()
        return
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const num = parseInt(e.key, 10)
        if (!isNaN(num) && num >= 1 && num <= sidebarItems.length) {
          e.preventDefault()
          useAppStore.getState().setActiveSection(sidebarItems[num - 1].id as SectionID)
        }
      }
    }
    document.addEventListener('keydown', down, true)
    return () => document.removeEventListener('keydown', down, true)
  }, [])

  // Ctrl+1-8 tab switching via Electron IPC (bypasses Chromium)
  useEffect(() => {
    const bridge = (window as unknown as Record<string, unknown>).orchestraDesktop as { onSwitchTab?: (cb: (tabNum: number) => void) => () => void } | undefined
    if (bridge?.onSwitchTab) {
      bridge.onSwitchTab((tabNum: number) => {
        if (tabNum >= 1 && tabNum <= sidebarItems.length) {
          useAppStore.getState().setActiveSection(sidebarItems[tabNum - 1].id as SectionID)
        }
      })
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Terminal handlers
  // ---------------------------------------------------------------------------
  const handleCloseTerminal = (id: string) => {
    setOpenTerminals(openTerminals.filter(t => t.id !== id))
  }

  const handleJumpToTerminal = (identifier: string) => {
    const termId = `issue-${identifier}`
    const current = useAppStore.getState().openTerminals
    if (!current.some(p => p.id === termId)) {
      setOpenTerminals([...current, { id: termId, title: `Agent: ${identifier}` }])
    }
    setActiveSection('CONSOLE')
  }

  const handleSectionChange = (section: string) => {
    if (!isSectionID(section)) return
    setActiveSection(section)
  }

  const handleCloneSession = (session: SessionSummary) => {
    setSelectedProjectID(session.project_id || null)
    useAppStore.getState().openCreateTaskDialog({ state: 'Todo' })
    setActiveSection('ISSUES')
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------
  const handleDownloadDiagnostics = () => {
    const data = {
      app: 'orchestra-desktop',
      timestamp: new Date().toISOString(),
      config: { baseUrl: config?.baseUrl, activeProfileId },
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

  const sidebarWidth = sidebarCollapsed ? 64 : 248
  const sectionVisibility = getSectionVisibility(activeSection)
  const currentSectionMeta = getCurrentSectionMeta(activeSection)
  return (
    <AppTooltipProvider>
      <AppShell
        items={sidebarItems}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapsed={() => useAppStore.getState().toggleSidebar()}
        sidebarWidth={sidebarWidth}
        flushContent={sectionVisibility.showDocs || sectionVisibility.showSettings || activeSection === 'CONSOLE'}
        bottomBar={<UsageStatusBar config={config} />}
        topBarProps={{
          sectionLabel: currentSectionMeta.label,
          sectionTitle: currentSectionMeta.title,
          theme,
          setTheme,
          activePeriod,
          setActivePeriod,
          refreshPending,
          configReady: Boolean(config),
          onOpenSettings: () => setActiveSection('SETTINGS'),
          onRefresh: handleRefresh,
          onSearch: (query) => (config ? searchIssues(config, query) : Promise.resolve([])),
          onResultClick: handleInspectIssueFromList,
          statusMessage,
          errorMessage,
          generatedAt,
          usePolling,
          onDownloadDiagnostics: handleDownloadDiagnostics,
          onTogglePolling: handleTogglePolling,
        }}
      >
        <div className="mt-4 flex flex-col flex-1 min-w-0 min-h-0 h-full">
          {sectionVisibility.showProjects ? (
            <SectionErrorBoundary name="Projects">
              <section className="flex-1 flex flex-col min-h-0">
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
                    onJumpToTerminal={handleJumpToTerminal}
                    onIssueUpdate={handleIssueUpdate}
                    onIssueDelete={handleIssueDelete}
                    onStopSession={handleStopSession}
                    onCreateIssue={handleCreateIssue}
                    onDeleteProject={handleDeleteProject}
                    onRefreshProjects={refreshProjectsAndStats}
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
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showAgents ? (
            <SectionErrorBoundary name="Agents">
              <section className="flex-1 flex flex-col min-h-0">
                <Suspense fallback={<SectionLoader />}>
                  <AgentsDashboard config={config} />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showWarehouse ? (
            <SectionErrorBoundary name="Usage">
              <section className="flex-1 flex flex-col min-h-0">
                <UsagePage config={config} />
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showIssueBoard ? (
            <SectionErrorBoundary name="Kanban Board">
              <section className="flex-1 flex flex-col min-h-0">
                <KanbanBoard
                  loadingState={loadingState}
                  snapshot={snapshot}
                  boardIssues={allBoardIssues}
                  projects={projects}
                  availableAgents={availableAgents}
                  onInspectIssue={handleInspectIssueFromList}
                  onJumpToTerminal={handleJumpToTerminal}
                  onIssueUpdate={handleIssueUpdate}
                  onIssueDelete={handleIssueDelete}
                  onStopSession={handleStopSession}
                  onCreateIssue={handleCreateIssue}
                />
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showDocs ? (
            <SectionErrorBoundary name="Documentation">
              <section className="flex-1 flex flex-col min-h-0">
                <Suspense fallback={<SectionLoader />}>
                  <DocsDashboard config={config} theme={theme} />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showConsole && config ? (
            <SectionErrorBoundary name="Console">
              <section className="flex-1 flex flex-col min-h-0">
                <Suspense fallback={<SectionLoader />}>
                  <WorkspaceLayout
                    onAddTerminal={() => {
                      const state = useAppStore.getState()
                      const projectId = state.activeProjectId
                      const proj = state.projects.find(p => p.id === projectId)
                      const title = proj ? `${proj.name} Shell` : 'Shell'
                      const realProjectId = proj ? projectId : undefined
                      const cwd = proj?.root_path ?? undefined
                      const initialCommand = cwd
                        ? `cd "${cwd.replace(/"/g, '\\"')}" && clear`
                        : undefined
                      const id = `shell-${Date.now()}`
                      setOpenTerminals([
                        ...state.openTerminals,
                        { id, title, projectId: realProjectId, cwd, initialCommand },
                      ])
                      state.addTabToGroup(projectId, { type: 'terminal', id })
                    }}
                    centerContent={
                      <TerminalMultiplexer
                        hideToolbar
                        activeTerminals={openTerminals}
                        baseUrl={config.baseUrl}
                        apiToken={config.apiToken}
                        projects={projects}
                        onCloseTerminal={handleCloseTerminal}
                        onAddTerminal={(projectId) => {
                          if (!projectId) return
                          const proj = projects.find(p => p.id === projectId)
                          const name = proj?.name ?? 'Shell'
                          const id = `shell-${Date.now()}`
                          useAppStore.getState().openProjectTab(projectId, proj?.root_path ?? null)
                          setOpenTerminals([...useAppStore.getState().openTerminals, { id, title: `${name} Shell`, projectId }])
                          useAppStore.getState().addTabToGroup(projectId, { type: 'terminal', id })
                        }}
                        onAddAgentTerminal={(id, title, command, projectId) => {
                          if (projectId) {
                            const proj = projects.find(p => p.id === projectId)
                            useAppStore.getState().openProjectTab(projectId, proj?.root_path ?? null)
                          }
                          setOpenTerminals([...useAppStore.getState().openTerminals, { id, title, projectId, initialCommand: command }])
                          if (projectId) useAppStore.getState().addTabToGroup(projectId, { type: 'terminal', id })
                        }}
                        theme={theme}
                      />
                    }
                  />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showSandbox ? (
            <SectionErrorBoundary name="Sandbox">
              <section className="col-span-12 flex flex-col">
                <Suspense fallback={<SectionLoader />}>
                  <SandboxDashboard config={config} onOpenSettings={() => { setSettingsInitialTab('integrations'); setActiveSection('SETTINGS') }} />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showTracker ? (
            <SectionErrorBoundary name="Tracker">
              <section className="col-span-12 flex flex-col">
                <Suspense fallback={<SectionLoader />}>
                  <TrackerViewer config={config} />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}

          {sectionVisibility.showSettings ? (
            <SectionErrorBoundary name="Settings">
              <section className="flex-1 flex flex-col min-h-0">
                <Suspense fallback={<SectionLoader />}>
                  <SettingsPage
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
                    onMigrationFromChange={setMigrationFrom}
                    onMigrationToChange={setMigrationTo}
                    onMigrationPlan={handleMigrationPlan}
                    onMigrationApply={handleMigrationApply}
                    onSaveBackendConfig={handleBackendConfigSave}
                    onSetActiveProfile={handleSetActiveProfile}
                    onCreateProfile={handleCreateProfile}
                    onDeleteProfile={handleDeleteProfile}
                    onSaveAgentConfig={handleAgentConfigSave}
                    notifSound={notifSound}
                    notifMuted={notifMuted}
                    notifVolume={notifVolume}
                    onNotifSoundChange={setNotifSound}
                    onNotifMutedChange={setNotifMuted}
                    onNotifVolumeChange={setNotifVolume}
                    initialTab={settingsInitialTab}
                  />
                </Suspense>
              </section>
            </SectionErrorBoundary>
          ) : null}
        </div>

        <EmbeddedAgentWidget
          config={config}
          onNavigate={(section, id) => {
            setActiveSection(section as SectionID)
            if (section === 'SETTINGS' && id) {
              setSettingsInitialTab(id as 'backend' | 'agents' | 'integrations' | 'shortcuts' | 'notifications')
            }
          }}
          onOpenSettings={() => { setSettingsInitialTab('integrations'); setActiveSection('SETTINGS') }}
          activeSection={activeSection}
        />
      </AppShell>

      <AppDialogs
        config={config}
        timeline={timeline}
        availableAgents={availableAgents}
        snapshot={snapshot}
        theme={theme}
        issueLookupId={issueLookupId}
        issueLookupPending={issueLookupPending}
        issueLookupError={issueLookupError}
        issueLookupResult={issueLookupResult}
        sessionLookupPending={sessionLookupPending}
        sessionLookupError={sessionLookupError}
        sessionLookupResult={sessionLookupResult}
        onIssueUpdate={handleIssueUpdate}
        onStopSession={handleStopSession}
        onTaskSubmit={handleTaskSubmit}
        onAddProject={handleAddProject}
      />

      <AppCommandPalette onCreateIssue={handleCreateIssue} onTogglePolling={handleTogglePolling} />
    </AppTooltipProvider>
  )
}
