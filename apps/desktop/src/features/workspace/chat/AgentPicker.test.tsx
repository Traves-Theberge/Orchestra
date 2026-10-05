import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { AgentPicker } from './AgentPicker'
import { fetchAgentCatalog, type AgentCatalog } from '@core/api/agent-catalog'

vi.mock('@core/api/agent-catalog', () => ({ fetchAgentCatalog: vi.fn() }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const catalog: AgentCatalog = { project_id: '__orchestrator__', harness: 'OPENCODE', scope: 'global', root: '/fixture', observation: 'observed', selection_capability: 'configured_unapplied', items: [{ id: 'review/security', kind: 'agent_definition', harness: 'OPENCODE', scope: 'global', path: '/fixture/review/security.md', content_hash: 'abc', format: 'markdown', display_name: 'Security', description: '', mode: 'primary', selectable_as_primary: false, selection_status: 'configured_unapplied' }] }
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.mocked(fetchAgentCatalog).mockResolvedValue(catalog) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('uses global Maestro scope and keeps unverified definitions unselectable', async () => {
  const change = vi.fn()
  render(<AppTooltipProvider><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={change} /></AppTooltipProvider>)
  await waitFor(() => expect(fetchAgentCatalog).toHaveBeenCalledWith(config, '__orchestrator__', 'OPENCODE', 'global'))
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  expect(await screen.findByRole('option', { name: /Security/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('option', { name: 'Provider default' }))
  expect(change).toHaveBeenCalledWith(undefined)
})
it('preserves exact nested native ID, scope and hash for a verified selection', async () => {
  vi.mocked(fetchAgentCatalog).mockResolvedValue({ ...catalog, selection_capability: 'selectable_primary', items: [{ ...catalog.items[0], selectable_as_primary: true }] })
  const change = vi.fn()
  render(<AppTooltipProvider><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={change} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  const option = await screen.findByRole('option', { name: /Security/ })
  fireEvent.click(option)
  expect(change).toHaveBeenCalledWith({ agent_id: 'review/security', agent_scope: 'global', agent_content_hash: 'abc', agent_format: 'markdown' })
})
it('cycles verified modes from the composer with Tab and reverses with Shift+Tab', async () => {
  vi.mocked(fetchAgentCatalog).mockResolvedValue({ ...catalog, selection_capability: 'selectable_primary', items: [{ ...catalog.items[0], selectable_as_primary: true }] })
  const change = vi.fn()
  const view = render(<AppTooltipProvider><footer><textarea aria-label="Message" /><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={change} /></footer></AppTooltipProvider>)
  await waitFor(() => expect(fetchAgentCatalog).toHaveBeenCalled())
  // Await the catalog render before dispatching the keyboard shortcut.
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  await screen.findByRole('option', { name: /Security/ })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  change.mockClear()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' })
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'review/security' }))
  view.rerender(<AppTooltipProvider><footer><textarea aria-label="Message" /><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} selection={change.mock.calls[0][0]} onChange={change} /></footer></AppTooltipProvider>)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab', shiftKey: true })
  expect(change).toHaveBeenLastCalledWith(undefined)
})
it('keeps Tab in the composer when no other primary mode is supported', async () => {
  render(<AppTooltipProvider><footer><textarea aria-label="Message" /><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={vi.fn()} /></footer></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  await screen.findByRole('option', { name: /Security/ })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  const composer = screen.getByRole('textbox')
  composer.focus()
  expect(fireEvent.keyDown(composer, { key: 'Tab' })).toBe(false)
  expect(composer).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('Default is the only supported mode.')
})
