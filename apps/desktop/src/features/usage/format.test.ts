import { describe, expect, it } from 'vitest'
import { formatCost, formatNumber, formatTokens } from './format'

describe('usage measurements', () => {
  it('keeps measured zero separate from absent or invalid data', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatNumber(0)).toBe('0')
    expect(formatCost(0)).toBe('$0.0000')
    for (const value of [undefined, null, NaN, Infinity, -1]) {
      expect(formatTokens(value)).toBe('Unknown')
      expect(formatNumber(value)).toBe('Unknown')
      expect(formatCost(value)).toBe('Unknown')
    }
  })
})
