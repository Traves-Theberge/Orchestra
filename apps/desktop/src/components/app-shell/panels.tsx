import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Ansi from 'ansi-to-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Activity, AlertCircle, AlertTriangle, AppWindow, Bot, CheckCircle2, ChevronDown, Circle, CircleDashed, Cpu, FileText, Folder, FolderTree, GitBranch, Loader2, MoreHorizontal, ShieldCheck, SignalHigh, SignalLow, SignalMedium, Square, Terminal, User, Users, Wrench, Clock, Search, LayoutDashboard, ListTodo, History, Ticket, Database, Settings2, Sun, Moon, Download, RefreshCcw, Info, BarChart3, Zap, Layout, Rows, Play, ChevronRight, File, ExternalLink, Plus, Trash2, Keyboard, X, TrendingUp, Code, Layers } from 'lucide-react'
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
import { fetchArtifactContent, fetchArtifacts, fetchIssueDiff, fetchIssueLogs, fetchIssueHistory, updateIssue, createGitHubPR, type BackendConfig } from '@/lib/orchestra-client'
import type { SnapshotPayload, Project, ProjectStats, GlobalStats } from '@/lib/orchestra-types'
import { getSortedRetryEntries, getSortedRunningEntries } from '@/lib/view-models'
import { usePlatform } from '@/hooks/use-platform'

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
  issues: any[]
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
          ?.map(r => issues.find(i => i.id === r.issue_id)?.project_id)
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
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 transition-all shadow-lg shadow-primary/5 hover:-translate-y-0.5 active:translate-y-0"
                onClick={onCreateTask}
              >
                <Plus size={14} className="mr-1.5" strokeWidth={3} />
                New Task
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
                onClick={() => onProjectClick('')}
              >
                Explore All
              </Button>
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

export function TimelineCard({ timeline }: { timeline: TimelineItem[] }) {
  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const }
  }), [])

  const getHumanNarrative = (item: TimelineItem) => {
    const data = item.data as any
    const id = data.issue_identifier || 'System'
    const provider = (data.provider as string) || ''

    switch (item.type) {
      case 'run_started':
        return {
          title: 'Session Initiated',
          desc: `Agent ${provider} started working on ${id}`,
          color: 'text-blue-500',
          bg: 'bg-blue-500/10'
        }
      case 'run_succeeded':
        return {
          title: 'Task Resolved',
          desc: `${id} successfully completed by ${provider}`,
          color: 'text-primary',
          bg: 'bg-primary/10'
        }
      case 'run_failed':
        return {
          title: 'Execution Fault',
          desc: `${id} failed during ${provider} turn`,
          color: 'text-red-500',
          bg: 'bg-red-500/10'
        }
      case 'retry_scheduled':
        return {
          title: 'Auto-Recovery',
          desc: `Rescheduling ${id} for another attempt`,
          color: 'text-amber-500',
          bg: 'bg-amber-500/10'
        }
      case 'hook_started':
        return {
          title: 'Environment Setup',
          desc: `Provisioning workspace for ${id}`,
          color: 'text-blue-400',
          bg: 'bg-blue-400/10'
        }
      case 'hook_completed':
        return {
          title: 'Setup Verified',
          desc: `Workspace ready for agent execution`,
          color: 'text-emerald-500',
          bg: 'bg-emerald-500/10'
        }
      default:
        return {
          title: item.type.replace(/_/g, ' '),
          desc: (data.message as string) || 'System signal recorded',
          color: 'text-muted-foreground',
          bg: 'bg-muted/20'
        }
    }
  }

  return (
    <Card className="h-full border border-border/40 bg-card/40 backdrop-blur-xl shadow-2xl flex flex-col transition-all duration-500 hover:shadow-primary/5">
      <CardHeader className="pb-3 border-b border-border/20 bg-muted/5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
              <Activity size={14} className="text-primary" />
              Runtime Pulse
            </CardTitle>
            <CardDescription className="text-[10px] font-medium text-muted-foreground/60">Live operational narrative stream</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-2 bg-background border-border/50 text-[9px] font-black tabular-nums">{timeline.length}</Badge>
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
        <OverlayScrollbarsComponent
          element="div"
          options={osOptions}
          className="h-full"
        >
          <div className="p-3 space-y-2">
            {timeline.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 opacity-20 grayscale">
                <SignalLow size={48} className="mb-4" strokeWidth={1} />
                <p className="text-[10px] font-black uppercase tracking-[0.3em]">Awaiting Uplink...</p>
              </div>
            ) : (
              timeline.map((item, idx) => (
                <TimelineItemRow key={`${item.at}-${idx}`} item={item} narrative={getHumanNarrative(item)} />
              ))
            )}
          </div>
        </OverlayScrollbarsComponent>
      </CardContent>
    </Card>
  )
}

function TimelineItemRow({ item, narrative }: { item: TimelineItem; narrative: any }) {
  const [expanded, setExpanded] = useState(false)
  const data = item.data as any

  // Nuclear reset for the theme: strip all backgrounds from every sub-property
  const cleanOneDark = useMemo(() => {
    const theme: any = { ...oneDark }
    for (const key in theme) {
      if (theme[key]) {
        theme[key] = {
          ...theme[key],
          background: 'transparent',
          backgroundColor: 'transparent',
          backgroundClip: 'padding-box', // Fix for some browsers
        }
      }
    }
    return theme
  }, [])

  return (
    <div className={`group flex flex-col rounded-xl border transition-all duration-300 ${expanded ? 'border-border/60 bg-muted/30 shadow-inner' : 'border-transparent hover:border-border/40 hover:bg-muted/20'}`}>
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-3 p-2.5 w-full text-left"
      >
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/50 ${narrative.bg} shadow-sm transition-transform duration-500 ${expanded ? 'scale-110 rotate-3' : 'group-hover:scale-110 group-hover:rotate-3'}`}>
          <Activity className={`h-3.5 w-3.5 ${narrative.color}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate text-[11px] font-black uppercase tracking-wider text-foreground/90">{narrative.title}</p>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[8px] font-bold text-muted-foreground/30 tabular-nums">
                {new Date(item.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <ChevronDown size={12} className={`text-muted-foreground/40 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
          <p className="text-[11px] font-medium text-muted-foreground/70 leading-relaxed group-hover:text-foreground/80 transition-colors line-clamp-1">{narrative.desc}</p>
          
          <div className="flex items-center gap-2 pt-1">
            <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
              <Ticket size={8} />
              {data.issue_identifier || 'SYS'}
            </div>
            {data.provider && (
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
                via {data.provider}
              </div>
            )}
          </div>
        </div>
      </button>
      
      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-lg bg-black/40 p-3 border border-border/40 shadow-inner">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Raw Telemetry Payload</span>
              <Badge variant="outline" className="text-[7px] font-black opacity-40">JSON</Badge>
            </div>
            <SyntaxHighlighter
              language="json"
              style={cleanOneDark}
              customStyle={{ 
                margin: 0, 
                padding: 0, 
                background: 'transparent', 
                fontSize: '10px',
                lineHeight: '1.5',
                textShadow: 'none',
              }}
              codeTagProps={{
                style: { background: 'transparent', textShadow: 'none' }
              }}
              useInlineStyles={true}
            >
              {JSON.stringify(data, null, 2)}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
    </div>
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
  const { isMac } = usePlatform()
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
  onJumpToTerminal,
  config,
  snapshot,
  timeline = [],
  availableAgents = [],
  allTools = [],
  theme,
}: {
  result: Record<string, unknown> | null
  onUpdate?: (updates: Record<string, unknown>) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  onJumpToTerminal?: (identifier: string) => void
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  timeline?: TimelineItem[]
  availableAgents?: string[]
  allTools?: any[]
  theme?: 'light' | 'dark'
}) {
  if (!initialResult || typeof initialResult !== 'object') {
    return <div className="p-8 text-center text-muted-foreground italic">Invalid issue data provided.</div>
  }
  const result = initialResult as any

  const identifier = (result.identifier as string) || (result.issue_identifier as string) || (result.id as string) || ''
  const issueId = (result.id as string) || (result.issue_id as string) || ''
  const title = (result.title as string) || 'No Title'
  const description = (result.description as string) || ''
  const state = (result.state as string) || 'Todo'
  const assigneeId = (result.assignee_id as string) || 'Unassigned'
  const priority = (result.priority as number) || 0
  const projectId = (result.project_id as string) || ''
  const branchName = (result.branch_name as string) || ''
  const issueUrl = (result.url as string) || ''
  const labels = (result.labels as string[]) || []
  const blockedBy = (result.blocked_by as any[]) || []
  const provider = (result.provider as string) || ''
  const disabledToolsFromResult = (result.disabled_tools as string[]) || []
  const createdAt = (result.created_at as string) || ''
  const updatedAt = (result.updated_at as string) || ''

  const [localState, setLocalState] = useState(state)
  const [localAssignee, setLocalAssignee] = useState(assigneeId)
  const [localProvider, setLocalProvider] = useState<string>(provider)
  const [activeTab, setActiveTab] = useState<'overview' | 'changes' | 'logs' | 'artifacts' | 'activity'>('overview')
  const [logs, setLogs] = useState<string>('')
  const [logFilter, setLogFilter] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  
  const [issueHistory, setIssueHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  
  // Split view state
  const [isSplitView, setIsSplitView] = useState(false)
  const [secondaryProvider, setSecondaryProvider] = useState<string>('')
  const [secondaryLogs, setSecondaryLogs] = useState<string>('')
  const [secondaryLogsLoading, setSecondaryLogsLoading] = useState(false)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null)

  const parseDiff = (rawDiff: string) => {
    const files: {path: string, content: string}[] = []
    const lines = rawDiff.split('\n')
    let currentFile: string | null = null
    let currentContent: string[] = []

    lines.forEach(line => {
        if (line.startsWith('diff --git')) {
            if (currentFile) {
                files.push({ path: currentFile, content: currentContent.join('\n') })
            }
            const match = line.match(/b\/(.+)$/)
            currentFile = match ? match[1] : 'unknown'
            currentContent = [line]
        } else if (currentFile) {
            currentContent.push(line)
        }
    })

    if (currentFile) {
        files.push({ path: currentFile, content: currentContent.join('\n') })
    }

    return files
  }

  const diffFiles = useMemo(() => parseDiff(diff), [diff])

  useEffect(() => {
    if (diffFiles.length > 0 && !activeDiffFile) {
      setActiveDiffFile(diffFiles[0].path)
    }
  }, [diffFiles])
  const [artifacts, setArtifacts] = useState<string[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null)
  const [artifactContent, setArtifactContent] = useState<string | null>(null)
  const [reportContent, setReportContent] = useState<string | null>(null)
  const [contentLoading, setArtifactContentLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [prPending, setPrPending] = useState(false)
  const [prResult, setPrResult] = useState<{ url: string; number: number } | null>(null)
  const [prDialogOpen, setPrDialogOpen] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prHead, setPrHead] = useState('')
  const [disabledTools, setDisabledTools] = useState<string[]>(disabledToolsFromResult)
  const [hookOutputs, setHookOutputs] = useState<Record<string, string>>({})
  const [selectedHookLog, setSelectedHookLog] = useState<{ id: string; label: string; output: string } | null>(null)

  // Sync local state when result changes
  useEffect(() => {
    setLocalState(state)
    setLocalAssignee(assigneeId)
    setLocalProvider(provider)
    setDisabledTools(disabledToolsFromResult)
  }, [result])

  useEffect(() => {
    const relevant = timeline.filter((e) => (e.data as any)?.issue_id === result.id || (e.data as any)?.issue_identifier === identifier)
    const outputs: Record<string, string> = {}
    relevant.forEach(e => {
      if (e.type === 'hook_completed' || e.type === 'hook_failed') {
        const type = (e.data as any)?.hook_type
        const output = (e.data as any)?.output
        if (type && output) {
          outputs[type] = output
        }
      }
    })
    setHookOutputs(prev => ({ ...prev, ...outputs }))
  }, [timeline, result.id, identifier])

  // Get all providers for this issue from snapshot to support switching between parallel runs
  const activeSessions = useMemo(() => {
    if (!snapshot) return []
    return snapshot.running.filter(r => r.issue_id === issueId || r.issue_identifier === identifier)
  }, [snapshot, issueId, identifier])

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
  useEffect(() => {
    if (activeTab === 'artifacts' && identifier && config) {
      setArtifactsLoading(true)
      fetchArtifacts(config, identifier, localProvider)
        .then(setArtifacts)
        .catch(() => {
          if (artifacts.length === 0) setArtifacts([])
        })
        .finally(() => setArtifactsLoading(false))
    }
    if (activeTab === 'activity' && identifier && config) {
      setHistoryLoading(true)
      fetchIssueHistory(config, identifier)
        .then(setIssueHistory)
        .catch(() => setIssueHistory([]))
        .finally(() => setHistoryLoading(false))
    }
  }, [activeTab, identifier, config, localProvider])

  useEffect(() => {
    const reportPath = artifacts.find(p => p.toLowerCase().includes('report.md') || p.toLowerCase().includes('summary.md'))
    if (reportPath && config && identifier) {
      fetchArtifactContent(config, identifier, reportPath, localProvider)
        .then(setReportContent)
        .catch(console.error)
    } else {
      setReportContent(null)
    }
  }, [artifacts, config, identifier, localProvider])

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
    if (isSplitView && secondaryProvider && identifier && config && activeTab === 'logs') {
      setSecondaryLogsLoading(true)
      fetchIssueLogs(config, identifier, secondaryProvider)
        .then(setSecondaryLogs)
        .catch(() => setSecondaryLogs('No logs available for secondary provider.'))
        .finally(() => setSecondaryLogsLoading(false))
    } else if (!isSplitView) {
      setSecondaryLogs('')
    }
  }, [isSplitView, secondaryProvider, identifier, config, activeTab])

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs
    return logs.split('\n').filter(line => 
      line.toLowerCase().includes(logFilter.toLowerCase())
    ).join('\n')
  }, [logs, logFilter])

  const [followLogs, setFollowLogs] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (followLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [filteredLogs, followLogs])

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50
    if (!isAtBottom && followLogs) {
      setFollowLogs(false)
    }
  }

  const handleStateChange = async (newState: string) => {
    setLocalState(newState)
    if (onUpdate) {
      await onUpdate({ state: newState })
    }
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    const normalized = newAssignee === 'Unassigned' ? '' : newAssignee
    setLocalAssignee(newAssignee)
    
    // Sync provider if possible
    const agentName = normalized.replace('agent-', '')
    if (availableAgents.includes(agentName)) {
      setLocalProvider(agentName)
      if (onUpdate) {
        await onUpdate({ 
          assignee_id: normalized,
          provider: agentName
        })
      }
    } else if (onUpdate) {
      await onUpdate({ assignee_id: normalized })
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

  const handleCreatePR = () => {
    setPrTitle(title || `feat(${identifier}): solution implementation`)
    setPrBody(description || `Resolves ${identifier}\n\nThis PR was autonomously generated by Orchestra after a successful task execution.`)
    setPrHead(`task/${identifier}`)
    setPrDialogOpen(true)
  }

  const handleFinalizePR = async () => {
    if (!config || !identifier) return
    setPrPending(true)
    try {
      const res = await createGitHubPR(config, identifier, {
        title: prTitle,
        body: prBody,
        head: prHead,
        base: 'main',
      })
      setPrResult(res)
      setPrDialogOpen(false)
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

  const getEventIcon = (kind: string) => {
    const k = kind.toLowerCase()
    if (k.includes('started') || k.includes('init')) return <Play className="h-3 w-3 text-emerald-500" fill="currentColor" />
    if (k.includes('failed') || k.includes('error')) return <AlertCircle className="h-3 w-3 text-red-500" />
    if (k.includes('completed') || k.includes('success')) return <CheckCircle2 className="h-3 w-3 text-primary" />
    if (k.includes('tool')) return <Wrench className="h-3 w-3 text-amber-500" />
    if (k.includes('hook')) return <Rows className="h-3 w-3 text-blue-400" />
    return <Activity size={12} className="text-muted-foreground/40" />
  }

  const getFileIcon = (path: string, active: boolean) => {
    const ext = path.split('.').pop()?.toLowerCase()
    const color = active ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/60'
    
    switch (ext) {
      case 'md': return <FileText size={14} className={color} />
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx': return <Code size={14} className={active ? 'text-blue-400' : 'text-blue-400/40 group-hover:text-blue-400/60'} />
      case 'json': return <Database size={14} className={active ? 'text-amber-400' : 'text-amber-400/40 group-hover:text-amber-400/60'} />
      case 'sh': return <Terminal size={14} className={active ? 'text-emerald-400' : 'text-emerald-400/40 group-hover:text-emerald-400/60'} />
      case 'css': return <Layers size={14} className={active ? 'text-pink-400' : 'text-pink-400/40 group-hover:text-pink-400/60'} />
      default: return <File size={14} className={color} />
    }
  }

  const hooks = [
    { id: 'after_create', label: 'Workspace Setup', description: 'Provisioning environment and dependencies' },
    { id: 'before_run', label: 'Pre-run Hook', description: 'Preparing context for agent execution' },
    { id: 'after_run', label: 'Post-run Hook', description: 'Capturing artifacts and cleaning up' },
  ]

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-1 rounded-lg bg-muted/20 p-1 shrink-0">
        {reportContent && (
          <AppTooltip content="Executive summary and autonomous verification report">
            <button
              onClick={() => setActiveTab('artifacts')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 shadow-lg shadow-primary/5`}
            >
              <FileText size={12} strokeWidth={3} />
              REPORT
            </button>
          </AppTooltip>
        )}
        <AppTooltip content="Task metadata, agent configuration, and runtime pulse">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'overview' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Overview
          </button>
        </AppTooltip>
        <AppTooltip content="Workspace diff and file-level modifications">
          <button
            onClick={() => setActiveTab('changes')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'changes' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Changes
          </button>
        </AppTooltip>
        <AppTooltip content={localState === 'In Progress' ? 'Connect to live PTY session' : 'View historical agent execution logs'}>
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'logs' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            {localState === 'In Progress' ? 'Live Logs' : 'Logs'}
          </button>
        </AppTooltip>
        <AppTooltip content="Review generated documentation, code, and session assets">
          <button
            onClick={() => setActiveTab('artifacts')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'artifacts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Artifacts
          </button>
        </AppTooltip>
        <AppTooltip content="Full chronological audit trail of all session events">
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'activity' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Activity
          </button>
        </AppTooltip>
      </div>

      {activeTab === 'overview' ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3 pr-1">
          {activeSessions.length > 1 && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-2 shrink-0">
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-primary" />
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Active Contexts</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeSessions.map((session) => {
                  const sessionProvider = session.provider || 'default'
                  return (
                    <AppTooltip key={sessionProvider} content={`Switch view to ${sessionProvider} agent context`}>
                      <button
                        onClick={() => setLocalProvider(sessionProvider)}
                        className={`flex items-center gap-2 px-2 py-1 rounded-md border transition-all ${localProvider === sessionProvider
                          ? 'bg-primary/10 border-primary/20 text-primary'
                          : 'bg-card/20 border-border text-muted-foreground hover:bg-muted/20'
                          }`}
                      >
                        <Cpu size={10} />
                        <span className="text-[9px] font-bold uppercase tracking-tight">{sessionProvider}</span>
                      </button>
                    </AppTooltip>
                  )
                })}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-background shadow-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Header Area */}
            <div className="flex items-center justify-between gap-4 p-3 bg-muted/30 border-b border-border shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="font-mono text-[9px] h-4 uppercase bg-primary/10 text-primary border-primary/20 px-1">
                    {identifier}
                  </Badge>
                  <h3 className="truncate text-base font-black tracking-tight text-foreground">{title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <AppTooltip content="Task State">
                    <CustomDropdown
                      className="h-7 w-32 border-border bg-card text-[10px]"
                      value={localState}
                      options={AGENT_STATES.map((s) => ({ label: s, value: s }))}
                      onChange={handleStateChange}
                    />
                  </AppTooltip>
                  <AppTooltip content="Active Agent">
                    <CustomDropdown
                      className="h-7 w-48 border-border bg-card text-[10px]"
                      value={localAssignee.startsWith('agent-') ? localAssignee : (availableAgents.includes(localAssignee) ? `agent-${localAssignee}` : localAssignee)}
                      options={[
                        { label: 'Unassigned', value: 'Unassigned', icon: <Users className="h-3 w-3 text-muted-foreground" /> },
                        ...availableAgents.map((agent) => ({
                          label: `Agent: ${agent.charAt(0).toUpperCase() + agent.slice(1)}`,
                          value: `agent-${agent}`,
                          icon: <Bot className="h-3 w-3 text-primary/70" />,
                        })),
                      ]}
                      onChange={handleAssigneeChange}
                    />
                  </AppTooltip>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {localState === 'Done' && !prResult && (
                  <Button variant="outline" size="sm" className="h-7 px-2 gap-1 border-primary/30 text-primary text-[10px]" onClick={handleCreatePR} disabled={prPending}>
                    <GitBranch size={10} /> PR
                  </Button>
                )}
                {(localState === 'Todo' || localState === 'Done') && (
                  <Button variant="default" size="sm" className="h-7 px-3 gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-[10px]" onClick={() => handleStateChange('In Progress')}>
                    <Play size={10} fill="currentColor" /> RUN
                  </Button>
                )}
                {localState === 'In Progress' && onStopSession && (
                  <Button variant="outline" size="sm" className="h-7 border-red-500/30 text-red-500 text-[10px]" onClick={() => void onStopSession(localProvider)}>
                    <Square size={8} fill="currentColor" className="mr-1" /> STOP
                  </Button>
                )}
              </div>
            </div>

            {/* Main Content Grid */}
            <div className="flex-1 grid grid-cols-12 divide-x divide-border overflow-hidden">
              {/* Left Column: Context & Capabilities */}
              <div className="col-span-8 flex flex-col divide-y divide-border overflow-hidden">
                {/* Description */}
                {description && (
                  <div className="p-3 shrink-0">
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
                      <FileText size={10} /> Description
                    </div>
                    <div className="max-h-24 overflow-auto custom-scrollbar">
                      <p className="text-[11px] leading-relaxed text-muted-foreground/80">{description}</p>
                    </div>
                  </div>
                )}

                {/* Autonomous Report Summary */}
                {reportContent && (
                  <div className="p-3 bg-primary/5 border-b border-border/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-primary">
                        <FileText size={10} /> Autonomous Report
                      </div>
                      <Badge variant="outline" className="text-[7px] border-primary/20 text-primary px-1">Verified Summary</Badge>
                    </div>
                    <div className="bg-background/40 border border-primary/10 rounded-xl p-4 prose prose-invert prose-xs max-w-none overflow-hidden max-h-64 relative group">
                      <div className="text-[11px] leading-relaxed text-foreground/90 font-medium">
                        <SyntaxHighlighter
                          language="markdown"
                          style={oneDark}
                          customStyle={{ background: 'transparent', padding: 0, margin: 0, fontSize: '11px' }}
                        >
                          {reportContent.slice(0, 500) + (reportContent.length > 500 ? '...' : '')}
                        </SyntaxHighlighter>
                      </div>
                      {reportContent.length > 500 && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background/80 to-transparent flex items-end justify-center pb-2">
                           <button 
                             onClick={() => setActiveTab('artifacts')}
                             className="text-[9px] font-black uppercase tracking-widest text-primary hover:underline"
                           >
                             Read Full Report
                           </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Plan Checklist */}
                <div className="p-3 bg-primary/5 border-b border-border/10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-primary/80">
                      <ListChecks size={10} /> Operational Plan
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-auto custom-scrollbar">
                    {(() => {
                      const thoughtEvent = timeline.find(e => e.kind === 'thought' && e.message?.includes('- [ ]'))
                      if (!thoughtEvent) return <div className="text-[10px] text-muted-foreground/40 italic">Waiting for agent to formulate a plan...</div>
                      
                      const planItems = thoughtEvent.message
                        .split('\n')
                        .filter(line => line.includes('- [ ]') || line.includes('- [x]'))
                        .map(line => ({
                          text: line.replace(/-\s*\[\s*[ xX]\s*\]/, '').trim(),
                          done: line.includes('- [x]') || line.includes('- [X]')
                        }))

                      return planItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 group">
                          <div className={`mt-0.5 grid h-3 w-3 shrink-0 place-items-center rounded-sm border transition-colors ${item.done ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-card'}`}>
                            {item.done && <Check size={8} strokeWidth={4} />}
                          </div>
                          <span className={`text-[10px] font-medium leading-tight transition-colors ${item.done ? 'text-muted-foreground/60 line-through' : 'text-foreground/80'}`}>
                            {item.text}
                          </span>
                        </div>
                      ))
                    })()}
                  </div>
                </div>

                {/* Capabilities */}
                <div className="p-3 flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                      <Wrench size={10} /> Agent Capabilities
                    </div>
                    <span className="text-[8px] font-bold text-primary/60">{allTools.length - disabledTools.length} Enabled</span>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <div className="flex flex-wrap gap-1">
                      {allTools.map((tool) => {
                        const isDisabled = disabledTools.includes(tool.name)
                        return (
                          <button
                            key={tool.name}
                            onClick={() => handleToggleTool(tool.name)}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border transition-all ${isDisabled ? 'border-border text-muted-foreground/40 opacity-40' : 'border-primary/20 bg-primary/10 text-primary'}`}
                          >
                            {tool.name.includes('_') ? tool.name.split('_')[1] : tool.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Pulse */}
                <div className="p-3 bg-muted/10 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                      <Activity size={10} /> Runtime Pulse
                    </div>
                  </div>
                  <div className="space-y-1">
                    {issueHistory.slice(0, 2).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30 border border-border">
                        <div className="shrink-0 scale-75">{getEventIcon(item.kind)}</div>
                        <p className="text-[9px] font-bold text-muted-foreground/80 truncate flex-1">{item.message || item.kind}</p>
                        <span className="text-[7px] font-mono text-muted-foreground/40 tabular-nums">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Metadata & Hooks */}
              <div className="col-span-4 flex flex-col divide-y divide-border bg-muted/10 overflow-hidden">
                {/* Status Grid */}
                <div className="grid grid-cols-1 divide-y divide-border shrink-0">
                  <div className="p-2.5">
                    <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1">Status & Priority</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[11px] font-bold text-foreground/90">
                        <div className={`h-1.5 w-1.5 rounded-full ${localState === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-primary'}`} />
                        {localState}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-bold text-foreground/90">
                        <PriorityIcon priority={priority} className="h-3 w-3" />
                        <PriorityLabel priority={priority} />
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1">Source Context</div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                        <GitBranch size={10} />
                        <span className="truncate">{branchName || 'main'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                        <Clock size={10} />
                        <span>{updatedAt ? new Date(updatedAt).toLocaleDateString() : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* External Links */}
                <div className="p-2.5 shrink-0">
                  <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-2">Remote System</div>
                  {issueUrl ? (
                    <a href={issueUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-1.5 rounded bg-primary/5 border border-primary/10 text-primary hover:bg-primary/10 transition-all">
                      <ExternalLink size={10} />
                      <span className="text-[9px] font-bold truncate">Open in Tracker</span>
                    </a>
                  ) : (
                    <div className="text-[9px] text-muted-foreground/40 italic">No external link</div>
                  )}
                </div>

                {/* Execution Hooks */}
                <div className="p-2.5 flex-1 flex flex-col overflow-hidden">
                  <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-2">Execution Hooks</div>
                  <div className="space-y-1.5 overflow-auto custom-scrollbar pr-1">
                    {hooks.map((hook) => {
                      const status = getHookStatus(hook.id)
                      const output = hookOutputs[hook.id]
                      return (
                        <div key={hook.id} className={`flex flex-col gap-1 p-1.5 rounded bg-muted/30 border transition-all ${output ? 'cursor-pointer hover:bg-muted/50 border-border/60' : 'border-border opacity-60'}`}
                          onClick={() => {
                            if (output) {
                              setSelectedHookLog({ id: hook.id, label: hook.label, output })
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] font-bold text-foreground/90 truncate">{hook.label}</span>
                              {output && <Terminal size={8} className="text-primary/60 shrink-0" />}
                            </div>
                            <Badge variant="outline" className={`h-3 px-1 text-[6px] font-black uppercase ${status === 'completed' ? 'border-primary/20 text-primary' : status === 'active' ? 'border-amber-500/20 text-amber-500 animate-pulse' : status === 'failed' ? 'border-red-500/30 text-red-500' : 'text-muted-foreground/40 border-border'}`}>
                              {status}
                            </Badge>
                          </div>
                          {status === 'failed' && (
                            <p className="text-[8px] text-red-500/60 font-medium leading-none">Initialization failed</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : activeTab === 'changes' ? (
          <div className="flex flex-1 min-h-0 rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
            {/* Sidebar: Changed Files */}
            <div className="w-72 border-r border-border bg-muted/10 flex flex-col shrink-0">
              <div className="p-3 border-b border-border bg-muted/5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Changed Files</span>
                <Badge variant="outline" className="h-4 px-1.5 text-[8px] bg-white/5 text-muted-foreground border-border font-mono">
                  {diffFiles.length}
                </Badge>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar p-2 space-y-1">
                {diffLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg bg-muted/20" />)
                ) : diffFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 opacity-20 grayscale">
                    <GitBranch size={32} className="mb-2" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No Changes</p>
                  </div>
                ) : (
                  diffFiles.map((file) => (
                    <AppTooltip key={file.path} content={`View changes in ${file.path}`}>
                      <button
                        onClick={() => setActiveDiffFile(file.path)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all group ${activeDiffFile === file.path 
                          ? 'bg-primary/10 border border-primary/20 text-primary shadow-lg shadow-primary/5' 
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/10 border border-transparent'
                        }`}
                      >
                        <FileText size={14} className={activeDiffFile === file.path ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/60'} />
                        <span className="truncate text-xs font-medium leading-none pt-0.5">{file.path}</span>
                      </button>
                    </AppTooltip>
                  ))
                )}
              </div>
            </div>

            {/* Main Content: Diff Preview */}
            <div className="flex-1 min-w-0 bg-muted/5 flex flex-col relative">
              {activeDiffFile ? (
                <>
                  <div className="flex items-center justify-between border-b border-border bg-muted/5 px-4 py-2 shrink-0">
                    <div className="flex items-center gap-3">
                      <GitBranch size={14} className="text-primary/60" />
                      <span className="truncate font-mono text-[11px] text-foreground/90 font-bold">{activeDiffFile}</span>
                    </div>
                    {diffLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <SyntaxHighlighter
                      language="diff"
                      style={oneDark}
                      customStyle={{ 
                        margin: 0, 
                        padding: '1.5rem', 
                        background: 'transparent', 
                        fontSize: '12px',
                        lineHeight: '1.7'
                      }}
                      showLineNumbers={false}
                    >
                      {diffFiles.find(f => f.path === activeDiffFile)?.content || ''}
                    </SyntaxHighlighter>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-30 grayscale pointer-events-none">
                  <div className="p-6 rounded-full bg-muted/20 border border-border">
                    <GitBranch size={48} className="text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black uppercase tracking-[0.2em]">Zero Delta</p>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mt-1">No file modifications detected in this workspace</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'logs' ? (
          <div className="relative flex-1 min-h-0 rounded-lg border bg-background flex flex-col font-mono text-[11px] leading-relaxed text-foreground/90 shadow-inner overflow-hidden border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/10 px-3 py-2 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span className="font-bold text-[10px] uppercase tracking-widest text-primary/70">{localProvider || 'main'}.log</span>
                </div>
                {localState === 'In Progress' && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[9px] bg-primary/10 text-primary border-primary/20 animate-pulse">Live PTY Session</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isSplitView && localState !== 'In Progress' && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground/40" />
                    <input
                      type="text"
                      placeholder="Filter logs..."
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      className="h-6 w-48 rounded bg-muted/10 border border-border pl-7 pr-2 text-[10px] text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                  </div>
                )}
                {localState !== 'In Progress' && (
                  <AppTooltip content="Automatically scroll to the latest log output">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 gap-1.5 px-2 text-[9px] font-bold uppercase tracking-wider transition-all ${
                        followLogs ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/10'
                      }`}
                      onClick={() => setFollowLogs(!followLogs)}
                    >
                      <div className={`h-1 w-1 rounded-full ${followLogs ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`} />
                      Follow
                    </Button>
                  </AppTooltip>
                )}
                {logsLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
              </div>
            </div>
            
            <div className="flex-1 min-h-0 bg-background">
              {localState === 'In Progress' && config ? (
                <div className="w-full h-full p-2">
                   <TerminalView 
                       sessionId={`issue-${identifier}`} 
                       projectId={projectId} 
                       baseUrl={config.baseUrl} 
                       theme={theme}
                   />
                </div>
              ) : (
                <div 
                  ref={logContainerRef}
                  onScroll={handleLogScroll}
                  className="h-full overflow-auto custom-scrollbar bg-background"
                >
                  {logsLoading && !logs ? (
                    <div className="space-y-2 p-4">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-muted/20" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-muted/20" />
                      <div className="h-3 w-2/3 animate-pulse rounded bg-muted/20" />
                    </div>
                  ) : filteredLogs ? (
                    <div className="flex flex-col w-full py-2">
                      {filteredLogs.split('\n').map((line, i) => (
                        <div key={i} className="flex px-2 py-[1px] hover:bg-muted/10 group transition-colors">
                          <span className="w-10 shrink-0 text-right pr-3 text-muted-foreground/30 select-none border-r border-border mr-3 text-[10px] tabular-nums pt-[1px] group-hover:text-muted-foreground/60">
                            {i + 1}
                          </span>
                          <span className="flex-1 whitespace-pre-wrap break-words leading-[1.6]">
                            <Ansi>{line || ' '}</Ansi>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : logs ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground opacity-40">
                      <Search className="h-8 w-8 mb-3" />
                      <p className="text-xs tracking-tight uppercase font-black">No matching logs found</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                      <Terminal className="h-8 w-8 opacity-10 mb-3" />
                      <p className="text-xs tracking-tight">No logs documented for this issue session.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'artifacts' ? (
          <div className="flex flex-1 min-h-0 rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
            {/* Sidebar: File List */}
            <div className="w-72 border-r border-border bg-card/20 flex flex-col shrink-0">
              <div className="p-3 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Generated Files</span>
                <Badge variant="outline" className="h-4 px-1.5 text-[8px] bg-muted/10 text-muted-foreground/60 border-border font-mono">
                  {artifacts.length}
                </Badge>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar p-2 space-y-1">
                {artifactsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg bg-muted/30" />)
                ) : artifacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 opacity-20 grayscale">
                    <FileText size={32} className="mb-2" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No Artifacts</p>
                  </div>
                ) : (
                  artifacts.map((path) => (
                    <AppTooltip key={path} content={`View ${path}`}>
                      <button
                        onClick={() => setSelectedArtifact(path)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all group ${selectedArtifact === path 
                          ? 'bg-primary/10 border border-primary/20 text-primary shadow-lg shadow-primary/5' 
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/10 border border-transparent'
                        }`}
                      >
                        {getFileIcon(path, selectedArtifact === path)}
                        <span className="truncate text-xs font-medium leading-none pt-0.5">{path}</span>
                      </button>
                    </AppTooltip>
                  ))
                )}
              </div>
            </div>

            {/* Main Content: File Preview */}
            <div className="flex-1 min-w-0 bg-card/40 flex flex-col relative">
              {selectedArtifact ? (
                <>
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 shrink-0">
                    <div className="flex items-center gap-3">
                      <FileText size={14} className="text-primary/60" />
                      <span className="truncate font-mono text-[11px] text-foreground/90 font-bold">{selectedArtifact}</span>
                    </div>
                    {contentLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    {contentLoading && !artifactContent ? (
                      <div className="p-6 space-y-3">
                        <Skeleton className="h-3 w-3/4 bg-muted/10" />
                        <Skeleton className="h-3 w-1/2 bg-muted/10" />
                        <Skeleton className="h-3 w-2/3 bg-muted/10" />
                      </div>
                    ) : (
                      <SyntaxHighlighter
                        language={selectedArtifact.split('.').pop() || 'text'}
                        style={oneDark}
                        customStyle={{ 
                          margin: 0, 
                          padding: '1.5rem', 
                          background: 'transparent', 
                          fontSize: '12px',
                          lineHeight: '1.7'
                        }}
                        lineNumberStyle={{ minWidth: '3em', paddingRight: '1.5em', color: 'rgba(255,255,255,0.15)', textAlign: 'right', fontSize: '10px' }}
                        showLineNumbers
                      >
                        {artifactContent || ''}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-30 grayscale pointer-events-none">
                  <div className="p-6 rounded-full bg-muted/20 border border-border">
                    <FileText size={48} className="text-muted-foreground/40" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black uppercase tracking-[0.2em]">Select an Artifact</p>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mt-1">Review agent-generated documentation and code</p>
                  </div>
                </div>
              )}
            </div>
          </div>
      ) : (
        <div className="space-y-6 text-left flex-1 min-h-0 overflow-auto custom-scrollbar pr-1">
          <div className="rounded-xl border border-border bg-muted/10 p-6 min-h-full">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Full Event Audit
                </h3>
                <p className="text-xs text-muted-foreground text-left">Chronological narrative of all system interactions for this issue.</p>
              </div>
              {historyLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>

            {issueHistory.length === 0 && !historyLoading ? (
              <div className="flex flex-col items-center justify-center py-20 opacity-20 grayscale text-center">
                <Activity size={48} className="mb-4 mx-auto" />
                <p className="text-xs font-black uppercase tracking-widest">No historical events found</p>
              </div>
            ) : (
              <div className="relative space-y-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-[1px] before:bg-border/40 text-left">
                {issueHistory.map((item, idx) => (
                  <div key={`${item.id || idx}`} className="relative pl-10 group text-left">
                    <div className="absolute left-0 top-0 z-10 grid h-6 w-6 place-items-center rounded-full border border-border bg-card shadow-sm group-hover:border-primary/40 transition-colors">
                      {getEventIcon(item.kind)}
                    </div>
                    <div className="flex flex-col gap-1 bg-muted/10 p-3 rounded-xl border border-transparent group-hover:border-border group-hover:bg-muted/30 transition-all text-left">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground capitalize">{item.kind.replace(/_/g, ' ')}</span>
                          {item.provider && (
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-primary/5 text-primary/60 border-primary/10">
                              {item.provider}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[9px] font-medium text-muted-foreground/40 font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed text-left">
                        {item.message || 'System event recorded without message details.'}
                      </p>
                      {(item.input_tokens > 0 || item.output_tokens > 0) && (
                        <div className="mt-2 flex items-center gap-3">
                          <div className="flex items-center gap-1 text-[9px] font-mono text-emerald-500/60">
                            <Zap size={10} />
                            IN: {item.input_tokens}
                          </div>
                          <div className="flex items-center gap-1 text-[9px] font-mono text-primary/60">
                            <TrendingUp size={10} />
                            OUT: {item.output_tokens}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
  allTools = [],
  projects = [],
  initialProjectID = '',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialState: string
  availableAgents: string[]
  allTools?: any[]
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

// Minimalist Attribute Selectors
function ProjectSelector({ value, projects, onChange }: { value: string, projects: any[], onChange: (id: string) => void }) {
  const project = projects.find(p => p.id === value)
  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-7 !px-2 rounded-md transition-colors shadow-none"
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
  const normalizedValue = value.startsWith('agent-') ? value.replace('agent-', '') : value;
  
  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={normalizedValue || 'Unassigned'}
      direction="up"
      options={[
        { label: 'Unassigned', value: 'Unassigned', icon: <User size={12} className="opacity-40" /> },
        ...agents.map((a) => ({ label: a, value: a, icon: <Bot size={12} className="text-primary/60" /> })),
      ]}
      onChange={(v) => onChange(v === 'Unassigned' ? '' : `agent-${v}`)}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          {value !== 'Unassigned' ? <Bot size={12} className="text-primary/60" /> : <User size={12} className="opacity-40" />}
          <span className="truncate max-w-[80px]">{value || 'Assignee'}</span>
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
      className="bg-transparent border-none hover:bg-muted/20 !h-7 !px-2 rounded-md transition-colors shadow-none"
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

function KanbanItem({
  item,
  onInspectIssue,
  onJumpToTerminal,
  handleDragStart,
}: {
  item: any
  onInspectIssue: (id: string) => void
  onJumpToTerminal?: (id: string) => void
  handleDragStart: (e: any, id: string) => void
}) {
  const priority = Number(item.priority ?? 0)
  const priorityBorderClass = 
    priority === 4 ? 'hover:border-red-500/40' :
    priority === 3 ? 'hover:border-amber-500/40' :
    priority === 2 ? 'hover:border-blue-500/40' :
    'hover:border-primary/20'

  return (
    <Card
      draggable
      onDragStart={(e) => handleDragStart(e, item.issue_identifier)}
      className={`group relative cursor-grab border-transparent bg-card p-3.5 shadow-sm transition-all duration-300 ${priorityBorderClass} hover:shadow-xl hover:shadow-primary/5 active:cursor-grabbing active:scale-[0.98] rounded-xl`}
      onClick={() => void onInspectIssue(item.issue_identifier)}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[9px] h-4 bg-muted/40 border-border/50 text-muted-foreground/60 px-1">
              {item.issue_identifier}
            </Badge>
            {item.lane === 'running' && (
              <Badge className="h-3.5 px-1 bg-primary text-primary-foreground text-[7px] font-black uppercase animate-pulse">Running</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.lane === 'running' && onJumpToTerminal && (
              <AppTooltip content="Jump to Terminal">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-primary bg-primary/5 hover:bg-primary/20"
                  onClick={(e) => {
                    e.stopPropagation()
                    onJumpToTerminal(item.issue_identifier)
                  }}
                >
                  <Terminal size={10} />
                </Button>
              </AppTooltip>
            )}
            <PriorityIcon priority={priority} className="h-3.5 w-3.5 opacity-60" />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-bold tracking-tight text-foreground line-clamp-2 leading-relaxed">
            {item.title || item.issue_identifier}
          </p>
          <p className="text-[10px] text-muted-foreground/60 line-clamp-2 italic font-medium">
            {item.detail}
          </p>
        </div>
        <div className="flex items-center justify-between pt-1 mt-auto border-t border-border/5">
          <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
            <Clock size={10} />
            <span>{item.at ? new Date(item.at).toLocaleDateString() : 'New'}</span>
          </div>
          {item.assignee_id !== 'Unassigned' && (
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-4 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Bot size={8} className="text-primary/60" />
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/70">{item.assignee_id.replace('agent-', '')}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function KanbanBoard({
  loadingState,
  snapshot,
  boardIssues = [],
  projects = [],
  availableAgents = [],
  onInspectIssue,
  onJumpToTerminal,
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
  onJumpToTerminal?: (identifier: string) => void
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [issueToDelete, setIssueToDelete] = useState<{ identifier: string; title?: string } | null>(null)

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
                  column.items.map((item) => {
                    const priority = Number((item as any).priority ?? 0)
                    const priorityBorderClass = 
                      priority === 4 ? 'hover:border-red-500/40' :
                      priority === 3 ? 'hover:border-amber-500/40' :
                      priority === 2 ? 'hover:border-blue-500/40' :
                      'hover:border-primary/20'
                    
                    return (
                      <Card
                        key={item.issue_id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.issue_identifier)}
                        className={`group relative cursor-grab border-transparent bg-card p-3.5 shadow-sm transition-all duration-300 ${priorityBorderClass} hover:shadow-xl hover:shadow-primary/5 active:cursor-grabbing active:scale-[0.98] rounded-xl`}
                        onClick={() => void onInspectIssue(item.issue_identifier)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AppTooltip content={<PriorityLabel priority={priority} />}>
                              <div className={`p-1 rounded-md bg-muted/50 border border-border/50`}>
                                <PriorityIcon priority={priority} className="h-2.5 w-2.5" />
                              </div>
                            </AppTooltip>
                            <span className="font-mono text-[9px] font-black uppercase tracking-tight text-muted-foreground/60 group-hover:text-primary transition-colors">
                              {item.issue_identifier}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/30 tabular-nums">
                              {(item as any).at
                                ? new Date((item as any).at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : (item as any).due_at
                                  ? 'Retry'
                                  : ''}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                              {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                                <AppTooltip content="Launch agent session">
                                  <button
                                    type="button"
                                    className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void onIssueUpdate(item.issue_identifier, { state: 'In Progress' })
                                    }}
                                  >
                                    <Play className="h-2.5 w-2.5 fill-current" />
                                  </button>
                                </AppTooltip>
                              )}
                              {item.state === 'In Progress' && onStopSession && (
                                <AppTooltip content="Stop session">
                                  <button
                                    type="button"
                                    className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void onStopSession(item.issue_identifier)
                                    }}
                                  >
                                    <Square className="h-2 w-2 fill-current" />
                                  </button>
                                </AppTooltip>
                              )}
                              {onIssueDelete && (
                                <AppTooltip content="Permanently delete">
                                  <button
                                    type="button"
                                    className="p-1 rounded-md text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setIssueToDelete({ identifier: item.issue_identifier, title: item.title })
                                      setDeleteDialogOpen(true)
                                    }}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </AppTooltip>
                              )}
                            </div>
                          </div>
                        </div>
                        <p className="mt-2.5 line-clamp-2 text-[12px] font-bold leading-[1.4] text-foreground/90 group-hover:text-foreground transition-colors">
                          {item.title || item.description || (item as any).last_message || (item as any).error || 'No message'}
                        </p>
                        {Array.isArray((item as any).labels) && (item as any).labels.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {(item as any).labels.slice(0, 2).map((label: string) => (
                              <Badge key={label} variant="outline" className="px-1 py-0 text-[8px] font-black uppercase tracking-widest bg-muted/30 text-muted-foreground/60 border-border/40">
                                {label}
                              </Badge>
                            ))}
                            {(item as any).labels.length > 2 && <span className="text-[8px] font-black text-muted-foreground/30">+{(item as any).labels.length - 2}</span>}
                          </div>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-2.5">
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
                            <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[8px] font-black uppercase tracking-widest text-amber-500 animate-in fade-in duration-500">
                              <Activity className="h-2 w-2 animate-pulse" />
                              <span>Live</span>
                            </div>
                          ) : null}
                        </div>
                      </Card>
                    )
                  })
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
                          {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
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
                              className="p-1 rounded-md text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                setIssueToDelete({ identifier: item.issue_identifier, title: item.title })
                                setDeleteDialogOpen(true)
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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />
              Delete Task
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {issueToDelete && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-mono text-primary">{issueToDelete.identifier}</p>
                {issueToDelete.title && (
                  <p className="mt-1 text-sm text-muted-foreground">{issueToDelete.title}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setIssueToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (issueToDelete && onIssueDelete) {
                  try {
                    await onIssueDelete(issueToDelete.identifier)
                  } catch (err) {
                    console.error('Failed to delete issue:', err)
                  }
                }
                setDeleteDialogOpen(false)
                setIssueToDelete(null)
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hook Log Viewer Dialog */}
      <Dialog open={!!selectedHookLog} onOpenChange={(open) => !open && setSelectedHookLog(null)}>
        <DialogContent className="max-w-4xl bg-card border-none shadow-2xl p-0 overflow-hidden rounded-2xl">
          <div className="flex flex-col h-[70vh]">
            <div className="p-4 border-b border-border/10 bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                  <Terminal className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-bold tracking-tight">{selectedHookLog?.label} Output</DialogTitle>
                  <DialogDescription className="text-[10px] text-muted-foreground/60">Execution transcript from the workspace lifecycle hook.</DialogDescription>
                </div>
              </div>
              <Badge variant="outline" className="h-5 px-2 text-[8px] font-black uppercase tracking-widest bg-white/5 border-border">
                {selectedHookLog?.id}
              </Badge>
            </div>
            
            <div className="flex-1 overflow-auto bg-black/40 p-6 font-mono text-xs leading-relaxed selection:bg-primary/30">
              <SyntaxHighlighter
                language="bash"
                style={oneDark}
                customStyle={{ 
                  margin: 0, 
                  padding: 0, 
                  background: 'transparent', 
                  fontSize: '11px',
                  lineHeight: '1.6'
                }}
              >
                {selectedHookLog?.output || 'No output captured for this hook.'}
              </SyntaxHighlighter>
            </div>
            
            <div className="p-4 border-t border-border/10 bg-muted/20 flex items-center justify-end">
              <Button size="sm" onClick={() => setSelectedHookLog(null)} className="h-8 px-4 text-[10px] font-black uppercase tracking-widest">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function OperationsQueueCard({
  loadingState,
  snapshot,
  onInspectIssue,
  onJumpToTerminal,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
  onJumpToTerminal?: (identifier: string) => void
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

