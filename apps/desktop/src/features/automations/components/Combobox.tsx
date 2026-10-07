import { useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@core/utils/cn'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'

export type ComboboxOption = {
  value: string
  label: string
  /** Extra text that participates in search. */
  keywords?: string[]
  hint?: string
  icon?: ReactNode
}

/** Searchable single-select built from Radix Popover + cmdk. */
export function Combobox({ id, value, options, onChange, placeholder, searchPlaceholder = 'Search…', emptyText = 'No matches.', ariaLabel, disabled, className }: {
  id?: string
  value: string
  options: ComboboxOption[]
  onChange: (value: string) => void
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('flex min-w-0 items-center gap-2 truncate', !selected && 'text-muted-foreground')}>
            {selected?.icon}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value || '__none__'}
                  value={`${option.label} ${option.value} ${(option.keywords ?? []).join(' ')}`}
                  onSelect={() => { onChange(option.value); setOpen(false) }}
                >
                  {option.icon}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{option.hint}</span> : null}
                  <Check className={cn('ml-1', option.value === value ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
