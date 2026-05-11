import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

describe('design tokens', () => {
  it('exposes typography classes', () => {
    expect(TOKENS.textEyebrow).toContain('text-[10px]')
    expect(TOKENS.textEyebrow).toContain('uppercase')
    expect(TOKENS.textTitle).toContain('text-[16px]')
    expect(TOKENS.textTitle).toContain('font-semibold')
    expect(TOKENS.textSub).toContain('text-[11px]')
    expect(TOKENS.textMeta).toContain('font-mono')
    expect(TOKENS.textInherit).toContain('italic')
  })

  it('exposes pill classes', () => {
    expect(TOKENS.pillOverride).toContain('bg-accent/15')
    expect(TOKENS.pillUnsaved).toContain('bg-amber-500/15')
  })

  it('exposes surface classes', () => {
    expect(TOKENS.surfaceGlobal).toContain('bg-foreground/[0.02]')
    expect(TOKENS.surfaceProject).toContain('bg-accent/[0.04]')
  })
})
