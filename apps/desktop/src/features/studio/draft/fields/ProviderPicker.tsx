import { CustomDropdown } from '@layout/shared/controls'
import type { StudioDraft } from '@core/api/client'

const PROVIDERS = ['claude-code', 'codex', 'opencode', 'gemini'] as const

const PROVIDER_OPTIONS = [
  { label: '— orchestrator chooses —', value: '' },
  ...PROVIDERS.map((p) => ({ label: p, value: p })),
]

export function ProviderPicker({
  draft,
  onChange,
}: {
  draft: StudioDraft
  onChange: (patch: Partial<StudioDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase text-muted-foreground">Execution provider</span>
      <CustomDropdown
        value={draft.suggested_provider}
        options={PROVIDER_OPTIONS}
        onChange={(val) => onChange({ suggested_provider: val })}
      />
    </div>
  )
}
