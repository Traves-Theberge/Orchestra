import type { RefObject } from 'react'
import Ansi from 'ansi-to-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Activity, FileText, GitBranch, History, Loader2, Search, Terminal, TrendingUp, Zap } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { TerminalView } from '@/components/terminal/TerminalView'
import type { DiffFile } from './IssueDetailUtils'
import type { IssueHistoryEntry } from './types'

export function ChangesTab({
  diffLoading,
  diffFiles,
  activeDiffFile,
  setActiveDiffFile,
}: {
  diffLoading: boolean
  diffFiles: DiffFile[]
  activeDiffFile: string | null
  setActiveDiffFile: (path: string) => void
}) {
  return (
    <div className="flex flex-1 min-h-0 rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
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
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all group ${activeDiffFile === file.path ? 'bg-primary/10 border border-primary/20 text-primary shadow-lg shadow-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/10 border border-transparent'}`}
                >
                  <FileText size={14} className={activeDiffFile === file.path ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/60'} />
                  <span className="truncate text-xs font-medium leading-none pt-0.5">{file.path}</span>
                </button>
              </AppTooltip>
            ))
          )}
        </div>
      </div>

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
                customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent', fontSize: '12px', lineHeight: '1.7' }}
                showLineNumbers={false}
              >
                {diffFiles.find((f) => f.path === activeDiffFile)?.content || ''}
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
  )
}

export function LogsTab({
  localProvider,
  localState,
  logFilter,
  setLogFilter,
  followLogs,
  setFollowLogs,
  logsLoading,
  config,
  identifier,
  projectId,
  theme,
  logContainerRef,
  handleLogScroll,
  logs,
  filteredLogs,
}: {
  localProvider: string
  localState: string
  logFilter: string
  setLogFilter: (value: string) => void
  followLogs: boolean
  setFollowLogs: (value: boolean) => void
  logsLoading: boolean
  config: { baseUrl: string } | null
  identifier: string
  projectId: string
  theme?: 'light' | 'dark'
  logContainerRef: RefObject<HTMLDivElement>
  handleLogScroll: (e: React.UIEvent<HTMLDivElement>) => void
  logs: string
  filteredLogs: string
}) {
  return (
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
          {localState !== 'In Progress' && (
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
                className={`h-6 gap-1.5 px-2 text-[9px] font-bold uppercase tracking-wider transition-all ${followLogs ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/10'}`}
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
            <TerminalView sessionId={`issue-${identifier}`} projectId={projectId} baseUrl={config.baseUrl} theme={theme} />
          </div>
        ) : (
          <div ref={logContainerRef} onScroll={handleLogScroll} className="h-full overflow-auto custom-scrollbar bg-background">
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
  )
}

export function ArtifactsTab({
  artifacts,
  artifactsLoading,
  selectedArtifact,
  setSelectedArtifact,
  getFileIcon,
  contentLoading,
  artifactContent,
}: {
  artifacts: string[]
  artifactsLoading: boolean
  selectedArtifact: string | null
  setSelectedArtifact: (path: string) => void
  getFileIcon: (path: string, active: boolean) => React.ReactNode
  contentLoading: boolean
  artifactContent: string | null
}) {
  return (
    <div className="flex flex-1 min-h-0 rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
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
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all group ${selectedArtifact === path ? 'bg-primary/10 border border-primary/20 text-primary shadow-lg shadow-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/10 border border-transparent'}`}
                >
                  {getFileIcon(path, selectedArtifact === path)}
                  <span className="truncate text-xs font-medium leading-none pt-0.5">{path}</span>
                </button>
              </AppTooltip>
            ))
          )}
        </div>
      </div>

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
                  customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent', fontSize: '12px', lineHeight: '1.7' }}
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
  )
}

export function ActivityTab({
  historyLoading,
  issueHistory,
  getEventIcon,
}: {
  historyLoading: boolean
  issueHistory: IssueHistoryEntry[]
  getEventIcon: (kind: string) => React.ReactNode
}) {
  return (
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
                    <span className="text-[9px] font-medium text-muted-foreground/40 font-mono">{new Date(item.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed text-left">
                    {item.message || 'System event recorded without message details.'}
                  </p>
                  {((item.input_tokens ?? 0) > 0 || (item.output_tokens ?? 0) > 0) && (
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center gap-1 text-[9px] font-mono text-emerald-500/60">
                        <Zap size={10} />
                        IN: {item.input_tokens ?? 0}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] font-mono text-primary/60">
                        <TrendingUp size={10} />
                        OUT: {item.output_tokens ?? 0}
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
  )
}
