import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { AgentPicker } from './AgentPicker'
import { fetchAgentCatalog, type AgentCatalog } from '@core/api/agent-catalog'
import { fetchHarnessCapabilities, fetchUnifiedAgents } from '@core/api/client'

vi.mock('@core/api/agent-catalog', () => ({ fetchAgentCatalog: vi.fn() }))
vi.mock('@core/api/client', () => ({ fetchHarnessCapabilities: vi.fn(), fetchUnifiedAgents: vi.fn() }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const catalog: AgentCatalog = { project_id: '__orchestrator__', harness: 'OPENCODE', scope: 'global', root: '/fixture', observation: 'observed', selection_capability: 'configured_unapplied', items: [{ id: 'review/security', kind: 'agent_definition', harness: 'OPENCODE', scope: 'global', path: '/fixture/review/security.md', content_hash: 'abc', format: 'markdown', display_name: 'Security', description: '', mode: 'primary', selectable_as_primary: false, selection_status: 'configured_unapplied' }] }
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.mocked(fetchAgentCatalog).mockResolvedValue(catalog); vi.mocked(fetchHarnessCapabilities).mockResolvedValue([]); vi.mocked(fetchUnifiedAgents).mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('uses global Maestro scope and keeps unverified definitions unselectable', async () => {
  const change = vi.fn()
  render(<AppTooltipProvider><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={change} /></AppTooltipProvider>)
  await waitFor(() => expect(fetchAgentCatalog).toHaveBeenCalledWith(config, '__orchestrator__', 'OPENCODE', 'global'))
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  expect(screen.getByRole('option', { name: 'Maestro' })).toBeInTheDocument()
  expect(await screen.findByRole('option', { name: /Security/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('option', { name: 'Maestro' }))
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
  expect(screen.getByRole('status')).toHaveTextContent('Maestro is the only supported mode.')
})

it('uses the provider default label in regular workspace scopes', async () => {
  render(<AppTooltipProvider><AgentPicker config={config} projectId="project-1" harness="OPENCODE" disabled={false} onChange={vi.fn()} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  expect(await screen.findByRole('option', { name: 'Provider default' })).toBeInTheDocument()
})

it('keeps Maestro available when the global catalog cannot load', async () => {
  vi.mocked(fetchAgentCatalog).mockRejectedValue(new Error('offline'))
  render(<AppTooltipProvider><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={vi.fn()} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  expect(await screen.findByText('Agent catalog unavailable. Maestro is available.')).toBeInTheDocument()
})

it('labels the loading fallback as Maestro without blocking the default option', () => {
  vi.mocked(fetchAgentCatalog).mockReturnValue(new Promise(() => {}))
  render(<AppTooltipProvider><AgentPicker config={config} projectId="__orchestrator__" harness="OPENCODE" disabled={false} onChange={vi.fn()} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  expect(screen.getByText('Loading agents… Maestro is available.')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Maestro' })).toBeInTheDocument()
})

const base = catalog.items[0]
const crossHarness: AgentCatalog = { ...catalog, project_id: 'project-1', harness: 'CLAUDE', selection_capability: 'selectable_primary', items: [
  { ...base, id: 'orchestra:global:orchestra:reviewer', name: 'reviewer', display_name: 'Reviewer', source: 'orchestra', harness: 'CLAUDE', mode: 'primary', color: '#ff0000', selectable: true, selectable_as_primary: true, content_hash: 'h1' },
  { ...base, id: 'orchestra:global:orchestra:planner', name: 'planner', display_name: 'Planner', source: 'orchestra', harness: 'CLAUDE', mode: 'all', selectable: false, unavailable_reason: 'Needs MCP support', selectable_as_primary: true },
  { ...base, id: 'harness:project:claude:explorer', name: 'explorer', display_name: 'Explorer', source: 'harness', harness: 'CLAUDE', mode: 'subagent', selectable: true, selectable_as_primary: true },
] }

it('lists primary and all-mode agents for the harness with disabled reasons and capability hints', async () => {
  vi.mocked(fetchAgentCatalog).mockResolvedValue(crossHarness)
  vi.mocked(fetchHarnessCapabilities).mockResolvedValue([{ harness: 'claude', agent_inline: { supported: true, mechanism: '--agents <tmpfile>' }, agent_select: { supported: true, mechanism: '--agent' } }])
  render(<AppTooltipProvider><AgentPicker config={config} projectId="project-1" harness="CLAUDE" disabled={false} onChange={vi.fn()} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  const reviewer = await screen.findByRole('option', { name: /Reviewer/ })
  expect(reviewer).toBeEnabled()
  await waitFor(() => expect(reviewer).toHaveTextContent('Applied on Claude via --agents <tmpfile>'))
  expect(reviewer.querySelector('[data-agent-color]')).toHaveStyle({ backgroundColor: '#ff0000' })
  const planner = screen.getByRole('option', { name: /Planner/ })
  expect(planner).toBeDisabled()
  expect(planner).toHaveTextContent('Needs MCP support')
  expect(screen.queryByRole('option', { name: /Explorer/ })).not.toBeInTheDocument()
})

it('cycles only selectable primary agents and leaves Tab alone once a draft is typed', async () => {
  vi.mocked(fetchAgentCatalog).mockResolvedValue(crossHarness)
  const change = vi.fn()
  render(<AppTooltipProvider><footer><textarea aria-label="Message" /><AgentPicker config={config} projectId="project-1" harness="CLAUDE" disabled={false} onChange={change} /></footer></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
  await screen.findByRole('option', { name: /Reviewer/ })
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  const composer = screen.getByRole('textbox')
  fireEvent.keyDown(composer, { key: 'Tab' })
  expect(change).toHaveBeenLastCalledWith({ agent_id: 'orchestra:global:orchestra:reviewer', agent_scope: 'global', agent_content_hash: 'h1', agent_format: 'markdown' })
  change.mockClear()
  fireEvent.change(composer, { target: { value: 'typed draft' } })
  expect(fireEvent.keyDown(composer, { key: 'Tab' })).toBe(true)
  expect(change).not.toHaveBeenCalled()
})
it('lists Orchestra agents from agent-profiles even when the harness catalog has none', async () => {
  vi.mocked(fetchAgentCatalog).mockResolvedValue({ ...catalog, project_id: 'project-a', harness: 'CLAUDE', items: [] })
  vi.mocked(fetchUnifiedAgents).mockResolvedValue([
    { id: 'orchestra:global:orchestra:planner', name: 'planner', mode: 'primary', source: 'orchestra', scope: 'global', color: '#3b82f6', content_hash: 'sha256:p', format: 'orchestra-markdown', selectable: true },
    { id: 'harness:global:codex:reviewer', name: 'reviewer', mode: 'all', source: 'harness', scope: 'global', selectable: false },
  ])
  const change = vi.fn()
  render(<AppTooltipProvider><AgentPicker config={config} projectId="project-a" harness="CLAUDE" disabled={false} onChange={change} /></AppTooltipProvider>)
  await waitFor(() => expect(fetchUnifiedAgents).toHaveBeenCalledWith(config, { projectId: 'project-a', harness: 'CLAUDE' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Agent: planner' }))
  expect(change).toHaveBeenCalledWith({ agent_id: 'orchestra:global:orchestra:planner', agent_scope: 'global', agent_content_hash: 'sha256:p', agent_format: 'orchestra-markdown' })
  // Harness agents still come from the harness catalog, not agent-profiles.
  expect(screen.queryByRole('button', { name: 'Agent: reviewer' })).not.toBeInTheDocument()
})
