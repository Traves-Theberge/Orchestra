/**
 * Design system tokens for the Agent Config Hub.
 * Tailwind-flavored class strings — composed to match the Orca IDE settings-pane look.
 */
export const TOKENS = {
  // Typography — Orca settings-pane style
  textTitle:     'text-sm font-semibold text-foreground',           // section title
  textSub:       'text-xs text-muted-foreground',                   // section description
  textMeta:      'text-[11px] font-mono text-muted-foreground/70', // file paths, sizes
  textValue:     'text-sm text-foreground',                         // form values
  textInherit:   'text-xs italic text-muted-foreground/60',         // inherited placeholder
  textOverride:  'text-sm font-medium text-accent',                 // override value
  textLabel:     'text-xs font-medium text-foreground',             // form field label
  textHelper:    'text-[11px] text-muted-foreground',               // helper under label

  // Pills (rounded-full per Orca)
  pillBase:      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
  pillOverride:  'border-accent/30 bg-accent/10 text-accent',
  pillUnsaved:   'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  pillInherit:   'border-border/40 bg-muted/30 text-muted-foreground',

  // Surfaces — Orca uses rounded-xl + softer card
  surfaceGlobal:  'rounded-xl border border-border/40 bg-card/40',
  surfaceProject: 'rounded-xl border border-accent/20 bg-accent/[0.03]',
  surfaceCard:    'rounded-xl border border-border/40 bg-card/60',
  surfaceEmpty:   'rounded-xl border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground',

  // Spacing scale
  paneSpace:     'p-6 space-y-8',     // outer
  sectionSpace:  'space-y-4',         // inside a section
  headerSpace:   'space-y-1',         // header title + description
  rowGap:        'space-y-2',         // between form rows
} as const

