import { useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@ui/command'
import { cn } from '@core/utils/cn'

export type MultiSelectOption = { value: string; label: string; hint?: string }

/** Searchable multi-select: chips for the selection, a cmdk list in a popover. */
export function MultiSelect({ label, options, value, onChange, placeholder = 'None', emptyText = 'Nothing found.' }: {
  label: string; options: MultiSelectOption[]; value: string[]; onChange: (value: string[]) => void; placeholder?: string; emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter(entry => entry !== item) : [...value, item])
  // Keep stored names that are no longer discovered visible and removable.
  const all = [...options, ...value.filter(item => !options.some(option => option.value === item)).map(item => ({ value: item, label: item, hint: 'not found' }))]
  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label} className="flex min-h-8 w-full items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-left text-[13px] hover:bg-muted/30">
            <span className={cn('min-w-0 flex-1 truncate', !value.length && 'text-muted-foreground')}>{value.length ? `${value.length} selected` : placeholder}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0">
          <Command label={label}>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {all.map(option => (
                <CommandItem key={option.value} value={option.value} keywords={[option.label]} onSelect={() => toggle(option.value)}>
                  <span className={cn('flex size-3.5 items-center justify-center rounded-sm border', value.includes(option.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>{value.includes(option.value) ? <Check className="size-3" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? <span className="truncate text-[11px] text-muted-foreground">{option.hint}</span> : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(item => (
            <span key={item} className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => toggle(item)} className="rounded hover:text-foreground"><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
