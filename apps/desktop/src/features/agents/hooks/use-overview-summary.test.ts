import { describe, it, expect } from 'vitest'
import { computeClaudeSummary } from './use-overview-summary'

describe('computeClaudeSummary', () => {
  it('counts skills from items', () => {
    const result = computeClaudeSummary({
      settings: { model: 'sonnet' },
      claudeMd: 'line1\nline2\nline3',
      skills: [{ name: 'a.md' }, { name: 'b.md' }],
      hooks: [],
      mcpServers: { github: {} },
      subAgents: [{ name: 'reviewer.md' }],
    })
    expect(result.model).toBe('sonnet')
    expect(result.instructionsLines).toBe(3)
    expect(result.skillsCount).toBe(2)
    expect(result.mcpCount).toBe(1)
    expect(result.subAgentsCount).toBe(1)
    expect(result.hooksCount).toBe(0)
  })

  it('returns nulls for missing data', () => {
    const result = computeClaudeSummary({
      settings: null, claudeMd: null, skills: [], hooks: [], mcpServers: {}, subAgents: [],
    })
    expect(result.model).toBeNull()
    expect(result.instructionsLines).toBeNull()
    expect(result.skillsCount).toBe(0)
  })
})
