import { X } from 'lucide-react'
import { useAppStore } from '@core/store'

export function EditorTabs() {
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFileId = useAppStore((s) => s.activeFileId)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const closeFile = useAppStore((s) => s.closeFile)

  if (openFiles.length === 0) return null

  return (
    <div className="flex items-center border-b border-border/30 bg-background overflow-x-auto">
      {openFiles.map((file) => {
        const isActive = file.id === activeFileId
        const name = file.relativePath.split('/').pop()
        return (
          <button
            key={file.id}
            onClick={() => setActiveFile(file.id)}
            className={`group relative inline-flex items-center gap-2 px-3 h-9 whitespace-nowrap shrink-0 transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03]'
            }`}
          >
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
            )}
            {file.isDirty && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
            <span className="text-[12px] font-medium tracking-tight">{name}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  closeFile(file.id)
                }
              }}
              className="inline-flex items-center justify-center size-4 -mr-1 rounded text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-foreground/[0.06] transition-all"
            >
              <X size={11} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
