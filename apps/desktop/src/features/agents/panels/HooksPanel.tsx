// apps/desktop/src/features/agents/panels/HooksPanel.tsx
import { useCallback, useReducer } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { CustomDropdown } from '@layout/shared/controls'
import type { ProviderHook } from '@core/api/client'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { InheritedField } from '../components/InheritedField'
import { HOOK_EVENTS_BY_PROVIDER } from '../constants'
import type { Provider, Scope } from '../types'

interface HooksPanelProps {
  hooks: ProviderHook[]
  globalHooks?: ProviderHook[]
  scope?: Scope
  projectName?: string | null
  onSave: (hooks: ProviderHook[]) => Promise<void>
  loading: boolean
  saving: string | null
  provider: Provider
}

const EMPTY_HOOKS: ProviderHook[] = []

type HooksState = {
  localHooks: ProviderHook[]
  newEvent: string
  newCommand: string
  newMatcher: string
  error: string
}

type HooksAction =
  | { type: 'reset'; hooks: ProviderHook[] }
  | { type: 'setLocal'; hooks: ProviderHook[] }
  | { type: 'setNewEvent'; value: string }
  | { type: 'setNewCommand'; value: string }
  | { type: 'setNewMatcher'; value: string }
  | { type: 'setError'; value: string }
  | { type: 'addHook' }

function hooksReducer(state: HooksState, action: HooksAction): HooksState {
  switch (action.type) {
    case 'reset':
      return { localHooks: action.hooks, newEvent: '', newCommand: '', newMatcher: '', error: '' }
    case 'setLocal':
      return { ...state, localHooks: action.hooks }
    case 'setNewEvent':
      return { ...state, newEvent: action.value }
    case 'setNewCommand':
      return { ...state, newCommand: action.value }
    case 'setNewMatcher':
      return { ...state, newMatcher: action.value }
    case 'setError':
      return { ...state, error: action.value }
    case 'addHook': {
      if (!state.newEvent || !state.newCommand.trim()) return state
      const next: ProviderHook = {
        event: state.newEvent,
        command: state.newCommand.trim(),
        matcher: state.newMatcher.trim() || undefined,
        type: 'command',
      }
      return {
        ...state,
        localHooks: [...state.localHooks, next],
        newEvent: '',
        newCommand: '',
        newMatcher: '',
      }
    }
    default:
      return state
  }
}

export function HooksPanel({
  hooks, globalHooks = EMPTY_HOOKS, scope = 'GLOBAL', projectName = null,
  onSave, loading, saving, provider,
}: HooksPanelProps) {
  return (
    <HooksPanelInner
      key={JSON.stringify(hooks)}
      hooks={hooks}
      globalHooks={globalHooks}
      scope={scope}
      projectName={projectName}
      onSave={onSave}
      loading={loading}
      saving={saving}
      provider={provider}
    />
  )
}

function HooksPanelInner({
  hooks, globalHooks, scope, projectName, onSave, loading, saving, provider,
}: Required<Omit<HooksPanelProps, 'globalHooks' | 'scope' | 'projectName'>> & {
  globalHooks: ProviderHook[]
  scope: Scope
  projectName: string | null
}) {
  const events = HOOK_EVENTS_BY_PROVIDER[provider] ?? []
  const allowCustomEvents = provider === 'codex'

  const [state, dispatch] = useReducer(hooksReducer, undefined, () => ({
    localHooks: hooks,
    newEvent: '',
    newCommand: '',
    newMatcher: '',
    error: '',
  }))
  const { localHooks, newEvent, newCommand, newMatcher, error } = state

  const dirty = JSON.stringify(localHooks) !== JSON.stringify(hooks)

  const handleDiscard = useCallback(() => {
    dispatch({ type: 'reset', hooks })
  }, [hooks])

  const handleSave = useCallback(async () => {
    dispatch({ type: 'setError', value: '' })
    try {
      await onSave(localHooks)
    } catch (e) {
      dispatch({ type: 'setError', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }, [localHooks, onSave])

  if (loading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[200px] w-full" /></div>
  }

  if (events.length === 0 && !allowCustomEvents) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/20">
        <p className="text-sm font-bold uppercase tracking-widest">{provider} does not support hooks</p>
      </div>
    )
  }

  const setEventFromGlobal = (eventName: string) => {
    const inherited = globalHooks.filter(h => h.event === eventName)
    if (inherited.length === 0) return
    dispatch({
      type: 'setLocal',
      hooks: [...localHooks.filter(h => h.event !== eventName), ...inherited],
    })
  }

  const allEvents = allowCustomEvents
    ? Array.from(new Set([...events, ...localHooks.map(h => h.event), ...globalHooks.map(h => h.event)]))
    : events

  const eyebrow = scope === 'GLOBAL' ? 'Global / Hooks' : `${projectName ?? 'Project'} / Hooks`
  const sub = provider === 'claude' || provider === '8gent'
    ? 'Writes to .claude/settings.json :: hooks'
    : `Run commands on ${provider} events`

  const hookKey = (h: ProviderHook, fallbackIdx: number) =>
    `${h.event}::${h.command}::${h.matcher ?? ''}::${fallbackIdx}`

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Hooks"
        sub={sub}
        dirty={dirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto space-y-4">
          {scope === 'PROJECT' && !allowCustomEvents ? (
            <div className="space-y-4">
              {allEvents.map(ev => {
                const localForEvent = localHooks.filter(h => h.event === ev)
                const inheritedForEvent = globalHooks.filter(h => h.event === ev)
                const inherited = localForEvent.length === 0 && inheritedForEvent.length > 0
                return (
                  <div key={ev} className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-foreground/45">{ev}</label>
                    <InheritedField
                      inherited={inherited}
                      inheritedValue={`${inheritedForEvent.length} hook${inheritedForEvent.length === 1 ? '' : 's'} from global`}
                      onSetHere={() => setEventFromGlobal(ev)}
                    >
                      <div className="space-y-1.5">
                        {localForEvent.length === 0 && (
                          <p className="text-[10px] text-muted-foreground/30 italic">None at this scope</p>
                        )}
                        {localForEvent.map((hook, i) => {
                          const idx = localHooks.indexOf(hook)
                          return (
                            <div key={hookKey(hook, i)} className="flex items-center gap-2 group rounded-lg border border-border/20 px-3 py-2">
                              <code className="text-[11px] font-mono text-foreground/70 flex-1 truncate">{hook.command}</code>
                              {hook.matcher && <span className="text-[9px] text-muted-foreground/40 shrink-0">({hook.matcher})</span>}
                              <button
                                onClick={() => dispatch({ type: 'setLocal', hooks: localHooks.filter((_, j) => j !== idx) })}
                                className="size-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </InheritedField>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {localHooks.length === 0 && (
                <p className="text-[10px] text-muted-foreground/30 py-4 text-center">No hooks configured</p>
              )}
              {localHooks.map((hook, i) => (
                <div key={hookKey(hook, i)} className="flex items-center gap-2 group rounded-lg border border-border/20 px-3 py-2">
                  <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wider shrink-0 w-[120px] truncate">{hook.event}</span>
                  <code className="text-[11px] font-mono text-foreground/70 flex-1 truncate">{hook.command}</code>
                  {hook.matcher && <span className="text-[9px] text-muted-foreground/40 shrink-0">({hook.matcher})</span>}
                  <button
                    onClick={() => dispatch({ type: 'setLocal', hooks: localHooks.filter((_, idx) => idx !== i) })}
                    className="size-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-border/20 pt-3">
            {allowCustomEvents ? (
              <input
                className="h-8 w-[150px] rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none"
                value={newEvent}
                onChange={e => dispatch({ type: 'setNewEvent', value: e.target.value })}
                placeholder="Event"
              />
            ) : (
              <CustomDropdown
                className="w-[150px]"
                direction="up"
                value={newEvent}
                options={events.map(e => ({ label: e, value: e }))}
                onChange={(v) => dispatch({ type: 'setNewEvent', value: v })}
                placeholder="Event"
              />
            )}
            <input
              className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none"
              value={newCommand}
              onChange={e => dispatch({ type: 'setNewCommand', value: e.target.value })}
              placeholder="Command"
            />
            <input
              className="h-8 w-[100px] rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none"
              value={newMatcher}
              onChange={e => dispatch({ type: 'setNewMatcher', value: e.target.value })}
              placeholder="Matcher"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[9px] font-bold uppercase"
              disabled={!newEvent || !newCommand.trim()}
              onClick={() => dispatch({ type: 'addHook' })}
            >
              <Plus size={10} className="mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => dispatch({ type: 'setError', value: '' })} />

      <PanelFooter
        dirty={dirty}
        saving={saving === 'hooks' || !!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
