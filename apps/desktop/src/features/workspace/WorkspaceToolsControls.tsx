import { useContext } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { WorkspaceToolsContext } from './workspace-tools-context'
import { AppTooltip } from '@ui/tooltip-wrapper'

export function WorkspaceToolsControls() {
  const controls = useContext(WorkspaceToolsContext)
  if (!controls) return null
  const label = controls.maximized ? 'Restore workspace tools' : 'Maximize workspace tools'
  return (
    <AppTooltip content={controls.maximized ? `${label} (Esc)` : label} side="bottom"><button
      type="button"
      aria-label={label}
      aria-pressed={controls.maximized}
      onClick={controls.toggle}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
    >
      {controls.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button></AppTooltip>
  )
}
