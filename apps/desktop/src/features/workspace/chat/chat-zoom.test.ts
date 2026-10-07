import { describe, expect, it } from 'vitest'
import { stepChatZoom } from './chat-zoom'

describe('stepChatZoom', () => {
  it('moves through preset steps and clamps at both ends', () => {
    expect(stepChatZoom(1, 'in')).toBe(1.1)
    expect(stepChatZoom(1, 'out')).toBe(0.9)
    expect(stepChatZoom(2, 'in')).toBe(2)
    expect(stepChatZoom(0.5, 'out')).toBe(0.5)
    expect(stepChatZoom(1.5, 'reset')).toBe(1)
  })
})
