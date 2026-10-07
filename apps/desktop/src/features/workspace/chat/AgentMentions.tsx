import { AtSign } from 'lucide-react'
import { Command, CommandItem, CommandList } from '@ui/command'
import type { OrchestraAgent } from '@core/api/client'
import { agentColor } from '@features/agents/lib/agent-display'

/** `@` subagent suggestions above the composer; keyboard handling stays in the textarea. */
export function AgentMentionMenu({ candidates, active, onActiveChange, onPick }: {
  candidates: OrchestraAgent[]; active: number; onActiveChange: (index: number) => void; onPick: (agent: OrchestraAgent) => void
}) {
  if (!candidates.length) return null
  const value = candidates[Math.min(active, candidates.length - 1)]?.name ?? ''
  return <div className="absolute bottom-full left-3 z-30 mb-2 w-72 max-w-[calc(100%-24px)] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
    <Command label="Subagents" shouldFilter={false} value={value} onValueChange={next => onActiveChange(Math.max(0, candidates.findIndex(agent => agent.name === next)))}>
      <p className="flex items-center gap-1.5 px-3 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"><AtSign className="size-3" />Subagents</p>
      <CommandList label="Subagent suggestions">
        {candidates.map(agent => <CommandItem key={agent.id} value={agent.name} onMouseDown={event => event.preventDefault()} onSelect={() => onPick(agent)}>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor(agent.color, agent.id) }} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">@{agent.name}</span>{agent.description && <span className="block truncate text-[10px] text-muted-foreground">{agent.description}</span>}</span>
        </CommandItem>)}
      </CommandList>
    </Command>
  </div>
}
