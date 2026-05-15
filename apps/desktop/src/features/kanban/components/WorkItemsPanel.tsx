import { lazy, Suspense } from 'react'
import { FolderTree } from 'lucide-react'

import type { BackendConfig } from '@core/api/client'
import type { Project } from '@core/api/types'

const TrackerViewer = lazy(() => import('@features/tracker').then(m => ({ default: m.TrackerViewer })))

type Props = {
  config: BackendConfig | null
  activeProject: Project | null
}

export function WorkItemsPanel({ config, activeProject }: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      {!activeProject ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
          <FolderTree size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-foreground/60">No project selected</p>
          <p className="text-[12px] text-muted-foreground/50 max-w-xs">
            Pick a project from the dropdown above to browse its issue source.
          </p>
        </div>
      ) : !activeProject.issue_source_type ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
          <FolderTree size={32} className="text-muted-foreground/30" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-foreground/60">{activeProject.name} has no issue source</p>
          <p className="text-[12px] text-muted-foreground/50 max-w-xs">
            Open this project in Projects, click <span className="font-mono bg-muted/60 px-1 rounded">Source</span> in the toolbar, and configure a tracker connection.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground/50">Loading…</div>}>
          <TrackerViewer config={config} project={activeProject} />
        </Suspense>
      )}
    </div>
  )
}
