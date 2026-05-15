import { ClipboardList, Play, Square, Trash2 } from 'lucide-react'

import { AppTooltip } from '@ui/tooltip-wrapper'
import { AgentSelector } from '@layout/shared/controls'
import type { IssueUpdatePayload } from '@core/api/client'

import { type EnrichedIssue, getActionIssueRef } from '../types'

type Props = {
  items: EnrichedIssue[]
  availableAgents: string[]
  onInspectIssue: (identifier: string) => Promise<void>
  onIssueUpdate?: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (identifier: string) => Promise<void>
  onIssueDelete?: (identifier: string) => Promise<void>
  onRequestDelete: (target: { identifier: string; title?: string }) => void
}

export function IssueListTable({
  items,
  availableAgents,
  onInspectIssue,
  onIssueUpdate,
  onStopSession,
  onIssueDelete,
  onRequestDelete,
}: Props) {
  return (
    <div className="flex-1 rounded-xl border bg-card/50 shadow-lg overflow-hidden min-h-0 flex flex-col mx-4">
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground/40">
          <ClipboardList className="size-12 mb-4 opacity-20" />
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
                <th className="px-4 py-3 w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map((item) => {
                const ref = getActionIssueRef(item)
                return (
                  <tr
                    key={item.issue_id}
                    className="group hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => void onInspectIssue(ref)}
                  >
                    <td className="p-4 whitespace-nowrap">
                      <span className="font-mono text-xs font-bold text-primary">{item.issue_identifier}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {item.title || item.detail || 'No Title'}
                        </span>
                        {item.lane === 'running' && (
                          <AppTooltip content="Live session">
                            <div className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          </AppTooltip>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <AgentSelector
                        value={item.assignee_id || ''}
                        agents={availableAgents}
                        onChange={(value) => {
                          if (onIssueUpdate) {
                            const agentName = value.replace('agent-', '')
                            void onIssueUpdate(ref, { assignee_id: value, provider: agentName })
                          }
                        }}
                      />
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${item.state === 'Done' ? 'bg-primary' : item.state === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                        <span className="text-xs font-medium text-muted-foreground">{item.state}</span>
                      </div>
                    </td>
                    <td className="px-2 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {item.state === 'Todo' && item.assignee_id && item.assignee_id !== 'Unassigned' && onIssueUpdate && (
                          <button
                            type="button"
                            className="p-1 rounded-md text-emerald-500/60 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all active:scale-95"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onIssueUpdate(ref, { state: 'In Progress' })
                            }}
                          >
                            <Play className="size-3.5 fill-current" />
                          </button>
                        )}
                        {item.state === 'In Progress' && onStopSession && (
                          <button
                            type="button"
                            className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-all active:scale-95"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onStopSession(ref)
                            }}
                          >
                            <Square className="size-3 fill-current" />
                          </button>
                        )}
                        {onIssueDelete && (
                          <button
                            type="button"
                            aria-label={`Delete task ${item.issue_identifier}`}
                            className="p-1 rounded-md text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 transition-all cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRequestDelete({ identifier: ref, title: item.title })
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
