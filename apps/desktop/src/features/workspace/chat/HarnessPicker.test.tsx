import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessPicker } from './HarnessPicker'

afterEach(cleanup)
it('searches the provider catalog and selects the exact model slug without launching a turn', () => {
  const onModel = vi.fn()
  render(<HarnessPicker providers={[{ id: 'CODEX', label: 'Codex', enabled: true, conversation_mode: 'native_session', provider_resume: true }]} provider="CODEX" disabled={false} locked={false} model="" onModel={onModel} onProvider={vi.fn()}
    catalog={{ provider: 'CODEX', project_id: 'a', observation: 'provider_catalog', models: [
      { id: 'opaque', model: 'exact/provider-slug', display_name: 'Visible model', is_default: false },
      { id: 'hidden', model: 'hidden', display_name: 'Hidden model', is_default: false, hidden: true },
    ] }} />)
  fireEvent.click(screen.getByLabelText('Choose harness and model'))
  expect(screen.queryByRole('option', { name: /Hidden model/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'Visible' } })
  fireEvent.click(screen.getByRole('option', { name: /Visible model/ }))
  expect(onModel).toHaveBeenCalledExactlyOnceWith('exact/provider-slug')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Choose harness and model')).toHaveFocus()
})

it('opens a modal popup and returns focus to the trigger when dismissed', () => {
  render(<HarnessPicker providers={[{ id: 'CODEX', label: 'Codex', enabled: true, conversation_mode: 'native_session', provider_resume: true }]} provider="CODEX" disabled={false} locked={false} model="" onModel={vi.fn()} onProvider={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'Choose harness and model' })
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Harnesses and models' })).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('button', { name: 'Use Codex' }).querySelector('img')).toHaveAttribute('src', './OpenAI_Symbol_1.png')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('shows supported effort levels and lets the provider default clear an explicit choice', () => {
  const onEffort = vi.fn()
  const props = {
    providers: [{ id: 'CODEX', label: 'Codex', enabled: true, conversation_mode: 'native_session' as const, provider_resume: true }],
    provider: 'CODEX', disabled: false, locked: false, model: 'gpt-6-sol', onModel: vi.fn(), onProvider: vi.fn(), onEffort,
    catalog: { provider: 'CODEX', project_id: 'a', observation: 'provider_catalog' as const, models: [{ id: 'gpt-6-sol', model: 'gpt-6-sol', display_name: 'GPT-6-Sol', is_default: false }] },
    effortOptions: [{ reasoning_effort: 'low' }, { reasoning_effort: 'medium', description: 'Balanced for everyday tasks' }, { reasoning_effort: 'high' }],
  }
  const { rerender } = render(<HarnessPicker {...props} effort="" />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose harness and model' }))
  expect(screen.getByRole('button', { name: 'Use provider default effort' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Set reasoning effort to medium' }))
  expect(onEffort).toHaveBeenLastCalledWith('medium')
  rerender(<HarnessPicker {...props} effort="medium" />)
  expect(screen.getByRole('button', { name: 'Set reasoning effort to medium' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Balanced for everyday tasks')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use provider default effort' }))
  expect(onEffort).toHaveBeenLastCalledWith('')
})
