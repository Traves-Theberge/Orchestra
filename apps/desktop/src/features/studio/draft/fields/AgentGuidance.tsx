import type { StudioDraft } from '@core/api/client'

export function AgentGuidance({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase text-muted-foreground">Agent guidance</div>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 text-muted-foreground">Model</span>
        <input
          className="flex-1 bg-transparent border border-border rounded-md px-2 py-1 outline-none focus:border-ring"
          value={draft.suggested_model}
          onChange={(e) => onChange({ suggested_model: e.target.value })}
          placeholder="e.g. opus, sonnet"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 text-muted-foreground">Max turns</span>
        <input
          type="number"
          min={1}
          className="w-24 bg-transparent border border-border rounded-md px-2 py-1 outline-none focus:border-ring"
          value={draft.max_turns ?? ''}
          onChange={(e) => onChange({ max_turns: e.target.value ? Number(e.target.value) : undefined })}
        />
      </label>
    </div>
  )
}
