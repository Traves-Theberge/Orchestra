import { useEffect, useState } from 'react'
import type { IssueUpdatePayload, BackendConfig, RuntimeEntry } from '@core/api/client'
import { fetchAvailableRuntimes } from '@core/api/client'
import type { SessionDetail, SnapshotPayload } from '@core/api/types'
import type { TimelineItem } from '@layout/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@ui/dialog'
import { Skeleton } from '@ui/skeleton'
import { IssueDetailView, CreateTaskDialog, CreateProjectDialog } from '@layout/panels'
import { SessionDetailView } from '@features/usage/SessionDetailView'
import { useAppStore } from '@core/store'
import type { IssueDetailResult } from '@features/issue-detail/types'

interface AppDialogsProps {
  config: BackendConfig | null
  timeline: TimelineItem[]
  availableAgents: string[]
  snapshot: SnapshotPayload | null
  theme: 'light' | 'dark'
  issueLookupId: string
  issueLookupPending: boolean
  issueLookupError: string
  issueLookupResult: IssueDetailResult | null
  sessionLookupPending: boolean
  sessionLookupError: string
  sessionLookupResult: SessionDetail | null
  onIssueUpdate: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  onStopSession: (identifier: string, provider?: string) => Promise<void>
  onTaskSubmit: (payload: import('@core/api/client').IssueCreatePayload) => Promise<void>
  onAddProject: (path: string) => Promise<void>
}

export function AppDialogs({
  config,
  timeline,
  availableAgents,
  snapshot,
  theme,
  issueLookupId,
  issueLookupPending,
  issueLookupError,
  issueLookupResult,
  sessionLookupPending,
  sessionLookupError,
  sessionLookupResult,
  onIssueUpdate,
  onStopSession,
  onTaskSubmit,
  onAddProject,
}: AppDialogsProps) {
  const inspectDialogOpen = useAppStore(s => s.inspectDialogOpen)
  const setInspectDialogOpen = useAppStore(s => s.setInspectDialogOpen)
  const sessionInspectDialogOpen = useAppStore(s => s.sessionInspectDialogOpen)
  const setSessionInspectDialogOpen = useAppStore(s => s.setSessionInspectDialogOpen)
  const createTaskDialogOpen = useAppStore(s => s.createTaskDialogOpen)
  const createProjectDialogOpen = useAppStore(s => s.createProjectDialogOpen)
  const setCreateProjectDialogOpen = useAppStore(s => s.setCreateProjectDialogOpen)
  const projects = useAppStore(s => s.projects)
  const allTools = useAppStore(s => s.allTools)
  const selectedProjectID = useAppStore(s => s.selectedProjectID)
  const createTaskInitialState = useAppStore(s => s.createTaskInitialState)
  const createTaskInitialStateStr = createTaskInitialState?.state ?? 'Backlog'
  const [availableRuntimes, setAvailableRuntimes] = useState<RuntimeEntry[]>([])

  useEffect(() => {
    if (!config) return
    fetchAvailableRuntimes(config).then(setAvailableRuntimes).catch(() => {})
  }, [config])

  const errClass = 'rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200'
  const skeletonFallback = (
    <div className="space-y-4">
      <Skeleton className="h-8 w-[200px]" />
      <Skeleton className="h-[200px] w-full" />
    </div>
  )

  return (
    <>
      <Dialog open={inspectDialogOpen} onOpenChange={setInspectDialogOpen}>
        <DialogContent className="!fixed !inset-0 !translate-x-0 !translate-y-0 !left-0 !top-0 !max-w-none w-full h-full overflow-hidden flex flex-col p-6 rounded-none border-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Issue Inspector</DialogTitle>
            <DialogDescription>Task details</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {issueLookupPending ? skeletonFallback
              : issueLookupError ? <div className={errClass}>{issueLookupError}</div>
              : (issueLookupResult && typeof issueLookupResult === 'object') ? (
                <IssueDetailView
                  result={{
                    ...issueLookupResult,
                    project_name: projects.find(p => p.id === (issueLookupResult as Record<string, unknown>).project_id)?.name || '',
                  }}
                  config={config}
                  timeline={timeline}
                  availableAgents={availableAgents}
                  snapshot={snapshot}
                  onUpdate={(updates) => onIssueUpdate(issueLookupId, updates)}
                  onStopSession={(p) => onStopSession(issueLookupId, p)}
                  theme={theme}
                />
              ) : <p className="text-center text-sm text-muted-foreground py-10">No issue data available.</p>}
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
            {sessionLookupPending ? skeletonFallback
              : sessionLookupError ? <div className={errClass}>{sessionLookupError}</div>
              : sessionLookupResult ? <SessionDetailView session={sessionLookupResult} />
              : <p className="text-center text-sm text-muted-foreground">No session selected.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <CreateTaskDialog
        open={createTaskDialogOpen}
        onOpenChange={(open) => { if (!open) useAppStore.getState().closeCreateTaskDialog() }}
        config={config}
        initialState={createTaskInitialStateStr}
        availableAgents={availableAgents}
        allTools={allTools}
        projects={projects}
        initialProjectID={selectedProjectID || ''}
        availableRuntimes={availableRuntimes}
        onSubmit={onTaskSubmit}
      />

      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={setCreateProjectDialogOpen}
        onSubmit={onAddProject}
      />
    </>
  )
}
