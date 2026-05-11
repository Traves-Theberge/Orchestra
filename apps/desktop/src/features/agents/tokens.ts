/**
 * Design system tokens for the Agent Config Hub.
 * Tailwind-flavored class strings — compose with template literals.
 */
export const TOKENS = {
  // Typography
  textEyebrow:   'text-[10px] uppercase tracking-[0.14em] text-foreground/45',
  textTitle:     'text-[16px] font-semibold tracking-[-0.01em] text-foreground',
  textSub:       'text-[11px] text-foreground/50',
  textMeta:      'text-[10px] font-mono text-foreground/35',
  textValue:     'text-[13px] font-medium text-foreground',
  textInherit:   'text-[11px] italic text-foreground/35',
  textOverride:  'text-[13px] font-medium text-accent',

  // Pills
  pillBase:      'text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded-[3px]',
  pillOverride:  'bg-accent/15 text-accent',
  pillUnsaved:   'bg-amber-500/15 text-amber-400',
  pillInherit:   'bg-foreground/[0.04] text-foreground/40',

  // Surfaces
  surfaceGlobal:  'bg-foreground/[0.02] border border-border/40 rounded-lg',
  surfaceProject: 'bg-accent/[0.04] border border-accent/20 rounded-lg',
  surfaceCard:    'bg-card border border-border/40 rounded-lg',

  // Layout spacing constants (px-based, intentionally explicit)
  paneSpace:     'p-[18px] space-y-[14px]',
  rowGap:        'space-y-[10px]',
} as const

export type Tokens = typeof TOKENS
