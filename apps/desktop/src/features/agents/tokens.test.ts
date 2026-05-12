import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

describe('design tokens', () => {
  it('exposes typography classes', () => {
    expect(TOKENS.textTitle).toContain('text-sm')
    expect(TOKENS.textTitle).toContain('font-semibold')
    expect(TOKENS.textSub).toContain('text-xs')
    expect(TOKENS.textSub).toContain('text-muted-foreground')
    expect(TOKENS.textMeta).toContain('font-mono')
    expect(TOKENS.textInherit).toContain('italic')
  })

  it('exposes pill classes', () => {
    expect(TOKENS.pillBase).toContain('rounded-full')
    expect(TOKENS.pillOverride).toContain('bg-accent/10')
    expect(TOKENS.pillUnsaved).toContain('bg-amber-500/10')
  })

  it('exposes surface classes', () => {
    expect(TOKENS.surfaceGlobal).toContain('rounded-xl')
    expect(TOKENS.surfaceGlobal).toContain('bg-card/40')
    expect(TOKENS.surfaceProject).toContain('bg-accent/[0.03]')
    expect(TOKENS.surfaceEmpty).toContain('border-dashed')
  })
})
