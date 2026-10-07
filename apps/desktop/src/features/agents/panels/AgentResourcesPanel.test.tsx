import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { AgentResourcesPanel } from './AgentResourcesPanel'
import * as api from '@core/api/agent-catalog'

vi.mock('@core/api/agent-catalog', () => ({ fetchAgentCatalog: vi.fn(), fetchAgentResource: vi.fn(), mutateAgentResource: vi.fn(), fetchAgentMutationReceipt: vi.fn() }))
vi.mock('@features/workspace/chat/chat-draft-storage', () => ({ chatDraftStorageKey: async () => 'fixture-identity-digest' }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const item: api.AgentResource = { id: 'review/security', kind: 'agent_definition', scope: 'global', harness: 'OPENCODE', path: '/fixture/security.md', content_hash: 'before', format: 'markdown', display_name: 'Security', description: '', mode: 'primary', selectable_as_primary: false, selection_status: 'configured_unapplied', content: '---\nmode: primary\npermission:\n  edit: ask\n---\nReview code.' }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.mocked(api.fetchAgentCatalog).mockResolvedValue({ project_id: '__orchestrator__', harness: 'OPENCODE', scope: 'global', root: '/fixture', observation: 'observed', selection_capability: 'configured_unapplied', capabilities: { list: true, create: true, update: true, delete: true, select_primary: false }, items: [item] })
  vi.mocked(api.fetchAgentResource).mockResolvedValue(item)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('sends exact native bytes/hash and retains unknown receipts across remount without retry', async () => {
  vi.mocked(api.mutateAgentResource).mockRejectedValue(new Error('Disconnected'))
  const ui = <AppTooltipProvider><AgentResourcesPanel config={config} projectId="__orchestrator__" harness="OPENCODE" scope="global" kind="agent_definition" /></AppTooltipProvider>
  const view = render(ui)
  fireEvent.click(await screen.findByRole('button', { name: /Security/ }))
  const editor = await screen.findByRole('textbox', { name: 'Native resource content' })
  const updated = item.content + '\nKeep nested permissions.'
  fireEvent.change(editor, { target: { value: updated } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('button', { name: 'Check receipt' })
  expect(api.mutateAgentResource).toHaveBeenCalledWith(config, '__orchestrator__', 'OPENCODE', 'global', 'agent_definition', 'review/security', 'update', expect.objectContaining({ expected_hash: 'before', content: updated }))
  const requestId = vi.mocked(api.mutateAgentResource).mock.calls[0][7].request_id
  view.unmount(); render(ui)
  await waitFor(() => expect(screen.getByText(requestId)).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled()
  expect(api.mutateAgentResource).toHaveBeenCalledTimes(1)
})
it('creates OMP agents as omp-markdown starting from a name/description frontmatter template', async () => {
  vi.mocked(api.fetchAgentCatalog).mockResolvedValue({ project_id: '__orchestrator__', harness: 'OMP', scope: 'global', root: '/fixture/.omp/agent/agents', observation: 'observed', selection_capability: 'selectable_primary', capabilities: { list: true, create: true, update: true, delete: true, select_primary: true }, items: [] })
  vi.mocked(api.mutateAgentResource).mockImplementation(async (...args) => ({ request_id: args[7].request_id, status: 'completed' }) as never)
  render(<AppTooltipProvider><AgentResourcesPanel config={config} projectId="__orchestrator__" harness="omp" scope="global" kind="agent_definition" /></AppTooltipProvider>)
  const create = await screen.findByRole('button', { name: 'Create agent' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  const editor = screen.getByRole('textbox', { name: 'Native resource content' }) as HTMLTextAreaElement
  expect(editor.value).toMatch(/^---\nname: my-agent\ndescription: .+\n---\n/)
  fireEvent.change(screen.getByRole('textbox', { name: 'Native resource name' }), { target: { value: 'scout' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.mutateAgentResource).toHaveBeenCalledWith(config, '__orchestrator__', 'omp', 'global', 'agent_definition', 'scout', 'create', expect.objectContaining({ format: 'omp-markdown', content: editor.value })))
})
