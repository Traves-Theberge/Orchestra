import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Ansi from 'ansi-to-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Activity, AlertCircle, AlertTriangle, AppWindow, Bot, CheckCircle2, ChevronDown, Circle, CircleDashed, Cpu, FileText, Folder, FolderTree, GitBranch, Loader2, MoreHorizontal, ShieldCheck, SignalHigh, SignalLow, SignalMedium, Square, Terminal, User, Users, Wrench, Clock, Search, LayoutDashboard, ListTodo, History, Ticket, Database, Settings2, Sun, Moon, Download, RefreshCcw, Info, BarChart3, Zap, Layout, Rows, Play, ChevronRight, File, ExternalLink, Plus, Trash2, Keyboard } from 'lucide-react'
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
import { fetchArtifactContent, fetchArtifacts, fetchIssueDiff, fetchIssueLogs, updateIssue, createGitHubPR, type BackendConfig } from '@/lib/orchestra-client'
import type { SnapshotPayload, Project, ProjectStats, GlobalStats } from '@/lib/orchestra-types'
import { getSortedRetryEntries, getSortedRunningEntries } from '@/lib/view-models'

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
  stats,
  warehouseStats,
  onProjectClick,
  onCreateTask,
}: {
  projects: Project[]
  stats: Record<string, ProjectStats>
  warehouseStats: GlobalStats | null
  onProjectClick: (id: string) => void
  onCreateTask?: () => void
}) {
  const sortedProjects = [...projects].sort((a, b) => {
    const sA = stats[a.id]?.total_sessions ?? 0
    const sB = stats[b.id]?.total_sessions ?? 0
    return sB - sA
  }).slice(0, 3)

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 min-h-0">
      {/* Workspace Activity (Left) */}
      <div className="lg:col-span-2 flex flex-col">
        <Card className="bg-background/40 backdrop-blur-xl border-white/5 shadow-2xl flex-1 flex flex-col min-h-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 pt-3 shrink-0">
            <div className="space-y-1">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground/90">
                <FolderTree size={16} className="text-primary/70" />
                Active Workspaces
              </CardTitle>
              <CardDescription className="text-[11px]">Recent activity across managed projects</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[10px] uppercase font-black tracking-widest bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 transition-all"
                onClick={onCreateTask}
              >
                <Plus size={14} className="mr-1.5" />
                New Task
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-[10px] uppercase font-black tracking-widest text-primary hover:bg-primary/10 transition-all"
                onClick={() => onProjectClick('')}
              >
                Explore All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <div className="space-y-1.5">
              {sortedProjects.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
                  <Folder size={32} className="mx-auto mb-3 opacity-10" />
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">No projects discovered</p>
                </div>
              ) : sortedProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onProjectClick(p.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-transparent bg-white/[0.03] p-2 transition-all hover:bg-white/[0.06] hover:border-white/10 group shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-primary/10 p-2.5 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                      <Folder size={18} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold tracking-tight group-hover:text-primary transition-colors">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono opacity-40 truncate max-w-[240px]">{p.root_path}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-6">
                    <div>
                      <p className="text-xs font-black">{stats[p.id]?.total_sessions || 0}</p>
                      <p className="text-[9px] uppercase font-bold text-muted-foreground/50">Sessions</p>
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground/20 group-hover:text-primary transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fleet Distribution (Right) */}
      <div className="flex flex-col">
        <Card className="bg-background/40 backdrop-blur-xl border-white/5 shadow-2xl flex-1 flex flex-col min-h-0 overflow-hidden relative">
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
                            <div className={`h-1.5 w-1.5 rounded-full ${name.includes('claude') ? 'bg-orange-500' : 'bg-primary'} shadow-[0_0_8px_rgba(var(--primary),0.4)]`} />
                            {name}
                          </span>
                          <span className="text-muted-foreground group-hover/bar:text-primary transition-colors">{(tokens / 1000).toFixed(1)}k</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <div
                            className={`h-full transition-all duration-1000 ease-out shadow-lg ${name.includes('claude') ? 'bg-gradient-to-r from-orange-600/50 to-orange-400/50' : 'bg-gradient-to-r from-primary/60 to-primary/30'}`}
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

export function TimelineCard({ timeline }: { timeline: TimelineItem[] }) {
  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'run_started': return <Activity className="h-3.5 w-3.5 text-blue-500" />
      case 'run_succeeded': return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      case 'run_failed': return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
      case 'retry_scheduled': return <RefreshCcw className="h-3.5 w-3.5 text-amber-500" />
      case 'hook_started': return <Wrench className="h-3.5 w-3.5 text-zinc-400" />
      case 'hook_completed': return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
      default: return <Info className="h-3.5 w-3.5 text-muted-foreground" />
    }
  }

  return (
    <Card className="h-full border bg-card shadow-lg dark:bg-card flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <History className="h-4 w-4" />
            Activity Feed
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono">{timeline.length} events</Badge>
        </div>
        <CardDescription className="text-[11px]">Real-time operational event stream</CardDescription>
      </CardHeader>
      <OverlayScrollbarsComponent
        element="div"
        options={osOptions}
        className="flex-1 min-h-0"
      >        <CardContent className="px-4 pb-4">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground/40">
              <Activity className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-xs italic uppercase tracking-wider">Awaiting telemetry...</p>
            </div>
          ) : (
            <div className="relative space-y-3 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-[1px] before:bg-border/60">
              {timeline.map((item, idx) => (
                <div key={`${item.type}-${idx}`} className="relative pl-8 group">
                  <div className="absolute left-0 top-0.5 z-10 grid h-6 w-6 place-items-center rounded-full border bg-card shadow-sm group-hover:border-primary/40 transition-colors">
                    {getEventIcon(item.type)}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-foreground capitalize">{item.type.replace(/_/g, ' ')}</span>
                      <span className="text-[9px] font-medium text-muted-foreground/60 font-mono">
                        {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    {(item.data as any).issue_identifier && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary font-bold">
                        <Ticket className="h-3 w-3" />
                        {(item.data as any).issue_identifier}
                      </div>
                    )}

                    <div className="rounded-lg border bg-muted/30 p-1.5 group-hover:bg-muted/50 transition-colors">
                      <pre className="max-h-24 overflow-auto text-[10px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {typeof (item.data as any).last_message === 'string'
                          ? (item.data as any).last_message
                          : JSON.stringify(item.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </OverlayScrollbarsComponent>
    </Card>
  )
}

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
  agentTokens,
  onMigrationFromChange,
  onMigrationToChange,
  onMigrationPlan,
  onMigrationApply,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
  onSaveAgentConfig,
  onSaveAgentToken,
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
  migrationPlan: Record<string, unknown> | null
  agentConfig: { commands: Record<string, string>; agent_provider: string } | null
  agentTokens: Record<string, string>
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
  onSaveAgentConfig: (config: { commands: Record<string, string>; agent_provider: string }) => Promise<void>
  onSaveAgentToken: (name: string, value: string | null) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'backend' | 'agents' | 'tokens' | 'migration' | 'shortcuts'>('backend')

  const tabs = [
    { id: 'backend', label: 'Backend', icon: <Database className="h-3.5 w-3.5" /> },
    { id: 'agents', label: 'Agents', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'tokens', label: 'Tokens', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { id: 'migration', label: 'Migration', icon: <RefreshCcw className="h-3.5 w-3.5" /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="h-3.5 w-3.5" /> },
  ] as const

  return (
    <Card className="border bg-card shadow-lg dark:bg-card flex flex-col h-full overflow-hidden">
      <CardHeader className="border-b border-border/40 pb-0 shrink-0">
        <CardTitle className="mb-2">System Settings</CardTitle>
        <CardDescription className="mb-4 text-xs font-medium">Configure orchestrator runtime and security parameters.</CardDescription>

        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              {tab.icon}
              {tab.label}
            </button>
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

          {activeTab === 'tokens' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Credential Vault
              </div>
              <AgentTokensForm tokens={agentTokens} onSave={onSaveAgentToken} disabled={savingConfig || loadingConfig} />
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
                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Command Palette</p>
                    <p className="text-[10px] text-muted-foreground">Search and navigate instantly across the platform.</p>
                  </div>
                  <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">⌘</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">K</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Refresh Tracker</p>
                    <p className="text-[10px] text-muted-foreground">Manually trigger a full state synchronization.</p>
                  </div>
                  <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">⌘</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">R</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Toggle Sidebar</p>
                    <p className="text-[10px] text-muted-foreground">Collapse or expand the primary navigation rail.</p>
                  </div>
                  <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">⌘</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">/</kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">Quick Switch (Dashboard)</p>
                    <p className="text-[10px] text-muted-foreground">Jump back to the operations overview.</p>
                  </div>
                  <div className="flex gap-1.5">
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">⌥</kbd>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border text-[10px] font-mono">1</kbd>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
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

const AGENT_STATES = [
  'Todo',
  'In Progress',
  'Done',
]

function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  // 0: No Priority, 1: Low, 2: Medium, 3: High, 4: Urgent
  switch (priority) {
    case 1:
      return <SignalLow className={`text-muted-foreground/60 ${className}`} />
    case 2:
      return <SignalMedium className={`text-amber-500/60 ${className}`} />
    case 3:
      return <SignalHigh className={`text-orange-500/80 ${className}`} />
    case 4:
      return <AlertCircle className={`text-red-500 ${className}`} />
    default:
      return <MoreHorizontal className={`text-muted-foreground/40 ${className}`} />
  }
}

function PriorityLabel({ priority }: { priority: number }) {
  const labels = ['No Priority', 'Low', 'Medium', 'High', 'Urgent']
  return <span>{labels[priority] || 'No Priority'}</span>
}

function CustomDropdown({
  value,
  options,
  onChange,
  className = '',
  disabled = false,
  placeholder = 'Select...',
  triggerContent,
  direction = "down",
}: {
  value: string | number
  options: { label: string; value: string | number; icon?: ReactNode }[]
  onChange: (value: any) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  triggerContent?: ReactNode
  direction?: "up" | "down"
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find((opt) => opt.value === value)

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={triggerContent ? "flex items-center w-full h-full" : `flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-all hover:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 ${isOpen ? 'border-primary ring-2 ring-primary/20' : ''
          }`}
      >
        {triggerContent || (
          <>
            <div className="flex items-center gap-2 truncate">
              {selectedOption?.icon}
              <span className="truncate">{selectedOption?.label || placeholder}</span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {isOpen && (
        <div className={`absolute left-0 z-[100] w-full min-w-[160px] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 ${direction === "up" ? "bottom-full mb-1 origin-bottom" : "top-full mt-1 origin-top"}`}>
          <div className="max-h-[300px] overflow-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${option.value === value
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted/50'
                  }`}
              >
                {option.icon}
                <span className="flex-1 truncate">{option.label}</span>
                {option.value === value && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function IssueDetailView({
  result: initialResult,
  onUpdate,
  onStopSession,
  onStartRace,
  config,
  snapshot,
  timeline = [],
  availableAgents = [],
  allTools = [],
}: {
  result: Record<string, unknown> | null
  onUpdate?: (updates: Record<string, unknown>) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  onStartRace?: (providers: string[]) => Promise<void>
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  timeline?: TimelineItem[]
  availableAgents?: string[]
  allTools?: any[]
}) {
  if (!initialResult || typeof initialResult !== 'object') {
    return <div className="p-8 text-center text-muted-foreground italic">Invalid issue data provided.</div>
  }
  const result = initialResult as any

  const [localState, setLocalState] = useState((result.state as string) || 'Todo')
  const [localAssignee, setLocalAssignee] = useState((result.assignee_id as string) || 'Unassigned')
  const [localProvider, setLocalProvider] = useState<string>(() => {
    const r = result as any
    return r.running?.provider || r.retry?.provider || ''
  })

  // Get all providers for this issue from snapshot to support switching between parallel runs
  const activeSessions = useMemo(() => {
    if (!snapshot) return []
    return snapshot.running.filter(r => r.issue_id === result.id || r.issue_identifier === identifier)
  }, [snapshot, result.id, identifier])

  useEffect(() => {
    // If we only have one active session and it's different from localProvider, auto-switch
    if (activeSessions.length === 1 && activeSessions[0].provider !== localProvider) {
      setLocalProvider(activeSessions[0].provider)
    }
  }, [activeSessions, localProvider])
  const [disabledTools, setDisabledTools] = useState<string[]>(() => {
    const r = result as any
    return r.disabled_tools || r.running?.disabled_tools || r.retry?.disabled_tools || []
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'changes' | 'logs' | 'artifacts' | 'tools'>('overview')
  const [logs, setLogs] = useState<string>('')
  const [logFilter, setLogFilter] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [artifacts, setArtifacts] = useState<string[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null)
  const [artifactContent, setArtifactContent] = useState<string | null>(null)
  const [contentLoading, setArtifactContentLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [prPending, setPrPending] = useState(false)
  const [prResult, setPrResult] = useState<{ url: string; number: number } | null>(null)
  const [raceDialogOpen, setRaceDialogOpen] = useState(false)
  const [selectedRaceProviders, setSelectedRaceProviders] = useState<string[]>([])

  const identifier = (result.identifier as string) || (result.id as string) || ''

  useEffect(() => {
    if (activeTab === 'logs' && identifier && config) {
      setLogsLoading(true)
      fetchIssueLogs(config, identifier, localProvider)
        .then(setLogs)
        .catch(() => {
          if (!logs) setLogs('No logs available yet. Start the task to see real-time output.')
        })
        .finally(() => setLogsLoading(false))
    }
    if (activeTab === 'changes' && identifier && config) {
      setDiffLoading(true)
      fetchIssueDiff(config, identifier, localProvider)
        .then(setDiff)
        .catch(() => {
          if (!diff) setDiff('No workspace changes currently detected.')
        })
        .finally(() => setDiffLoading(false))
    }
    if (activeTab === 'artifacts' && identifier && config) {
      setArtifactsLoading(true)
      fetchArtifacts(config, identifier, localProvider)
        .then(setArtifacts)
        .catch(() => {
          if (artifacts.length === 0) setArtifacts([])
        })
        .finally(() => setArtifactsLoading(false))
    }
  }, [activeTab, identifier, config, localProvider])

  useEffect(() => {
    if (selectedArtifact && identifier && config) {
      setArtifactContentLoading(true)
      fetchArtifactContent(config, identifier, selectedArtifact, localProvider)
        .then(setArtifactContent)
        .catch(() => setArtifactContent('Failed to load artifact content.'))
        .finally(() => setArtifactContentLoading(false))
    } else {
      setArtifactContent(null)
    }
  }, [selectedArtifact, identifier, config, localProvider])

  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, activeTab])

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs
    return logs.split('\n').filter(line => 
      line.toLowerCase().includes(logFilter.toLowerCase())
    ).join('\n')
  }, [logs, logFilter])

  const handleStateChange = async (newState: string) => {
    setLocalState(newState)
    if (onUpdate) {
      await onUpdate({ state: newState })
    }
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    setLocalAssignee(newAssignee)
    if (onUpdate) {
      await onUpdate({ assignee_id: newAssignee })
    }
  }

  const handleProviderChange = async (newProvider: string) => {
    setLocalProvider(newProvider)
    if (onUpdate) {
      await onUpdate({ provider: newProvider })
    }
  }

  const handleToggleTool = async (toolName: string) => {
    const next = disabledTools.includes(toolName)
      ? disabledTools.filter(t => t !== toolName)
      : [...disabledTools, toolName]

    setDisabledTools(next)
    if (onUpdate) {
      await onUpdate({ disabled_tools: next })
    }
  }

  const handleStartRace = async () => {
    if (onStartRace && selectedRaceProviders.length > 0) {
      await onStartRace(selectedRaceProviders)
      setRaceDialogOpen(false)
      setSelectedRaceProviders([])
    }
  }

  const handlePromoteWinner = async () => {
    if (!onUpdate) return
    // In a real scenario, this might trigger a git merge or specific state update.
    // For now, we'll mark this provider as the official assignee and stop other sessions.
    await onUpdate({ assignee_id: 'agent-' + localProvider, state: 'In Review' })
    if (onStopSession) {
      // Stop all sessions for this issue (calling without provider stops all)
      await onStopSession()
    }
  }

  const handleCreatePR = async () => {
    if (!config || !identifier) return
    setPrPending(true)
    try {
      const res = await createGitHubPR(config, identifier, {
        title: (result.title as string) || `PR for ${identifier}`,
        body: (result.description as string) || `Fixes ${identifier}`,
        head: `task/${identifier}`, // Assuming a branch naming convention
        base: 'main',
      })
      setPrResult(res)
    } catch (err) {
      console.error('Failed to create PR:', err)
      alert('Failed to create PR: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPrPending(false)
    }
  }

  const getHookStatus = (type: string) => {
    const relevant = timeline.filter((e) => (e.data as any)?.issue_id === result.id || (e.data as any)?.issue_identifier === identifier)
    const failed = relevant.find((e) => e.type === 'hook_failed' && (e.data as any)?.hook_type === type)
    if (failed) return 'failed'
    const completed = relevant.find((e) => e.type === 'hook_completed' && (e.data as any)?.hook_type === type)
    if (completed) return 'completed'
    const started = relevant.find((e) => e.type === 'hook_started' && (e.data as any)?.hook_type === type)
    if (started) return 'active'
    return 'pending'
  }

  const hooks = [
    { id: 'after_create', label: 'Workspace Setup', description: 'Provisioning environment and dependencies' },
    { id: 'before_run', label: 'Pre-run Hook', description: 'Preparing context for agent execution' },
    { id: 'after_run', label: 'Post-run Hook', description: 'Capturing artifacts and cleaning up' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 rounded-lg bg-muted/20 p-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'overview' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('changes')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'changes' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Changes
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'logs' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          {localState === 'In Progress' ? 'Live Logs' : 'Logs'}
        </button>
        <button
          onClick={() => setActiveTab('artifacts')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'artifacts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Artifacts
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'tools' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Tools
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'activity' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          Activity
        </button>
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-4">
          {activeSessions.length > 1 && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-blue-500" fill="currentColor" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-500/80">Active Parallel Race</span>
                </div>
                <Badge variant="outline" className="h-4 px-1.5 border-blue-500/30 text-blue-500 text-[8px] font-black">
                  {activeSessions.length} PARTICIPANTS
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeSessions.map((session) => (
                  <button
                    key={session.provider}
                    onClick={() => setLocalProvider(session.provider)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${localProvider === session.provider
                      ? 'bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                      : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'
                      }`}
                  >
                    <Cpu size={10} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">{session.provider}</span>
                    {localProvider === session.provider && <CheckCircle2 size={10} className="text-white" />}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-blue-500/60 leading-tight">
                Switch between participants to view their unique logs, artifacts, and diffs. Promote a session to finalize the race.
              </p>
            </div>
          )}
          <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
                      {identifier}
                    </Badge>
                    <span className="text-xs text-muted-foreground">in {(result.team_id as string) || 'Orchestra'}</span>
                  </div>
                  <h3 className="mt-1 truncate text-lg font-semibold text-foreground">{(result.title as string) || 'No Title'}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {localState === 'Done' && !prResult && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-2 border-primary/30 text-primary hover:bg-primary/5"
                      onClick={handleCreatePR}
                      disabled={prPending}
                    >
                      <GitBranch size={12} className={prPending ? 'animate-spin' : ''} />
                      Create PR
                    </Button>
                  )}
                  {prResult && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-2 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/5"
                      asChild
                    >
                      <a href={prResult.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} />
                        PR #{prResult.number}
                        </a>
                        </Button>
                        )}
                        {onStartRace && (
                        <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 border-blue-500/30 text-blue-500 hover:bg-blue-500/5"
                        onClick={() => setRaceDialogOpen(true)}
                        >
                        <Zap size={12} fill="currentColor" className="text-blue-500" />
                        Start Race
                        </Button>
                        )}
                        {localState === 'In Progress' && (
                        <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 border-primary/30 text-primary hover:bg-primary/5"
                        onClick={handlePromoteWinner}
                        >
                        <ShieldCheck size={12} fill="currentColor" className="text-primary" />
                        Promote to Winner
                        </Button>
                        )}
                        {(localState === 'Todo' || localState === 'Done') && (                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                      onClick={() => handleStateChange('In Progress')}
                    >
                      <Play size={12} fill="currentColor" />
                      Run Task
                    </Button>
                  )}
                  {localState === 'In Progress' && onStopSession && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-950/20"
                      onClick={() => void onStopSession(localProvider)}
                    >
                      Stop Session
                    </Button>
                  )}
                  <CustomDropdown
                    className="w-40"
                    value={localState}
                    options={AGENT_STATES.map((s) => ({ label: s, value: s }))}
                    onChange={handleStateChange}
                  />
                  <CustomDropdown
                    className="w-48"
                    value={localProvider || 'Default'}
                    options={[
                      { label: 'System Default', value: '', icon: <Settings2 className="h-3 w-3" /> },
                      ...availableAgents.map((p) => ({
                        label: p.charAt(0).toUpperCase() + p.slice(1),
                        value: p,
                        icon: <Cpu className="h-3 w-3" />,
                      })),
                    ]}
                    onChange={handleProviderChange}
                    placeholder="Select Provider..."
                  />
                  <CustomDropdown
                    className="w-56"
                    value={localAssignee}
                    options={[
                      { label: 'Unassigned', value: 'Unassigned', icon: <Users className="h-3 w-3" /> },
                      ...availableAgents.map((agent) => ({
                        label: agent,
                        value: agent,
                        icon: <Activity className="h-3 w-3" />,
                      })),
                    ]}
                    onChange={handleAssigneeChange}
                    placeholder="Assign Agent..."
                  />
                </div>            </div>

              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</p>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${localState === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-primary'}`} />
                    <span className="font-medium">{localState}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Priority</p>
                  <div className="flex items-center gap-2">
                    <PriorityIcon priority={Number(result.priority ?? 0)} className="h-4 w-4" />
                    <span className="font-medium">
                      <PriorityLabel priority={Number(result.priority ?? 0)} />
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Assigned Agent</p>
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <p className="font-medium">{availableAgents.find((a) => a === localAssignee) || localAssignee}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Blockers</p>
                  <div className="flex flex-wrap gap-1">
                    {Array.isArray(result.blocked_by) && result.blocked_by.length > 0 ? (
                      result.blocked_by.map((blocker: any) => (
                        <Badge key={blocker.identifier || blocker.id} variant="outline" className="px-1.5 py-0 text-[10px] bg-red-500/10 text-red-500 border-red-500/20">
                          {blocker.identifier || blocker.id}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4 mt-4 border-t pt-4 border-border/20">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Branch</p>
                  <div className="flex items-center gap-2">
                    <GitBranch size={12} className="text-muted-foreground" />
                    <span className="font-mono text-[10px] truncate max-w-[120px]">{(result.branch_name as string) || 'None'}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">System URL</p>
                  <div className="flex items-center gap-2">
                    <ExternalLink size={12} className="text-muted-foreground" />
                    {result.url ? (
                      <a href={result.url as string} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[150px]">
                        {result.url as string}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Updated At</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock size={12} />
                    <span>{result.updated_at ? new Date(result.updated_at as string).toLocaleString() : 'N/A'}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Provider</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Cpu size={12} />
                    <span>{localProvider || 'Default'}</span>
                  </div>
                </div>
              </div>

              {(result.description as string) ? (
                <div className="mt-4 border-t pt-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-10">{result.description as string}</p>
                </div>
              ) : null}

              <div className="mt-4 border-t pt-4">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspace Hooks</p>
                <div className="space-y-3">
                  {hooks.map((hook) => {
                    const status = getHookStatus(hook.id)
                    return (
                      <div key={hook.id} className="flex items-start gap-3">
                        <div className="mt-0.5">
                          {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          {status === 'active' && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
                          {status === 'failed' && <AlertCircle className="h-4 w-4 text-red-500" />}
                          {status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground/30" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-medium ${status === 'pending' ? 'text-muted-foreground/50' : 'text-foreground'}`}>
                            {hook.label}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground/60">{hook.description}</p>
                        </div>
                        {status !== 'pending' && (
                          <Badge
                            variant="outline"
                            className={`h-4 px-1 text-[9px] uppercase tracking-tighter ${status === 'completed'
                              ? 'border-primary/20 text-primary'
                              : status === 'active'
                                ? 'border-amber-500/20 text-amber-500'
                                : 'border-red-500/20 text-red-500'
                              }`}
                          >
                            {status}
                          </Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground hover:text-foreground">
                  View Raw JSON Payload
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Raw Issue Payload</DialogTitle>
                  <DialogDescription>Snapshot of the issue data from the tracker contract.</DialogDescription>
                </DialogHeader>
                <pre className="max-h-[500px] overflow-auto rounded-md border bg-muted p-4 text-[10px]">{JSON.stringify(result, null, 2)}</pre>
              </DialogContent>
            </Dialog>

            <Dialog open={raceDialogOpen} onOpenChange={setRaceDialogOpen}>
              <DialogContent className="max-w-md bg-card border-border shadow-2xl">
                <DialogHeader className="border-b border-border/40 pb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-lg shadow-blue-500/5">
                      <Zap className="text-blue-500 h-5 w-5" fill="currentColor" />
                    </div>
                    <div>
                      <DialogTitle className="text-xl font-bold tracking-tight">Start Parallel Race</DialogTitle>
                      <DialogDescription className="text-xs text-muted-foreground/70 font-medium">
                        Select multiple agent providers to work on this issue simultaneously.
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="py-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {availableAgents.map((agent) => {
                      const isSelected = selectedRaceProviders.includes(agent)
                      return (
                        <button
                          key={agent}
                          onClick={() => {
                            setSelectedRaceProviders(prev =>
                              prev.includes(agent)
                                ? prev.filter(a => a !== agent)
                                : [...prev, agent]
                            )
                          }}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isSelected
                            ? 'border-blue-500/40 bg-blue-500/5 shadow-inner'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                            }`}
                        >
                          <div className={`h-4 w-4 rounded-md border flex items-center justify-center transition-all ${isSelected
                            ? 'bg-blue-500 border-blue-500 shadow-lg shadow-blue-500/40'
                            : 'bg-black/20 border-white/10'
                            }`}>
                            {isSelected && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-xs font-bold capitalize text-foreground/80">
                              {agent}
                            </span>
                            <span className="text-[9px] text-muted-foreground uppercase tracking-widest opacity-40">Agent</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-500/60">
                      <AlertTriangle size={12} />
                      Operator Note
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Parallel races will consume tokens from each provider simultaneously. You can stop individual sessions at any time from the Queue.
                    </p>
                  </div>
                </div>

                <DialogFooter className="border-t border-border/40 pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setRaceDialogOpen(false)}
                    className="text-xs font-bold uppercase tracking-widest"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleStartRace}
                    disabled={selectedRaceProviders.length === 0}
                    className="px-8 bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20 text-xs font-bold uppercase tracking-widest"
                  >
                    Initiate Race ({selectedRaceProviders.length})
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : activeTab === 'changes' ? (
          <div className="relative min-h-[400px] rounded-lg border bg-[#1e1e1e] overflow-hidden shadow-inner">
            <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2 text-zinc-500">
                <GitBranch className="h-3 w-3" />
                <span className="text-[10px] font-mono uppercase tracking-wider">workspace.diff</span>
              </div>
              {diffLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </div>
            <div className="max-h-[500px] overflow-auto">
              {diffLoading && !diff ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-3 w-3/4 bg-white/5" />
                  <Skeleton className="h-3 w-1/2 bg-white/5" />
                  <Skeleton className="h-3 w-2/3 bg-white/5" />
                </div>
              ) : diff ? (
                <SyntaxHighlighter
                  language="diff"
                  style={oneDark}
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: '11px', background: 'transparent' }}
                  showLineNumbers={false}
                  wrapLines={true}
                  lineProps={lineNumber => {
                    const line = diff.split('\n')[lineNumber - 1]
                    if (line?.startsWith('+')) return { style: { display: 'block', backgroundColor: 'rgba(16, 185, 129, 0.1)' } }
                    if (line?.startsWith('-')) return { style: { display: 'block', backgroundColor: 'rgba(239, 68, 68, 0.1)' } }
                    return { style: { display: 'block' } }
                  }}
                >
                  {diff}
                </SyntaxHighlighter>              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <GitBranch className="h-8 w-8 text-white/5 mb-3" />
                  <p className="text-xs text-muted-foreground/50 tracking-wide">No workspace changes detected.</p>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'logs' ? (
          <div className="relative min-h-[400px] rounded-lg border bg-black p-4 font-mono text-[11px] leading-relaxed text-zinc-300 shadow-inner">
            <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-2 text-zinc-500">
                <Terminal className="h-3 w-3" />
                <span>agent-turn-session.log</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground/40" />
                  <input
                    type="text"
                    placeholder="Filter logs..."
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    className="h-6 w-48 rounded bg-white/5 border border-white/10 pl-7 pr-2 text-[10px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                {logsLoading && <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
              </div>
            </div>            <div className="max-h-[500px] overflow-auto whitespace-pre-wrap">
              {logsLoading && !logs ? (
                <div className="space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-800" />
                </div>
              ) : filteredLogs ? (
                <Ansi>{filteredLogs}</Ansi>
              ) : logs ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500 opacity-40">
                  <Search className="h-8 w-8 mb-3" />
                  <p className="text-xs tracking-tight uppercase font-black">No matching logs found</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500">
                  <Terminal className="h-8 w-8 opacity-10 mb-3" />
                  <p className="text-xs tracking-tight">No logs documented for this issue session.</p>
                </div>
              )}              <div ref={logsEndRef} />
            </div>
          </div>
        ) : activeTab === 'artifacts' ? (
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 rounded-lg border bg-muted/10 p-2 md:col-span-4">
              <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Files</p>
              <div className="max-h-[400px] space-y-1 overflow-auto">
                {artifactsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)
                ) : artifacts.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">No artifacts found.</p>
                ) : (
                  artifacts.map((path) => (
                    <button
                      key={path}
                      onClick={() => setSelectedArtifact(path)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${selectedArtifact === path ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'
                        }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{path}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="col-span-12 rounded-lg border bg-card p-0 md:col-span-8">
              {selectedArtifact ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{selectedArtifact}</span>
                    {contentLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  </div>
                  <div className="max-h-[500px] overflow-auto">
                    {contentLoading && !artifactContent ? (
                      <div className="space-y-2 p-4">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    ) : (
                      <SyntaxHighlighter
                        language={selectedArtifact.split('.').pop() || 'text'}
                        style={oneDark}
                        customStyle={{ margin: 0, borderRadius: 0, fontSize: '11px', background: 'transparent' }}
                        lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#4b5563', textAlign: 'right' }}
                        showLineNumbers
                      >
                        {artifactContent || ''}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-[400px] items-center justify-center p-8 text-center">
                  <div className="space-y-2">
                    <FileText className="mx-auto h-8 w-8 text-muted-foreground/20" />
                    <p className="text-xs text-muted-foreground/50">Select a file to view its contents.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'activity' ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <History size={14} />
                Issue Activity
              </h3>
              <div className="space-y-1">
                {Array.isArray(result.history) && result.history.length > 0 ? (
                  result.history.map((item: any, idx: number) => {
                    const date = new Date(item.timestamp).toLocaleString()
                    let actionText = ''
                    let icon = <Activity size={12} />

                    switch (item.action) {
                      case 'state_change':
                        actionText = `changed status from ${item.old_value} to ${item.new_value}`
                        icon = <CheckCircle2 size={12} className="text-primary" />
                        break
                      case 'priority_change':
                        actionText = `changed priority from ${item.old_value} to ${item.new_value}`
                        icon = <SignalHigh size={12} className="text-amber-500" />
                        break
                      case 'assignee_change':
                        actionText = `assigned to ${item.new_value || 'Unassigned'} (was ${item.old_value || 'Unassigned'})`
                        icon = <User size={12} className="text-blue-500" />
                        break
                      default:
                        actionText = `${item.action} changed`
                    }

                    return (
                      <div key={idx} className="flex items-start gap-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] px-3 rounded-xl transition-all">
                        <div className="mt-1 rounded-full bg-white/5 p-1.5 shadow-sm">
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-black text-foreground/90 uppercase tracking-tight">{item.user_id}</p>
                            <p className="text-[10px] text-muted-foreground/40 font-mono tracking-tighter">{date}</p>
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug">{actionText}</p>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="py-12 text-center text-muted-foreground/30 flex flex-col items-center gap-2">
                    <History size={32} className="opacity-10" />
                    <p className="text-xs italic uppercase tracking-widest">No activity recorded yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    Capability Override
                  </h3>
                  <p className="text-xs text-muted-foreground">Select which tools the agent is allowed to use for this specific session.</p>
                </div>
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[10px]">
                  {allTools.length - disabledTools.length} Active Tools
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {allTools.map((tool) => {
                  const isDisabled = disabledTools.includes(tool.name)
                  return (
                    <button
                      key={tool.name}
                      onClick={() => handleToggleTool(tool.name)}
                      className={`flex flex-col text-left p-3 rounded-xl border transition-all group ${isDisabled
                        ? 'border-white/5 bg-transparent opacity-40 grayscale hover:opacity-60'
                        : 'border-primary/20 bg-primary/5 hover:bg-primary/10 shadow-lg shadow-primary/5'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1.5 w-full">
                        <span className={`text-[11px] font-black tracking-tight ${isDisabled ? 'text-muted-foreground' : 'text-primary'}`}>
                          {tool.name.includes('_') ? tool.name.split('_')[1] : tool.name}
                        </span>
                        {isDisabled ? (
                          <div className="h-3.5 w-3.5 rounded-full border border-white/10 flex items-center justify-center">
                            <div className="h-1.5 w-1.5 rounded-full bg-white/5" />
                          </div>
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/40">
                            <CheckCircle2 className="h-2 w-2 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{tool.description || 'No documentation provided'}</p>
                      {tool.name.includes('_') && (
                        <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-white/5 border-white/10 text-muted-foreground font-mono">
                            {tool.name.split('_')[0]}
                          </Badge>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )
      }
    </div >
  )
}

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
    const desktopBridge = (window as any).orchestraDesktop
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
  projects = [],
  initialProjectID = '',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialState: string
  availableAgents: string[]
  projects?: any[]
  initialProjectID?: string
  onSubmit: (payload: {
    title: string;
    description: string;
    state: string;
    priority: number;
    assignee_id: string;
    project_id: string;
    provider?: string;
    disabled_tools?: string[];
  }) => Promise<void>
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
            <div className="flex-1 p-8 space-y-4">
              <input
                autoFocus
                className="w-full bg-transparent border-none text-2xl font-semibold placeholder:text-muted-foreground/30 focus:ring-0 p-0 selection:bg-primary/30"
                placeholder="Task Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <textarea
                className="w-full bg-transparent border-none text-base placeholder:text-muted-foreground/20 focus:ring-0 p-0 resize-none min-h-[120px] selection:bg-primary/20 leading-relaxed"
                placeholder="Add a description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
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
                  onChange={setAssignee}
                />

                <PrioritySelector
                  value={priority}
                  onChange={setPriority}
                />

                <ProviderSelector
                  value={provider}
                  providers={availableAgents}
                  onChange={setProvider}
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

// Minimalist Attribute Selectors
function ProjectSelector({ value, projects, onChange }: { value: string, projects: any[], onChange: (id: string) => void }) {
  const project = projects.find(p => p.id === value)
  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-white/5 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={value}
      direction="up"
      options={[
        { label: 'Select Project', value: '', icon: <FolderTree className="h-3 w-3 opacity-40" /> },
        ...projects.map((p) => ({ label: p.name, value: p.id, icon: <Folder className="h-3 w-3 text-primary/60" /> })),
      ]}
      onChange={onChange}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          {project ? <Folder size={12} className="text-primary/60" /> : <FolderTree size={12} className="opacity-40" />}
          <span className="truncate max-w-[80px]">{project ? project.name : 'Project'}</span>
        </div>
      }
    />
  )
}

function AgentSelector({ value, agents, onChange }: { value: string, agents: string[], onChange: (a: string) => void }) {
  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-white/5 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={value}
      direction="up"
      options={[
        { label: 'Unassigned', value: 'Unassigned', icon: <User size={12} className="opacity-40" /> },
        ...agents.map((a) => ({ label: a, value: a, icon: <Bot size={12} className="text-primary/60" /> })),
      ]}
      onChange={onChange}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          {value !== 'Unassigned' ? <Bot size={12} className="text-primary/60" /> : <User size={12} className="opacity-40" />}
          <span className="truncate max-w-[80px]">{value || 'Assignee'}</span>
        </div>
      }
    />
  )
}

function ProviderSelector({ value, providers, onChange }: { value: string, providers: string[], onChange: (p: string) => void }) {
  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-white/5 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={value}
      direction="up"
      options={providers.map((p) => ({ label: p, value: p, icon: <Cpu size={12} className="text-amber-500/60" /> }))}
      onChange={onChange}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          <Cpu size={12} className="text-amber-500/60" />
          <span className="truncate max-w-[80px]">{value || 'Provider'}</span>
        </div>
      }
    />
  )
}

function PrioritySelector({ value, onChange }: { value: number, onChange: (p: number) => void }) {
  const priorities = [
    { label: 'No Priority', value: 0, icon: <CircleDashed size={12} className="opacity-40" /> },
    { label: 'Low', value: 1, icon: <SignalLow size={12} className="text-blue-500/60" /> },
    { label: 'Medium', value: 2, icon: <SignalMedium size={12} className="text-amber-500/60" /> },
    { label: 'High', value: 3, icon: <SignalHigh size={12} className="text-red-500/60" /> },
  ]
  const current = priorities.find(p => p.value === value) || priorities[0]

  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-white/5 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={value.toString()}
      direction="up"
      options={priorities.map(p => ({ label: p.label, value: p.value.toString(), icon: p.icon }))}
      onChange={(v) => onChange(parseInt(v))}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          {current.icon}
          <span>{value > 0 ? current.label : 'Priority'}</span>
        </div>
      }
    />
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
          placeholder="http://127.0.0.1:4000"
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
  migrationPlan: Record<string, unknown> | null
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
    <Card className="group relative overflow-hidden border border-border/60 bg-gradient-to-br from-card via-card/95 to-muted/20 shadow-lg shadow-black/5 transition-all duration-500 hover:shadow-xl hover:shadow-primary/10 hover:border-primary/30 hover:-translate-y-0.5">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      
      {/* Decorative corner element */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rotate-12 rounded-2xl border border-border/30 bg-muted/30 shadow-inner transition-transform duration-500 group-hover:rotate-6 group-hover:scale-110" />
      
      <CardHeader className="relative p-5 pb-3">
        <div className="flex items-center justify-between">
          <CardDescription className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/70">
            <span className="h-1 w-1 rounded-full bg-primary/60" />
            {title}
          </CardDescription>
          <div className="rounded-lg bg-muted/50 p-1.5 text-primary/70 transition-colors duration-300 group-hover:bg-primary/10 group-hover:text-primary">
            {icon}
          </div>
        </div>
        <CardTitle className="mt-2 text-3xl font-black tracking-tight tabular-nums transition-transform duration-300 group-hover:scale-105 origin-left">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="relative px-5 pb-5 pt-0">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
          <p className="text-[11px] text-muted-foreground/80 font-medium leading-tight">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

type QueueRow = {
  issue_id: string
  issue_identifier: string
  state: string
  lane: 'running' | 'retrying'
  session_id: string
  provider: string
  detail: string
  at: string
}

function queueRowsFromSnapshot(snapshot: SnapshotPayload | null): QueueRow[] {
  if (!snapshot) {
    return []
  }

  const runningRows: QueueRow[] = getSortedRunningEntries(snapshot.running).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'running',
    session_id: row.session_id ?? 'n/a',
    provider: row.provider || 'default',
    detail: row.last_message || row.last_event || 'active runtime session',
    at: row.last_event_at || row.started_at || snapshot.generated_at,
  }))

  const retryRows: QueueRow[] = getSortedRetryEntries(snapshot.retrying).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'retrying',
    session_id: 'retry-queue',
    provider: row.provider || 'default',
    detail: row.error || `attempt ${row.attempt}`,
    at: row.due_at,
  }))

  return [...runningRows, ...retryRows].sort((a, b) => a.issue_identifier.localeCompare(b.issue_identifier, 'en', { sensitivity: 'base' }))
}

export function KanbanBoard({
  loadingState,
  snapshot,
  boardIssues = [],
  projects = [],
  availableAgents = [],
  onInspectIssue,
  onIssueUpdate,
  onIssueDelete,
  onStopSession,
  onCreateIssue,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  boardIssues?: any[]
  projects?: any[]
  availableAgents?: string[]
  onInspectIssue: (issueIdentifier: string) => Promise<void>
  onIssueUpdate?: (identifier: string, updates: Record<string, unknown>) => Promise<void>
  onIssueDelete?: (identifier: string) => Promise<void>
  onStopSession?: (identifier: string) => Promise<void>
  onCreateIssue?: (state: string) => void
}) {
  const handleCreateClick = (columnId: string) => {
    if (!onCreateIssue) return
    const stateMap: Record<string, string> = {
      todo: 'Todo',
      progress: 'In Progress',
      done: 'Done',
    }
    onCreateIssue(stateMap[columnId] || 'Todo')
  }

  const [stateFilter, setStateFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [projectFilter, setProjectFilter] = useState<string>(projects.length === 1 ? projects[0].id : 'all')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

  useEffect(() => {
    if (projects.length === 1) {
      setProjectFilter(projects[0].id)
    }
  }, [projects])
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>(['todo', 'progress', 'done'])
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, issueIdentifier: string) => {
    e.dataTransfer.setData('issueIdentifier', issueIdentifier)
    e.dataTransfer.setData('type', 'issue')
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    e.dataTransfer.setData('columnId', columnId)
    e.dataTransfer.setData('type', 'column')
    setDraggingColumnId(columnId)
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    setIsDraggingOver(columnId)
  }

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    setIsDraggingOver(null)
    setDraggingColumnId(null)

    const type = e.dataTransfer.getData('type')

    if (type === 'column') {
      const sourceColumnId = e.dataTransfer.getData('columnId')
      if (!sourceColumnId || sourceColumnId === targetColumnId) return

      const newOrder = [...columnOrder]
      const sourceIdx = newOrder.indexOf(sourceColumnId)
      const targetIdx = newOrder.indexOf(targetColumnId)
      newOrder.splice(sourceIdx, 1)
      newOrder.splice(targetIdx, 0, sourceColumnId)
      setColumnOrder(newOrder)
      return
    }

    const issueIdentifier = e.dataTransfer.getData('issueIdentifier')
    if (!issueIdentifier || !onIssueUpdate) return

    const stateMap: Record<string, string> = {
      todo: 'Todo',
      progress: 'In Progress',
      done: 'Done',
    }

    const nextState = stateMap[targetColumnId]
    if (nextState) {
      await onIssueUpdate(issueIdentifier, { state: nextState })
    }
  }

  // Merge tracker issues with runtime snapshot data
  const enrichedIssues = boardIssues.map(issue => {
    let lane = null
    let detail = issue.title || issue.description || 'No Title'
    let at = issue.created_at || ''

    if (snapshot) {
      const running = snapshot.running?.find(r => r.issue_id === issue.id)
      if (running) {
        lane = 'running'
        detail = running.last_message || running.last_event || detail
        at = running.last_event_at || running.started_at || at
      } else {
        const retrying = snapshot.retrying?.find(r => r.issue_id === issue.id)
        if (retrying) {
          lane = 'retrying'
          detail = retrying.error || `attempt ${retrying.attempt}`
          at = retrying.due_at || at
        }
      }
    }

    return {
      ...issue,
      issue_identifier: issue.identifier || issue.issue_identifier,
      lane,
      detail,
      at,
    }
  })

  const uniqueStates = Array.from(new Set(enrichedIssues.map((item) => item.state))).sort()

  const filterItem = (item: any) => {
    const stateMatch = stateFilter === 'all' || item.state === stateFilter
    const priorityMatch = priorityFilter === 'all' || String(item.priority ?? 0) === priorityFilter
    const projectMatch = projectFilter === 'all' || item.project_id === projectFilter
    return stateMatch && priorityMatch && projectMatch
  }

  const todoItems = enrichedIssues.filter(i => i.state === 'Todo').filter(filterItem)
  const inProgressItems = enrichedIssues.filter(i => i.state === 'In Progress').filter(filterItem)
  const doneItemsList = enrichedIssues.filter(i => i.state === 'Done').filter(filterItem)

  const columns = [
    { id: 'todo', title: 'To Do', items: todoItems, icon: <div className="h-2 w-2 rounded-full border-2 border-muted-foreground" /> },
    { id: 'progress', title: 'In Progress', items: inProgressItems, icon: <div className="h-2 w-2 rounded-full border-2 border-amber-500 bg-amber-500" /> },
    { id: 'done', title: 'Done', items: doneItemsList, icon: <div className="h-2 w-2 rounded-full bg-primary" /> },
  ]

  const orderedColumns = columnOrder.map((id) => columns.find((c) => c.id === id)!)

  const filteredList = enrichedIssues.filter(filterItem)

  if (loadingState && enrichedIssues.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0 space-y-6">
        <div className="flex items-center gap-3 border-b border-border/40 pb-4 shrink-0">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
          {['todo', 'progress', 'done'].map((col) => (
            <div key={col} className="flex flex-col min-h-0 space-y-4">
              <div className="flex items-center justify-between px-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <div className="flex-1 space-y-3 overflow-hidden p-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-card/40 border border-border/50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <Skeleton className="h-4 w-16 rounded" />
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                    <div className="pt-2 flex gap-2">
                      <Skeleton className="h-4 w-12 rounded-full" />
                      <Skeleton className="h-4 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">State</span>
            <CustomDropdown
              className="w-40"
              value={stateFilter}
              options={[
                { label: 'All States', value: 'all', icon: <CircleDashed className="h-3 w-3" /> },
                ...uniqueStates.map((s) => ({ label: s, value: s, icon: <div className="h-1.5 w-1.5 rounded-full bg-primary" /> })),
              ]}
              onChange={setStateFilter}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">Priority</span>
            <CustomDropdown
              className="w-40"
              value={priorityFilter}
              options={[
                { label: 'All Priorities', value: 'all', icon: <MoreHorizontal className="h-3 w-3" /> },
                { label: 'No Priority', value: '0', icon: <PriorityIcon priority={0} className="h-3 w-3" /> },
                { label: 'Low', value: '1', icon: <PriorityIcon priority={1} className="h-3 w-3" /> },
                { label: 'Medium', value: '2', icon: <PriorityIcon priority={2} className="h-3 w-3" /> },
                { label: 'High', value: '3', icon: <PriorityIcon priority={3} className="h-3 w-3" /> },
                { label: 'Urgent', value: '4', icon: <PriorityIcon priority={4} className="h-3 w-3" /> },
              ]}
              onChange={setPriorityFilter}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">Project</span>
            <CustomDropdown
              className="w-56"
              value={projectFilter}
              options={[
                { label: 'All Projects', value: 'all', icon: <FolderTree className="h-3 w-3" /> },
                ...projects.map((p) => ({ label: p.name, value: p.id, icon: <Folder className="h-3 w-3" /> })),
              ]}
              onChange={setProjectFilter}
            />
          </div>

          {stateFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all' ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setStateFilter('all')
                setPriorityFilter('all')
                setProjectFilter('all')
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
          <AppTooltip content="Board View">
            <button
              onClick={() => setViewMode('board')}
              className={`grid h-7 w-8 place-items-center rounded-md transition-all ${viewMode === 'board' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              <Layout className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip content="List View">
            <button
              onClick={() => setViewMode('list')}
              className={`grid h-7 w-8 place-items-center rounded-md transition-all ${viewMode === 'list' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              <Rows className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="flex-1 grid grid-cols-1 gap-6 lg:grid-cols-3 min-h-0">
          {orderedColumns.map((column) => (
            <div
              key={column.id}
              className={`flex flex-col gap-3 transition-opacity min-h-0 ${draggingColumnId === column.id ? 'opacity-40' : ''}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={() => setIsDraggingOver(null)}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div
                className="flex cursor-grab items-center justify-between px-1 active:cursor-grabbing shrink-0"
                draggable
                onDragStart={(e) => handleColumnDragStart(e, column.id)}
              >
                <div className="flex items-center gap-2">
                  {column.icon}
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{column.title}</h3>
                  <span className="text-[11px] font-medium text-muted-foreground/50">{column.items.length}</span>
                </div>
                <AppTooltip content={`Create Task in ${column.title}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted/50"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCreateClick(column.id)
                    }}
                  >
                    <span className="text-lg font-light">+</span>
                  </Button>
                </AppTooltip>
              </div>

              <OverlayScrollbarsComponent
                element="div"
                options={osOptions}
                className={`flex-1 flex flex-col gap-2 rounded-xl p-1.5 transition-colors min-h-0 ${isDraggingOver === column.id ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset' : 'bg-muted/10'}`}
              >
                {loadingState ? (
                  Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-28 w-full rounded-lg" />)
                ) : column.items.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <div className="mb-2 h-8 w-8 rounded-full border-2 border-dashed border-muted-foreground/20" />
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40">Empty</p>
                  </div>
                ) : (
                  column.items.map((item) => (
                    <Card
                      key={item.issue_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.issue_identifier)}
                      className="group relative cursor-grab border-transparent bg-card p-3 shadow-sm transition-all hover:border-primary/20 hover:shadow-md active:cursor-grabbing active:scale-[0.98]"
                      onClick={() => void onInspectIssue(item.issue_identifier)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <AppTooltip content={<PriorityLabel priority={Number((item as any).priority ?? 0)} />}>
                            <div>
                              <PriorityIcon priority={Number((item as any).priority ?? 0)} className="h-3 w-3" />
                            </div>
                          </AppTooltip>
                          <span className="font-mono text-[10px] font-semibold tracking-tight text-muted-foreground/80">
                            {item.issue_identifier}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[9px] font-medium text-muted-foreground/40 leading-none">
                            {(item as any).at
                              ? new Date((item as any).at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : (item as any).due_at
                                ? 'Retry'
                                : ''}
                          </span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {item.state !== 'In Progress' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                              <button
                                type="button"
                                className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all active:scale-95"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void onIssueUpdate(item.issue_identifier, { state: 'In Progress' })
                                }}
                              >
                                <Play className="h-3 w-3 fill-current" />
                              </button>
                            )}
                            {item.state === 'In Progress' && onStopSession && (
                              <button
                                type="button"
                                className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all active:scale-95"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void onStopSession(item.issue_identifier)
                                }}
                              >
                                <Square className="h-2.5 w-2.5 fill-current" />
                              </button>
                            )}
                            {onIssueDelete && (
                              <button
                                type="button"
                                className="p-1 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all active:scale-95"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void onIssueDelete(item.issue_identifier)
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight text-foreground/90">
                        {(item as any).last_message || (item as any).error || 'No message'}
                      </p>
                      {Array.isArray((item as any).labels) && (item as any).labels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(item as any).labels.slice(0, 2).map((label: string) => (
                            <Badge key={label} variant="secondary" className="px-1 py-0 text-[9px] font-normal text-muted-foreground/70">
                              {label}
                            </Badge>
                          ))}
                          {(item as any).labels.length > 2 && <span className="text-[9px] text-muted-foreground/40">+{(item as any).labels.length - 2}</span>}
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between border-t border-border/10 pt-2">
                        <AgentSelector
                          value={item.assignee_id || ''}
                          agents={availableAgents}
                          onChange={(val) => {
                            if (onIssueUpdate) {
                              void onIssueUpdate(item.issue_identifier, { assignee_id: val })
                            }
                          }}
                        />
                        {(item as any).session_id ? (
                          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-tighter text-amber-500/80">
                            <Activity className="h-2.5 w-2.5 animate-pulse" />
                            <span>Live</span>
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  ))
                )}
              </OverlayScrollbarsComponent>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 rounded-xl border bg-card/50 shadow-lg overflow-hidden min-h-0 flex flex-col">
          {filteredList.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground/40">
              <Ticket className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm italic uppercase tracking-widest font-bold">No tasks match current filters</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/80 backdrop-blur text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                    <th className="px-4 py-3 w-24">ID</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 w-32">Assignee</th>
                    <th className="px-4 py-3 w-28">Status</th>
                    <th className="px-4 py-3 w-28">Priority</th>
                    <th className="px-4 py-3 w-32 text-right">Activity</th>
                    <th className="px-4 py-3 w-20 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredList.map((item) => (
                    <tr
                      key={item.issue_id}
                      className="group hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => void onInspectIssue(item.issue_identifier)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs font-bold text-primary">{item.issue_identifier}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            {item.title || item.detail || 'No Title'}
                          </span>
                          {item.lane === 'running' && (
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-bold uppercase tracking-tighter">
                              <Activity className="h-3 w-3" />
                              Active session
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <AgentSelector
                          value={item.assignee_id || ''}
                          agents={availableAgents}
                          onChange={(val) => {
                            if (onIssueUpdate) {
                              void onIssueUpdate(item.issue_identifier, { assignee_id: val })
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-1.5 rounded-full ${item.state === 'Done' ? 'bg-primary' :
                            item.state === 'In Progress' ? 'bg-amber-500 animate-pulse' :
                              'bg-muted-foreground/40'
                            }`} />
                          <span className="text-xs font-medium text-muted-foreground">{item.state}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <PriorityIcon priority={Number(item.priority ?? 0)} className="h-3.5 w-3.5" />
                          <span className="text-xs text-muted-foreground">
                            <PriorityLabel priority={Number(item.priority ?? 0)} />
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="text-[10px] font-mono text-muted-foreground/60">
                          {item.at ? new Date(item.at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {item.state !== 'In Progress' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                            <button
                              type="button"
                              className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all active:scale-95"
                              onClick={(e) => {
                                e.stopPropagation()
                                void onIssueUpdate(item.issue_identifier, { state: 'In Progress' })
                              }}
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                            </button>
                          )}
                          {item.state === 'In Progress' && onStopSession && (
                            <button
                              type="button"
                              className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all active:scale-95"
                              onClick={(e) => {
                                e.stopPropagation()
                                void onStopSession(item.issue_identifier)
                              }}
                            >
                              <Square className="h-3 w-3 fill-current" />
                            </button>
                          )}
                          {onIssueDelete && (
                            <button
                              type="button"
                              className="p-1 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation()
                                void onIssueDelete(item.issue_identifier)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function OperationsQueueCard({
  loadingState,
  snapshot,
  onInspectIssue,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
}) {
  const [laneFilter, setLaneFilter] = useState<'all' | 'running' | 'retrying'>('all')
  const [stateFilter, setStateFilter] = useState<string>('all')

  const allRows = queueRowsFromSnapshot(snapshot)
  const uniqueStates = Array.from(new Set(allRows.map((row) => row.state))).sort()

  const rows = allRows.filter((row) => {
    const laneMatch = laneFilter === 'all' || row.lane === laneFilter
    const stateMatch = stateFilter === 'all' || row.state === stateFilter
    return laneMatch && stateMatch
  })

  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

  return (
    <Card className="border bg-card shadow-lg dark:bg-card flex flex-col h-full overflow-hidden">
      <CardHeader className="pb-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <AppWindow className="h-5 w-5 text-primary" />
              Operations Queue
            </CardTitle>
            <CardDescription className="text-xs">Live orchestrator surface for active and retrying issue sessions.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Lane</span>
              <CustomDropdown
                className="w-36 h-8"
                value={laneFilter}
                options={[
                  { label: 'All Lanes', value: 'all', icon: <Circle className="h-2 w-2" /> },
                  { label: 'Running', value: 'running', icon: <Activity className="h-2 w-2 text-primary" /> },
                  { label: 'Retrying', value: 'retrying', icon: <RefreshCcw className="h-2 w-2 text-amber-500" /> },
                ]}
                onChange={(value) => setLaneFilter(value as any)}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2 py-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Status</span>
              <CustomDropdown
                className="w-44 h-8"
                value={stateFilter}
                options={[
                  { label: 'All States', value: 'all', icon: <CircleDashed className="h-2 w-2" /> },
                  ...uniqueStates.map((state) => ({ label: state, value: state })),
                ]}
                onChange={setStateFilter}
              />
            </div>
            {(laneFilter !== 'all' || stateFilter !== 'all') && (
              <IconButton
                icon={<RefreshCcw className="h-4 w-4" />}
                title="Clear Filters"
                onClick={() => { setLaneFilter('all'); setStateFilter('all') }}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pb-4">
        <OverlayScrollbarsComponent
          element="div"
          options={osOptions}
          className="rounded-xl border border-border/40 bg-muted/5 shadow-inner h-full custom-scrollbar"
        >
          <Table className="relative">
            <TableHeader className="bg-muted/30 sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Issue</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Provider</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Lane</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">State</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3 text-center">Session</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3">Detail</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider py-3 text-right">Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingState
                ? Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-10 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                ))
                : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground italic text-xs uppercase tracking-widest opacity-40">
                      No active sessions in queue
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={`${row.lane}-${row.issue_id}-${row.provider}`} className="group transition-colors hover:bg-muted/30">
                    <TableCell className="font-bold font-mono text-xs">
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-left text-primary hover:bg-primary/10 transition-colors border border-transparent hover:border-primary/20"
                        onClick={() => void onInspectIssue(row.issue_identifier)}
                      >
                        {row.issue_identifier}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Cpu className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-[10px] font-bold capitalize text-foreground/70">{row.provider}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.lane === 'running' ? 'default' : 'outline'} className={`text-[9px] uppercase tracking-tighter h-5 px-1.5 ${row.lane === 'running' ? '' : 'text-amber-600 border-amber-500/20'}`}>
                        {row.lane}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground/80">{row.state}</TableCell>
                    <TableCell className="text-center">
                      {row.session_id !== 'retry-queue' ? (
                        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground font-mono">
                          {row.session_id.slice(0, 8)}
                        </code>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:z-50 relative">
                      <AppTooltip content={row.detail}>
                        <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                          {row.detail}
                        </span>
                      </AppTooltip>
                    </TableCell>
                    <TableCell className="text-right text-[10px] text-muted-foreground/60 font-medium whitespace-nowrap">
                      {new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </OverlayScrollbarsComponent>
      </CardContent>
    </Card>
  )
}

function AgentTokensForm({
  tokens,
  onSave,
  disabled,
}: {
  tokens: Record<string, string>
  onSave: (name: string, value: string | null) => Promise<void>
  disabled: boolean
}) {
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenValue, setNewTokenValue] = useState('')

  const handleAdd = async () => {
    if (!newTokenName.trim() || !newTokenValue.trim()) return
    await onSave(newTokenName.trim(), newTokenValue.trim())
    setNewTokenName('')
    setNewTokenValue('')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {Object.keys(tokens).length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">No secure tokens stored.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {Object.keys(tokens).map((name) => (
              <div key={name} className="flex items-center justify-between rounded border bg-background px-3 py-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">{name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{tokens[name]}</span>
                </div>
                <button
                  onClick={() => void onSave(name, null)}
                  className="text-[10px] text-red-500 hover:text-red-600 font-medium"
                  disabled={disabled}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border/40 pt-3">
        <p className="text-[10px] font-bold uppercase text-muted-foreground/60">Add New Token</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Token Name (e.g. ANTHROPIC_API_KEY)"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            disabled={disabled}
          />
          <input
            type="password"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Token Value"
            value={newTokenValue}
            onChange={(e) => setNewTokenValue(e.target.value)}
            disabled={disabled}
          />
        </div>
        <Button size="sm" onClick={() => void handleAdd()} disabled={disabled || !newTokenName || !newTokenValue}>
          Store Encrypted Token
        </Button>
      </div>
    </div>
  )
}

