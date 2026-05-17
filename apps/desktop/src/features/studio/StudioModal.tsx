import { lazy, Suspense, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@ui/dialog'
import { ProjectSelector } from '@layout/shared/controls'
import { useAppStore } from '@core/store'
import type { BackendConfig } from '@core/api/client'
import type { Project } from '@core/api/types'

const StudioSection = lazy(() =>
  import('./StudioSection').then((m) => ({ default: m.StudioSection }))
)

const SectionLoader = () => (
  <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
    Starting session…
  </div>
)

export function StudioModal({
  config,
  projects,
}: {
  config: BackendConfig | null
  projects: Project[]
}) {
  const open = useAppStore((s) => s.studioModalOpen)
  const setOpen = useAppStore((s) => s.setStudioModalOpen)
  const storeProjectId = useAppStore((s) => s.selectedProjectID)

  // Local project override — lets the user switch project inside the modal
  // without touching the globally selected project.
  const [localProjectId, setLocalProjectId] = useState<string | null>(null)
  const projectId = localProjectId ?? storeProjectId ?? ''

  const handleOpenChange = (next: boolean) => {
    if (!next) setLocalProjectId(null)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="!fixed !inset-0 !translate-x-0 !translate-y-0 !left-0 !top-0 !max-w-none w-full h-full overflow-hidden flex flex-col p-0 rounded-none border-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Studio — Author a task with AI</DialogTitle>
          <DialogDescription>
            Chat with an agent to draft and push a task to the backlog.
          </DialogDescription>
        </DialogHeader>

        {/* Modal toolbar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-background">
          <span className="text-sm font-semibold">Studio</span>
          <div className="w-52">
            <ProjectSelector
              value={projectId}
              projects={projects}
              onChange={setLocalProjectId}
              direction="down"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => handleOpenChange(false)}
            aria-label="Close Studio"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {!config ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8">
              No backend configured. Connect to a backend in Settings first.
            </div>
          ) : !projectId ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8">
              Select a project above to begin.
            </div>
          ) : (
            <Suspense fallback={<SectionLoader />}>
              <StudioSection config={config} projectId={projectId} />
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
