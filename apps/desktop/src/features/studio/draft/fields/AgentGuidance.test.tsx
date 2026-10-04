import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StudioDraft } from '@core/api/client'
import { AgentGuidance } from './AgentGuidance'

describe('AgentGuidance', () => {
  it('sends an explicit null when the requested limit is cleared', () => {
    const draft: StudioDraft = {
      session_id: 'studio-test', title: '', description: '', acceptance_criteria: [],
      attachments: [], suggested_provider: '', suggested_model: '', max_turns: 5,
      template_vars: {}, agent_guidance: {},
    }
    const onChange = vi.fn()
    render(<AgentGuidance draft={draft} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ max_turns: null })
    expect(JSON.stringify(onChange.mock.calls[0]?.[0])).toBe('{"max_turns":null}')
  })
})
