import { describe, expect, it } from 'vitest'
import { buildCommandRegistrationPatch, getRegisteredCommand, isHarnessRegistered, KNOWN_HARNESSES } from './harness-setup'

describe('harness setup helpers', () => {
  it('matches provider IDs without changing the stored spelling', () => {
    const commands = { codex: 'codex exec {{prompt}}', OPENCODE: 'opencode run {{prompt}}' }
    expect(getRegisteredCommand(commands, 'CODEX')).toBe('codex exec {{prompt}}')
    expect(isHarnessRegistered(['codex', 'GEMINI'], 'CODEX')).toBe(true)
  })

  it('offers Antigravity in the active harness catalog without offering Gemini CLI', () => {
    expect(KNOWN_HARNESSES.map(harness => harness.id)).toContain('ANTIGRAVITY')
    expect(KNOWN_HARNESSES.map(harness => harness.id)).not.toContain('GEMINI')
  })

  it('offers OMP with its guide link', () => {
    expect(KNOWN_HARNESSES).toContainEqual({ id: 'OMP', label: 'OMP', helpUrl: 'https://omp.sh' })
  })

  it('patches only the selected command and preserves the fetched default', () => {
    const patch = buildCommandRegistrationPatch(
      { CODEX: 'codex exec {{prompt}}', CLAUDE: 'claude -p {{prompt}}' },
      'codex',
      ' codex exec --json {{prompt}} ',
      'CLAUDE',
    )
    expect(patch).toEqual({ commands: { CODEX: 'codex exec --json {{prompt}}' }, agent_provider: 'CLAUDE' })
    expect(patch.commands).not.toHaveProperty('CLAUDE')
  })
})
