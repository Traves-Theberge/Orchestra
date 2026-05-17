import { useState } from 'react'
import { Button } from '@ui/button'
import type { StudioDraft } from '@core/api/client'

export function AcceptanceCriteria({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onChange({ acceptance_criteria: [...draft.acceptance_criteria, trimmed] })
    setInput('')
  }

  const remove = (i: number) => {
    onChange({ acceptance_criteria: draft.acceptance_criteria.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase text-muted-foreground">Acceptance criteria</div>
      <ul className="flex flex-col gap-1">
        {draft.acceptance_criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            <input type="checkbox" disabled className="mt-1 accent-primary" />
            <span className="flex-1 text-sm">{c}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove criterion ${i + 1}`}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-transparent border border-border rounded-md px-2 py-1 text-sm outline-none focus:border-ring"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add criterion…"
        />
        <Button type="button" onClick={add} size="sm" variant="outline">
          Add
        </Button>
      </div>
    </div>
  )
}
