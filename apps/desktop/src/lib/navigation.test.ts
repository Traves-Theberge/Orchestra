import { describe, expect, it } from 'vitest'
import { getNextSidebarIndex } from '@/lib/navigation'

describe('getNextSidebarIndex', () => {
  it('returns null for unsupported keys', () => {
    expect(getNextSidebarIndex('Enter', 0, 4)).toBeNull()
  })

  it('returns first and last for Home/End', () => {
    expect(getNextSidebarIndex('Home', 2, 4)).toBe(0)
    expect(getNextSidebarIndex('End', 1, 4)).toBe(3)
  })

  it('wraps around for ArrowDown and ArrowUp', () => {
    expect(getNextSidebarIndex('ArrowDown', 3, 4)).toBe(0)
    expect(getNextSidebarIndex('ArrowUp', 0, 4)).toBe(3)
  })

  it('returns null when there are no items', () => {
    expect(getNextSidebarIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
