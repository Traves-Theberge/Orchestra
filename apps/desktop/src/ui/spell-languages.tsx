import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@core/utils/cn'
import { getSpellBridge, languageLabel, sortLanguages, type SpellBridge, type SpellSettings } from '@core/spellcheck/spell-bridge'

type SpellLanguagesListProps = {
  /** Defaults to the Electron bridge; null renders the browser-mode note. */
  bridge?: SpellBridge | null
  className?: string
  /** Focus the filter field on mount (popover use). */
  autoFocus?: boolean
}

/** Checklist of spellchecker languages. Used by the spelling menu popover and Settings. */
export function SpellLanguagesList({ bridge: bridgeProp, className, autoFocus }: SpellLanguagesListProps) {
  const [defaultBridge] = useState(getSpellBridge)
  const bridge = bridgeProp === undefined ? defaultBridge : bridgeProp
  const [settings, setSettings] = useState<SpellSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  // Sorted once per load so rows do not jump while toggling.
  const [ordered, setOrdered] = useState<string[]>([])

  useEffect(() => {
    if (!bridge) return
    let alive = true
    bridge.getSettings().then(next => {
      if (!alive) return
      setSettings(next)
      setOrdered(sortLanguages(next.availableLanguages, next.languages))
    }, err => { if (alive) setError(String(err?.message ?? err)) })
    return () => { alive = false }
  }, [bridge])

  const query = filter.trim().toLowerCase()
  const visible = query ? ordered.filter(code => code.toLowerCase().includes(query) || languageLabel(code).toLowerCase().includes(query)) : ordered

  if (!bridge) return <p className={cn('text-[12px] text-muted-foreground', className)}>Spellcheck languages can be changed in the desktop app.</p>
  if (error) return <p className={cn('text-[12px] text-muted-foreground', className)}>Couldn't load spelling languages: {error}</p>
  if (!settings) return <p className={cn('text-[12px] text-muted-foreground', className)}>Loading languages…</p>
  if (!settings.supportsLanguages) return <p className={cn('text-[12px] text-muted-foreground', className)}>Spelling follows your system language settings.</p>

  const active = new Set(settings.languages)
  const toggle = (code: string) => {
    const next = active.has(code) ? settings.languages.filter(c => c !== code) : [...settings.languages, code]
    if (next.length === 0) return
    setSettings({ ...settings, languages: next })
    bridge.setLanguages(next).then(setSettings, err => {
      setError(String(err?.message ?? err))
    })
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-1.5', className)}>
      {ordered.length > 8 && (
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter languages"
          aria-label="Filter languages"
          spellCheck={false}
          autoFocus={autoFocus}
          className="w-full rounded-md bg-muted/50 px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:bg-muted"
        />
      )}
      <ul role="group" aria-label="Spelling languages" className="min-h-0 flex-1 overflow-y-auto">
        {visible.map(code => {
          const checked = active.has(code)
          const locked = checked && active.size === 1
          return (
            <li key={code}>
              <label
                className={cn('flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-[12px] hover:bg-muted', locked && 'opacity-60')}
                title={locked ? 'At least one language stays on' : undefined}
              >
                <input type="checkbox" className="peer sr-only" checked={checked} disabled={locked} onChange={() => toggle(code)} />
                <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-muted text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40">
                  {checked && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{languageLabel(code)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{code}</span>
              </label>
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-2 py-1 text-[12px] text-muted-foreground">No matches</li>}
      </ul>
    </div>
  )
}
