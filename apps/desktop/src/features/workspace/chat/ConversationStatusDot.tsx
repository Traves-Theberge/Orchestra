import { CircleCheck, CircleHelp } from 'lucide-react'
import type { ConversationState } from './conversation-status'

const LABELS: Record<ConversationState, string> = {
  working: 'Working',
  'needs-input': 'Needs input',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
  idle: 'Idle',
}

/**
 * Compact conversation state glyph (after Orca's AgentStateDot): a spinning ring
 * while working (a full static ring under reduced motion), an amber question for
 * needs input, a check for an unseen finish, and dots for the rest.
 */
export function ConversationStatusDot({ state }: { state: ConversationState }) {
  const label = LABELS[state]
  let glyph
  if (state === 'working') {
    glyph = <span className="block size-2 rounded-full border-[1.5px] border-emerald-500 border-t-transparent motion-safe:animate-spin motion-reduce:border-t-emerald-500" />
  } else if (state === 'needs-input') {
    glyph = <CircleHelp aria-hidden="true" className="size-2.5 text-amber-500" />
  } else if (state === 'done') {
    glyph = <CircleCheck aria-hidden="true" className="size-2.5 text-emerald-500" />
  } else {
    glyph = <span className={`block size-1.5 rounded-full ${state === 'failed' ? 'bg-destructive' : state === 'interrupted' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
  }
  return <span role="img" aria-label={label} title={label} data-conversation-state={state} className="inline-flex size-2.5 shrink-0 items-center justify-center">{glyph}</span>
}
