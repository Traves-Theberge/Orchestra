import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Ansi from 'ansi-to-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Activity, AlertCircle, AlertTriangle, AppWindow, Bot, Check, CheckCircle2, ChevronDown, Circle, CircleDashed, Cpu, FileText, Folder, FolderTree, GitBranch, Loader2, ListChecks, MoreHorizontal, ShieldCheck, SignalHigh, SignalLow, SignalMedium, Square, Terminal, User, Users, Wrench, Clock, Search, LayoutDashboard, ListTodo, History, Ticket, Database, Settings2, Sun, Moon, Download, RefreshCcw, Info, BarChart3, Zap, Layout, Rows, Play, ChevronRight, File, ExternalLink, Plus, Trash2, Keyboard, X, TrendingUp, Code, Layers } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '../ui/tooltip-wrapper'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import type { TimelineItem } from '@/components/app-shell/types'
import { TerminalView } from '@/components/terminal/TerminalView'
import {
  fetchArtifactContent,
  fetchArtifacts,
  fetchIssueDiff,
  fetchIssueLogs,
  fetchIssueHistory,
  updateIssue,
  createGitHubPR,
  type BackendConfig,
  type IssueCreatePayload,
  type IssueListItem,
  type MCPTool,
  type WorkspaceMigrationResult,
} from '@/lib/orchestra-client'
import type { SnapshotPayload, Project, ProjectStats, GlobalStats } from '@/lib/orchestra-types'
import { usePlatform } from '@/hooks/use-platform'
import { AgentSelector, CustomDropdown, PriorityIcon, PriorityLabel, PrioritySelector, ProjectSelector } from '@/components/app-shell/shared/controls'

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

function IconButton({ icon, title, onClick, className = '' }: { icon: ReactNode; title: string; onClick?: () => void; className?: string }) {
  return (
    <AppTooltip content={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className={`grid h-8 w-8 place-items-center rounded-lg bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground ${className}`}
      >
        {icon}
      </button>
    </AppTooltip>
  )
}

export function DashboardOverview({
  projects,
  issues,
  stats,
  snapshot,
  warehouseStats,
  onProjectClick,
  onJumpToTerminal,
  onCreateTask,
}: {
  projects: Project[]
  issues: IssueListItem[]
  stats: Record<string, ProjectStats>
  snapshot: SnapshotPayload | null
  warehouseStats: GlobalStats | null
  onProjectClick: (id: string) => void
  onJumpToTerminal?: (identifier: string) => void
  onCreateTask?: () => void
}) {
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      // 1. Check for active sessions in snapshot
      // Map running issue IDs to their project IDs using the issues list
      const activeProjectIds = new Set(
        snapshot?.running
          ?.map((running) => issues.find((issue) => (issue.id === running.issue_id || issue.issue_id === running.issue_id))?.project_id)
          .filter(Boolean)
      )

      const activeA = activeProjectIds.has(a.id) ? 1 : 0
      const activeB = activeProjectIds.has(b.id) ? 1 : 0
      
      if (activeA !== activeB) return activeB - activeA

      // 2. Check last active date
      const lastA = stats[a.id]?.last_active ? new Date(stats[a.id].last_active).getTime() : 0
      const lastB = stats[b.id]?.last_active ? new Date(stats[b.id].last_active).getTime() : 0
      
      if (lastA !== lastB) return lastB - lastA

      // 3. Fallback to total sessions
      const sA = stats[a.id]?.total_sessions ?? 0
      const sB = stats[b.id]?.total_sessions ?? 0
      return sB - sA
    }).slice(0, 6)
  }, [projects, issues, stats, snapshot])

  const displayProjects = sortedProjects

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 min-h-0">
      {/* Workspace Activity (Left) */}
      <div className="lg:col-span-2 flex flex-col min-h-[420px]">
        <Card className="bg-card/40 backdrop-blur-xl border-border/40 shadow-2xl shadow-primary/5 flex-1 flex flex-col min-h-0 transition-all duration-500 hover:shadow-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4 shrink-0">
            <div className="space-y-1">
              <CardTitle className="text-sm font-black uppercase tracking-[0.1em] flex items-center gap-2 text-foreground/90">
                <FolderTree size={16} className="text-primary" />
                Active Workspaces
              </CardTitle>
              <CardDescription className="text-[10px] font-medium text-muted-foreground/60">Cross-repository agent coordination hub</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <AppTooltip content="Create a new task">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 transition-all shadow-lg shadow-primary/5 hover:-translate-y-0.5 active:translate-y-0"
                  onClick={onCreateTask}
                >
                  <Plus size={14} className="mr-1.5" strokeWidth={3} />
                  New Task
                </Button>
              </AppTooltip>
              <AppTooltip content="Open all workspaces">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
                  onClick={() => onProjectClick('')}
                >
                  Explore All
                </Button>
              </AppTooltip>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 px-3 pb-4">
            <div className="space-y-1.5 h-full overflow-auto custom-scrollbar">
              {displayProjects.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-border/40 rounded-2xl bg-muted/10">
                  <Folder size={32} className="mx-auto mb-3 opacity-10" strokeWidth={1} />
                  <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">No active workspaces discovered</p>
                </div>
              ) : displayProjects.map((p) => {
                const runningIssue = snapshot?.running?.find(r => issues.find(i => i.id === r.issue_id)?.project_id === p.id)
                const isActive = !!runningIssue
                return (
                  <div key={p.id} className="relative group">
                    <button
                      onClick={() => onProjectClick(p.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-2.5 transition-all duration-300 shadow-sm ${
                        isActive 
                          ? 'border-primary/30 bg-primary/5 hover:bg-primary/10 shadow-lg shadow-primary/5' 
                          : 'border-border/40 bg-muted/20 hover:bg-muted/40 hover:border-border/60 hover:-translate-y-0.5'
                      }`}
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className={`rounded-xl p-2.5 transition-all duration-500 ${
                          isActive 
                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40 rotate-0' 
                            : 'bg-background border border-border/50 text-muted-foreground group-hover:text-primary group-hover:border-primary/20 -rotate-3 group-hover:rotate-0'
                        }`}>
                          <Folder size={18} strokeWidth={2.5} />
                        </div>
                        <div className="text-left min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-black tracking-tight group-hover:text-primary transition-colors truncate">{p.name}</p>
                            {isActive && (
                              <Badge className="h-3.5 px-1 bg-primary text-primary-foreground text-[7px] font-black uppercase animate-pulse">Running</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground/50 font-mono truncate">{p.root_path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 shrink-0 pr-2">
                        <div className="flex flex-col items-end">
                          <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Sessions</span>
                          <span className="text-xs font-bold tabular-nums">{stats[p.id]?.total_sessions || 0}</span>
                        </div>
                        <ChevronRight size={16} className={`transition-all duration-300 ${isActive ? 'text-primary' : 'text-muted-foreground/20 group-hover:text-primary/40 group-hover:translate-x-0.5'}`} />
                      </div>
                    </button>
                    {isActive && onJumpToTerminal && (
                      <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <AppTooltip content="Jump to Terminal">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-7 w-7 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 border border-primary/40"
                            onClick={(e) => {
                              e.stopPropagation()
                              onJumpToTerminal(runningIssue.issue_identifier)
                            }}
                          >
                            <Terminal size={12} strokeWidth={3} />
                          </Button>
                        </AppTooltip>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fleet Distribution (Right) */}
      <div className="flex flex-col">
        <Card className="bg-card/40 backdrop-blur-xl border-border/40 shadow-2xl flex-1 flex flex-col min-h-0 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Cpu size={120} />
          </div>
          <CardHeader className="pb-4 shrink-0 relative z-10">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground/90">
              <Cpu size={16} className="text-amber-500/70" />
              Agent Distribution
            </CardTitle>
            <CardDescription className="text-[11px]">Provider workload across historical sessions</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 relative z-10">
            {!warehouseStats || !warehouseStats.provider_usage || Object.entries(warehouseStats.provider_usage).length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 opacity-20 grayscale">
                <Activity size={48} className="mb-4" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Telemetry Pending</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(warehouseStats.provider_usage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, tokens]) => {
                    const percentage = Math.max(5, (tokens / warehouseStats.total_tokens) * 100)
                    return (
                      <div key={name} className="space-y-2 group/bar">
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="flex items-center gap-2">
                            <div className={`h-1.5 w-1.5 rounded-full ${name.includes('claude') ? 'bg-orange-500' : name.includes('gemini') ? 'bg-blue-500' : 'bg-primary'} shadow-[0_0_8px_rgba(var(--primary),0.4)]`} />
                            {name}
                          </span>
                          <span className="text-muted-foreground group-hover/bar:text-primary transition-colors">{(tokens / 1000).toFixed(1)}k</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden border border-border/10">
                          <div
                            className={`h-full transition-all duration-1000 ease-out shadow-lg ${name.includes('claude') ? 'bg-gradient-to-r from-orange-600/50 to-orange-400/50' : name.includes('gemini') ? 'bg-gradient-to-r from-blue-600/50 to-blue-400/50' : 'bg-gradient-to-r from-primary/60 to-primary/30'}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { TimelineCard } from '@widgets/timeline/TimelineCard'

export function SettingsCard({
  loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  migrationPending,
  migrationFrom,
  migrationTo,
  migrationPlan,
  agentConfig,
  onMigrationFromChange,
  onMigrationToChange,
  onMigrationPlan,
  onMigrationApply,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
  onSaveAgentConfig,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  migrationPending: boolean
  migrationFrom: string
  migrationTo: string
  migrationPlan: WorkspaceMigrationResult | null
  agentConfig: { commands: Record<string, string>; agent_provider: string } | null
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
  onSaveAgentConfig: (config: { commands: Record<string, string>; agent_provider: string }) => Promise<void>
}) {
  const { isMac } = usePlatform()
  const [activeTab, setActiveTab] = useState<'backend' | 'agents' | 'migration' | 'shortcuts'>('backend')

  const tabs = [
    { id: 'backend', label: 'Backend', tooltip: 'Configure backend profiles and API connection', icon: <Database className="h-3.5 w-3.5" /> },
    { id: 'agents', label: 'Agents', tooltip: 'Set provider commands and default runner', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'migration', label: 'Migration', tooltip: 'Plan and apply workspace migrations', icon: <RefreshCcw className="h-3.5 w-3.5" /> },
    { id: 'shortcuts', label: 'Shortcuts', tooltip: 'View global keyboard shortcuts', icon: <Keyboard className="h-3.5 w-3.5" /> },
  ] as const

  return (
    <Card className="border bg-card shadow-lg dark:bg-card flex flex-col h-full overflow-hidden">
      <CardHeader className="border-b border-border/40 pb-0 shrink-0">
        <CardTitle className="mb-2">System Settings</CardTitle>
        <CardDescription className="mb-4 text-xs font-medium">Configure orchestrator runtime and security parameters.</CardDescription>

        <div className="flex gap-1">
          {tabs.map((tab) => (
            <AppTooltip key={tab.id} content={tab.tooltip}>
              <button
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            </AppTooltip>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeTab === 'backend' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                Connection Profiles
              </div>
              <BackendConfigForm
                loadingConfig={loadingConfig}
                savingConfig={savingConfig}
                profilesPending={profilesPending}
                config={config}
                backendProfiles={backendProfiles}
                activeProfileId={activeProfileId}
                onSaveBackendConfig={onSaveBackendConfig}
                onSetActiveProfile={onSetActiveProfile}
                onCreateProfile={onCreateProfile}
                onDeleteProfile={onDeleteProfile}
                disabled={loadingConfig || savingConfig || profilesPending}
              />
            </div>
          )}

          {activeTab === 'agents' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                Fleet Configuration
              </div>
              {agentConfig ? (
                <AgentConfigForm
                  agentConfig={agentConfig}
                  onSave={onSaveAgentConfig}
                  disabled={savingConfig || loadingConfig}
                />
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                  <Activity className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-xs italic uppercase tracking-wider">No agent configuration loaded from active profile.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'migration' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <RefreshCcw className="h-3.5 w-3.5" />
                Workspace Transfer
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Migrate issue workspaces between filesystem targets. This tool will recursively copy git state and artifacts.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceMigrationDialog
                  migrationPending={migrationPending}
                  config={config}
                  migrationFrom={migrationFrom}
                  migrationTo={migrationTo}
                  migrationPlan={migrationPlan}
                  onMigrationFromChange={onMigrationFromChange}
                  onMigrationToChange={onMigrationToChange}
                  onMigrationPlan={onMigrationPlan}
                  onMigrationApply={onMigrationApply}
                />
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <Keyboard className="h-3.5 w-3.5" />
                Keyboard Command Mapping
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Global shortcuts for rapid navigation and fleet management.
              </p>
              
              <div className="grid gap-3">
                <div className="flex items-center justify-between p-4 rounded-xl border border-border/20 bg-muted/10">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Command Palette</p>
                    <p className="text-[10px] text-muted-foreground">Search and navigate instantly across the platform.</p>
                  </div>
                  <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">{isMac ? '⌘' : 'Ctrl'}</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">K</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-border/20 bg-muted/10">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Refresh Tracker</p>
                    <p className="text-[10px] text-muted-foreground">Manually trigger a full state synchronization.</p>
                  </div>                   <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">{isMac ? '⌘' : 'Ctrl'}</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">R</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-border/20 bg-muted/10">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Toggle Sidebar</p>
                    <p className="text-[10px] text-muted-foreground">Collapse or expand the primary navigation rail.</p>
                  </div>                   <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">{isMac ? '⌘' : 'Ctrl'}</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">/</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-border/20 bg-muted/10">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Quick Switch (Dashboard)</p>
                    <p className="text-[10px] text-muted-foreground">Jump back to the operations overview.</p>
                  </div>                   <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">{isMac ? '⌥' : 'Alt'}</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">1</kbd>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-[10px] text-muted-foreground italic">Note: Custom shortcut remapping is currently in development and will be available in v1.1.0.</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AgentConfigForm({
  agentConfig,
  onSave,
  disabled,
}: {
  agentConfig: { commands: Record<string, string>; agent_provider: string }
  onSave: (config: { commands: Record<string, string>; agent_provider: string }) => Promise<void>
  disabled: boolean
}) {
  const [provider, setProvider] = useState(agentConfig.agent_provider || '')
  const [commands, setCommands] = useState(agentConfig.commands || {})

  const handleCommandChange = (key: string, value: string) => {
    setCommands((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Primary Provider</label>
        <CustomDropdown
          className="w-64"
          value={provider}
          options={Object.keys(commands).map((p) => ({ label: p, value: p, icon: <Activity className="h-3 w-3" /> }))}
          onChange={setProvider}
          disabled={disabled}
          placeholder="Select provider..."
        />
      </div>

      <div className="space-y-3">
        <label className="text-xs text-muted-foreground">Agent Commands</label>
        {Object.keys(commands).length === 0 ? (
          <p className="text-[10px] text-muted-foreground/50">No agent runners configured in backend.</p>
        ) : Object.keys(commands).map((p) => (
          <div key={p} className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground/60">{p}</span>
            <input
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono"
              value={commands[p]}
              onChange={(e) => handleCommandChange(p, e.target.value)}
              placeholder={`command for ${p}...`}
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        onClick={() => void onSave({ agent_provider: provider, commands })}
        disabled={disabled || !provider}
      >
        Update Agent Configuration
      </Button>
    </div>
  )
}

export { IssueDetailView } from '@widgets/issue-detail/IssueDetailView'

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (path: string) => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) setPath('')
  }, [open])

  const handleBrowse = async () => {
    const desktopBridge = window.orchestraDesktop
    if (desktopBridge && typeof desktopBridge.selectFolder === 'function') {
      const selected = await desktopBridge.selectFolder()
      if (selected) {
        setPath(selected)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!path.trim()) return
    setPending(true)
    try {
      await onSubmit(path.trim())
      onOpenChange(false)
    } catch (error) {
      console.error('Project creation failed', error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border shadow-2xl">
        <DialogHeader className="border-b border-border/40 pb-4">
          <DialogTitle className="text-xl font-bold tracking-tight">Add Project</DialogTitle>
          <DialogDescription className="text-muted-foreground/70">
            Enter the absolute path to your local git repository.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-6">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Workspace Root Path</label>
            <div className="flex gap-2">
              <input
                autoFocus
                className="h-11 flex-1 rounded-xl border border-border bg-background px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                placeholder="/home/user/projects/my-app"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleBrowse}
                className="h-11 rounded-xl border-dashed px-3 text-muted-foreground hover:text-primary hover:border-primary/50"
                tooltip="Browse filesystem"
                aria-label="Browse filesystem"
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !path.trim()}
              className="px-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
            >
              {pending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Adding...</span>
                </div>
              ) : 'Add Project'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  initialState,
  availableAgents,
  allTools = [],
  projects = [],
  initialProjectID = '',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialState: string
  availableAgents: string[]
  allTools?: MCPTool[]
  projects?: Project[]
  initialProjectID?: string
  onSubmit: (payload: IssueCreatePayload) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState(initialState)
  const [priority, setPriority] = useState(0)
  const [assignee, setAssignee] = useState('Unassigned')
  const [provider, setProvider] = useState('')
  const [disabledTools, setDisabledTools] = useState<string[]>([])
  const [projectID, setProjectID] = useState(initialProjectID)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setState(initialState)
      setProjectID(initialProjectID)
      setTitle('')
      setDescription('')
      setPriority(0)
      setAssignee('Unassigned')
      setProvider(availableAgents.length > 0 ? availableAgents[0] : '')
      setDisabledTools([])
    }
  }, [open, initialState, initialProjectID, availableAgents])

  const handleToggleTool = (name: string) => {
    setDisabledTools(prev => 
      prev.includes(name) 
        ? prev.filter(t => t !== name) 
        : [...prev, name]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setPending(true)
    try {
      await onSubmit({
        title,
        description,
        state,
        priority,
        assignee_id: assignee,
        project_id: projectID,
        provider,
        disabled_tools: disabledTools
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Task creation failed', error)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-none shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] p-0 overflow-hidden max-h-[90vh] flex flex-col rounded-2xl">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
          <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-[400px]">
            {/* Main Content Area */}
            <div className="flex-1 p-8 space-y-6">
              <input
                autoFocus
                className="w-full bg-transparent border-none text-2xl font-semibold placeholder:text-muted-foreground/30 focus:ring-0 p-0 selection:bg-primary/30"
                placeholder="Task Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <textarea
                className="w-full bg-transparent border-none text-base placeholder:text-muted-foreground/20 focus:ring-0 p-0 resize-none min-h-[100px] selection:bg-primary/20 leading-relaxed"
                placeholder="Add a description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              {/* Tool Management Section */}
              {allTools.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-border/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                      <Wrench size={10} /> Initial Capabilities
                    </div>
                    <span className="text-[8px] font-bold text-primary/60">{allTools.length - disabledTools.length} Tools Enabled</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allTools.map((tool) => {
                      const isDisabled = disabledTools.includes(tool.name)
                      return (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => handleToggleTool(tool.name)}
                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border transition-all ${isDisabled ? 'border-border text-muted-foreground/40 opacity-40 hover:opacity-60' : 'border-primary/20 bg-primary/10 text-primary hover:bg-primary/20'}`}
                        >
                          {tool.name.includes('_') ? tool.name.split('_')[1] : tool.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Attribute & Action Bar */}
            <div className="border-t border-border/10 p-4 bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ProjectSelector
                  value={projectID}
                  projects={projects}
                  onChange={setProjectID}
                />

                <AgentSelector
                  value={assignee}
                  agents={availableAgents}
                  onChange={(val) => {
                    setAssignee(val)
                    // Automatically sync provider when agent is assigned
                    const agentName = val.replace('agent-', '')
                    if (availableAgents.includes(agentName)) {
                      setProvider(agentName)
                    } else if (val === '') {
                      setProvider(availableAgents.length > 0 ? availableAgents[0] : '')
                    }
                  }}
                />

                <PrioritySelector
                  value={priority}
                  onChange={setPriority}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                  className="text-muted-foreground/50 hover:text-foreground h-8 px-3 font-semibold text-[11px] uppercase tracking-wider"
                >
                  Discard
                </Button>
                <Button
                  type="submit"
                  disabled={pending || !title.trim()}
                  className="h-8 px-5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 font-bold uppercase tracking-widest text-[11px]"
                >
                  {pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Create Task'
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BackendConfigForm({
  loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
  disabled,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
  disabled?: boolean
}) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [newProfileName, setNewProfileName] = useState('')

  useEffect(() => {
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }, [config])

  const syncFromConfig = () => {
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">
        Profile
        <div className="mt-1 flex gap-2">
          <CustomDropdown
            className="w-64"
            value={activeProfileId}
            options={backendProfiles.map((p) => ({ label: p.name, value: p.id, icon: <ShieldCheck className="h-3 w-3" /> }))}
            onChange={(val) => void onSetActiveProfile(val)}
            disabled={disabled || backendProfiles.length === 0}
          />
          <AppTooltip content="Delete this profile">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
              disabled={disabled || backendProfiles.length <= 1 || activeProfileId === ''}
              onClick={() => {
                if (activeProfileId !== '') {
                  void onDeleteProfile(activeProfileId)
                }
              }}
            >
              Delete
            </Button>
          </AppTooltip>
        </div>
      </label>
      <label className="block text-xs text-muted-foreground">
        New Profile Name
        <div className="mt-1 flex gap-2">
          <input
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
            placeholder="Production, Staging, Local..."
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
            disabled={disabled || newProfileName.trim() === ''}
            onClick={() => {
              void onCreateProfile(newProfileName.trim())
              setNewProfileName('')
            }}
          >
            Create
          </Button>
        </div>
      </label>
      <label className="block text-xs text-muted-foreground">
        Base URL
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://127.0.0.1:4010"
          disabled={disabled}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        API Token
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={apiToken}
          onChange={(event) => setApiToken(event.target.value)}
          placeholder="optional bearer token"
          disabled={disabled}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
          onClick={syncFromConfig}
          disabled={disabled}
        >
          Reset
        </Button>
        <Button onClick={() => void onSaveBackendConfig({ baseUrl: baseUrl.trim(), apiToken: apiToken.trim() })} disabled={disabled || baseUrl.trim() === ''}>
          {savingConfig ? 'Saving...' : 'Save Backend Config'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Updates the preload-stored backend target used by runtime state/SSE requests.</p>
    </div>
  )
}

function WorkspaceMigrationDialog({
  migrationPending,
  config,
  migrationFrom,
  migrationTo,
  migrationPlan,
  onMigrationFromChange,
  onMigrationToChange,
  onMigrationPlan,
  onMigrationApply,
}: {
  migrationPending: boolean
  config: BackendConfig | null
  migrationFrom: string
  migrationTo: string
  migrationPlan: WorkspaceMigrationResult | null
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
}) {
  const [confirmApply, setConfirmApply] = useState(false)

  const handleApply = () => {
    if (!confirmApply) {
      setConfirmApply(true)
      return
    }
    void onMigrationApply()
    setConfirmApply(false)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent">
          Workspace Migration
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Workspace Migration</DialogTitle>
          <DialogDescription>Mapped to `/api/v1/workspace/migration/plan` and `/api/v1/workspace/migrate`.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">From</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={migrationFrom}
              onChange={(event) => onMigrationFromChange(event.target.value)}
              placeholder="optional source path"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">To</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={migrationTo}
              onChange={(event) => onMigrationToChange(event.target.value)}
              placeholder="optional target path"
            />
          </label>
          {migrationPlan ? (
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-xs">{JSON.stringify(migrationPlan, null, 2)}</pre>
          ) : null}
          {confirmApply ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
              Confirm migration apply. This triggers `/api/v1/workspace/migrate`.
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setConfirmApply(false)
              void onMigrationPlan()
            }}
            disabled={migrationPending || !config}
          >
            Plan
          </Button>
          <Button onClick={handleApply} disabled={migrationPending || !config}>
            {confirmApply ? 'Confirm Apply' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MetricCard({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: ReactNode }) {
  return (
    <Card className="group relative overflow-hidden border border-border/60 bg-gradient-to-br from-card via-card/95 to-muted/20 shadow-lg shadow-primary/5 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30 hover:-translate-y-1">
      {/* Subtle glowing overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

      {/* Premium corner element */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rotate-12 rounded-3xl border border-primary/10 bg-primary/5 shadow-inner transition-all duration-700 group-hover:rotate-0 group-hover:scale-125 group-hover:bg-primary/10" />

      <CardHeader className="relative p-5 pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/40 shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
            {title}
          </CardDescription>
          <div className="rounded-xl bg-muted/50 p-2 text-primary/70 transition-all duration-500 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-lg group-hover:shadow-primary/30 group-hover:rotate-3">
            {icon}
          </div>
        </div>
        <CardTitle className="mt-2 text-4xl font-black tracking-tighter tabular-nums transition-all duration-500 group-hover:translate-x-1 group-hover:text-primary">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="relative px-5 pb-5 pt-0">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
          <p className="text-[11px] text-muted-foreground/80 font-medium leading-tight transition-colors duration-500 group-hover:text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export { KanbanBoard } from '@widgets/kanban/KanbanBoard'
export { OperationsQueueCard } from '@widgets/running/OperationsQueueCard'
