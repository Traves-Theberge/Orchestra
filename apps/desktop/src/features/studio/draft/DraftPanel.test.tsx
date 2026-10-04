import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StudioDraft } from '@core/api/client'
import { DraftPanel } from './DraftPanel'

describe('DraftPanel execution overrides', () => {
  it('exposes inherited overrides and lets the user clear them before Push', () => {
    const draft: StudioDraft = {
      session_id: 'draft-a', title: 'Task', description: 'Description', acceptance_criteria: [],
      attachments: [], suggested_provider: '', suggested_model: 'inherited-model', max_turns: 5,
      template_vars: {}, agent_guidance: {},
    }
    const onChange = vi.fn()
    const onPush = vi.fn()
    render(<DraftPanel draft={draft} onChange={onChange} onPush={onPush} onDiscard={vi.fn()} />)
    expect(screen.getByLabelText('Model')).toHaveValue('inherited-model')
    expect(screen.getByLabelText('Max turns')).toHaveValue(5)
    expect(screen.getByText(/Explicit turn budgets are not supported/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Max turns'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ max_turns: null })
    expect(onChange).toHaveBeenCalledWith({ suggested_model: '' })
    expect(onPush).not.toHaveBeenCalled()
  })
})
