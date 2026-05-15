import { AlertCircle, Github, Play, Square, Trash2 } from 'lucide-react'

import { AppTooltip } from '@ui/tooltip-wrapper'
import { AgentSelector } from '@layout/shared/controls'
import type { IssueUpdatePayload } from '@core/api/client'
import type { Project } from '@core/api/types'

import {
  type EnrichedIssue,
  getActionIssueRef,
  getBacklogMissingFields,
} from '../types'

type Props = {
  item: EnrichedIssue
  columnDot: string
  projects: Project[]
  availableAgents: string[]
  onInspectIssue: (identifier: string) => Promise<void>
  onIssueUpdate?: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (identifier: string) => Promise<void>
  onIssueDelete?: (identifier: string) => Promise<void>
  onRequestDelete: (target: { identifier: string; title?: string }) => void
  onDragStart: (e: React.DragEvent, identifier: string) => void
}

export function IssueCard({
  item,
  columnDot,
  projects,
  availableAgents,
  onInspectIssue,
  onIssueUpdate,
  onStopSession,
  onIssueDelete,
  onRequestDelete,
  onDragStart,
}: Props) {
  const ref = getActionIssueRef(item)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Inspect issue ${item.issue_identifier ?? ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, ref)}
      className={`group relative cursor-grab rounded-lg border active:cursor-grabbing transition-all overflow-hidden ${
        item.lane === 'running'
          ? 'border-emerald-500/40 bg-emerald-500/[0.03] shadow-[0_0_12px_0_rgba(16,185,129,0.12)] hover:shadow-[0_0_16px_0_rgba(16,185,129,0.2)]'
          : item.lane === 'retrying'
          ? 'border-amber-500/40 bg-amber-500/[0.03] shadow-[0_0_10px_0_rgba(245,158,11,0.1)]'
          : item.state === 'In Progress'
          ? 'border-blue-500/20 bg-blue-500/[0.02]'
          : 'border-border/30 bg-card hover:border-border/60 hover:shadow-sm'
      }`}
      onClick={() => void onInspectIssue(ref)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void onInspectIssue(ref)
        }
      }}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${
        item.lane === 'running'
          ? 'bg-emerald-500 animate-pulse'
          : item.lane === 'retrying'
          ? 'bg-amber-500 animate-pulse'
          : item.state === 'In Progress'
          ? 'bg-blue-400 opacity-40'
          : `${columnDot} opacity-60`
      }`} />

      <div className="pl-3 pr-2.5 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <span className="font-mono text-[9px] font-semibold text-muted-foreground/30 tracking-wider">
            {item.issue_identifier}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" data-no-drag="true">
            {item.url && typeof item.url === 'string' && item.url.includes('github.com') && (
              <Github size={9} className="text-muted-foreground/30" />
            )}
            {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
              <AppTooltip content="Launch agent session">
                <button type="button" data-no-drag="true" className="p-0.5 rounded hover:text-emerald-500 hover:bg-emerald-500/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); void onIssueUpdate(ref, { state: 'In Progress' }) }}>
                  <Play className="size-2.5 fill-current" />
                </button>
              </AppTooltip>
            )}
            {item.state === 'In Progress' && onStopSession && (
              <AppTooltip content="Stop session">
                <button type="button" data-no-drag="true" className="p-0.5 rounded hover:text-amber-500 hover:bg-amber-500/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); void onStopSession(ref) }}>
                  <Square className="size-2 fill-current" />
                </button>
              </AppTooltip>
            )}
            {onIssueDelete && (
              <AppTooltip content="Delete">
                <button type="button" data-no-drag="true" aria-label={`Delete task ${item.issue_identifier}`} className="p-0.5 rounded hover:text-destructive hover:bg-destructive/10 text-muted-foreground/40 transition-colors" onClick={(e) => { e.stopPropagation(); onRequestDelete({ identifier: ref, title: item.title }) }}>
                  <Trash2 className="size-2.5" />
                </button>
              </AppTooltip>
            )}
          </div>
        </div>

        <p className="line-clamp-2 text-[11.5px] font-medium leading-snug text-foreground/75 group-hover:text-foreground transition-colors mb-2.5">
          {item.title || item.description || item.last_message || item.error || 'Untitled'}
        </p>

        {item.lane === 'running' && (
          <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
            <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <p className="text-[9px] text-emerald-600 dark:text-emerald-400 truncate font-medium">{item.detail}</p>
          </div>
        )}
        {item.lane === 'retrying' && (
          <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
            <div className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <p className="text-[9px] text-amber-600 dark:text-amber-400 truncate font-medium">{item.detail}</p>
          </div>
        )}
        {item.state === 'In Progress' && !item.lane && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="size-1.5 rounded-full bg-blue-400 shrink-0" />
            <p className="text-[9px] text-blue-400/60 font-medium">Queued</p>
          </div>
        )}

        {item.state === 'Backlog' && (() => {
          const missing = getBacklogMissingFields(item)
          if (missing.length === 0) return null
          return (
            <AppTooltip content={`Needs before queuing: ${missing.join(', ')}`}>
              <div className="flex items-center gap-1 mb-2 cursor-default" data-no-drag="true">
                <AlertCircle className="size-2.5 text-amber-500/60 shrink-0" />
                <span className="text-[8.5px] text-amber-500/60 font-medium truncate">Needs {missing.join(', ')}</span>
              </div>
            </AppTooltip>
          )
        })()}

        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {projects.length > 1 && item.project_id && (
              <span className="text-[9px] text-muted-foreground/30 truncate">
                {projects.find(p => p.id === item.project_id)?.name}
              </span>
            )}
          </div>
          <div data-no-drag="true" className="shrink-0">
            <AgentSelector
              value={item.assignee_id || ''}
              agents={availableAgents}
              onChange={(value) => {
                if (onIssueUpdate) {
                  void onIssueUpdate(ref, { assignee_id: value, provider: value.replace('agent-', '') })
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
