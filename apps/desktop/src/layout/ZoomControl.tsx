import { Minus, Plus } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { requestChatZoom, useChatZoom } from '@features/workspace/chat/chat-zoom'

/** Status-bar chat zoom: − 100% +. Also Ctrl+= / Ctrl+- / Ctrl+0 and pinch or Ctrl+wheel in the desktop app. */
export function ZoomControl() {
  const factor = useChatZoom()
  const button = 'inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
  return (
    <div role="group" aria-label="Chat zoom" className="ml-3 flex shrink-0 items-center gap-0.5">
      <AppTooltip content="Zoom chat out (Ctrl+-)"><button type="button" aria-label="Zoom chat out" onClick={() => requestChatZoom('out')} className={button}><Minus size={11} /></button></AppTooltip>
      <AppTooltip content="Reset chat zoom (Ctrl+0)"><button type="button" aria-label="Reset chat zoom" onClick={() => requestChatZoom('reset')} className="min-w-9 rounded px-1 text-center text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{Math.round(factor * 100)}%</button></AppTooltip>
      <AppTooltip content="Zoom chat in (Ctrl+=)"><button type="button" aria-label="Zoom chat in" onClick={() => requestChatZoom('in')} className={button}><Plus size={11} /></button></AppTooltip>
    </div>
  )
}
