import { useId } from 'react'
import { CustomDropdown } from '@layout/shared/controls'
import { InheritedField } from '@features/agents/components/InheritedField'

const MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-opus-4-6[1m]', label: 'Claude Opus 4.6 (1M context)' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
]

const toggleTrackClasses = (on: boolean) =>
  `relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border/30 transition-colors ${on ? 'bg-primary' : 'bg-muted/20'}`
const toggleThumbClasses = (on: boolean) =>
  `pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`

interface ModelBehaviorSectionProps {
  local: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
  fieldInherited: (key: string) => boolean
  inheritedValueString: (key: string) => string
  setFromGlobal: (key: string) => void
}

export function ModelBehaviorSection({
  local,
  updateField,
  fieldInherited,
  inheritedValueString,
  setFromGlobal,
}: ModelBehaviorSectionProps) {
  const modelLabelId = useId()
  const permissionModeLabelId = useId()
  const alwaysThinkingLabelId = useId()
  const voiceEnabledLabelId = useId()

  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Model & Behavior</h4>

      <div className="space-y-1.5">
        <span id={modelLabelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Model</span>
        <InheritedField
          inherited={fieldInherited('model')}
          inheritedValue={inheritedValueString('model')}
          onSetHere={() => setFromGlobal('model')}
        >
          <div aria-labelledby={modelLabelId}>
            <CustomDropdown
              className="w-full"
              value={(local.model as string) ?? ''}
              options={[{ label: 'Default', value: '' }, ...MODEL_OPTIONS]}
              onChange={(val) => updateField('model', val || undefined)}
              placeholder="Select model"
            />
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={permissionModeLabelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Permission Mode</span>
        <InheritedField
          inherited={fieldInherited('permissionMode')}
          inheritedValue={inheritedValueString('permissionMode')}
          onSetHere={() => setFromGlobal('permissionMode')}
        >
          <div aria-labelledby={permissionModeLabelId}>
            <CustomDropdown
              className="w-full"
              value={(local.permissionMode as string) ?? 'default'}
              options={PERMISSION_MODE_OPTIONS}
              onChange={(val) => updateField('permissionMode', val === 'default' ? undefined : val)}
              placeholder="Permission mode"
            />
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={alwaysThinkingLabelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Always Thinking</span>
        <InheritedField
          inherited={fieldInherited('alwaysThinkingEnabled')}
          inheritedValue={inheritedValueString('alwaysThinkingEnabled')}
          onSetHere={() => setFromGlobal('alwaysThinkingEnabled')}
        >
          <div className="flex items-center h-9 px-3 rounded-md border border-border/40 bg-background">
            <button
              type="button"
              aria-labelledby={alwaysThinkingLabelId}
              onClick={() => updateField('alwaysThinkingEnabled', !local.alwaysThinkingEnabled)}
              className={toggleTrackClasses(!!local.alwaysThinkingEnabled)}
            >
              <span className={toggleThumbClasses(!!local.alwaysThinkingEnabled)} />
            </button>
            <span className="ml-3 text-[11px] text-foreground/70">
              {local.alwaysThinkingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={voiceEnabledLabelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Voice Input</span>
        <InheritedField
          inherited={fieldInherited('voiceEnabled')}
          inheritedValue={inheritedValueString('voiceEnabled')}
          onSetHere={() => setFromGlobal('voiceEnabled')}
        >
          <div className="flex items-center h-9 px-3 rounded-md border border-border/40 bg-background">
            <button
              type="button"
              aria-labelledby={voiceEnabledLabelId}
              onClick={() => updateField('voiceEnabled', !local.voiceEnabled)}
              className={toggleTrackClasses(!!local.voiceEnabled)}
            >
              <span className={toggleThumbClasses(!!local.voiceEnabled)} />
            </button>
            <span className="ml-3 text-[11px] text-foreground/70">
              {local.voiceEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </InheritedField>
      </div>
    </section>
  )
}
