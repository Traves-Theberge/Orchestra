import { useContext } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { WorkspaceToolsContext } from './workspace-tools-context'

export function WorkspaceToolsControls() {
  const controls = useContext(WorkspaceToolsContext)
  if (!controls) return null
  const label = controls.maximized ? 'Restore workspace tools' : 'Maximize workspace tools'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={controls.maximized}
      title={controls.maximized ? `${label} (Esc)` : label}
      onClick={controls.toggle}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
    >
      {controls.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  )
}
