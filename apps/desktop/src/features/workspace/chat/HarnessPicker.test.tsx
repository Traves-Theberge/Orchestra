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
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Choose harness and model')).toHaveFocus()
})
