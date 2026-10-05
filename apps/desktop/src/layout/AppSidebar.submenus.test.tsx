import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot, Settings } from 'lucide-react'
import { resetAppStore, useAppStore } from '@core/store'
import type { SidebarItem } from '@layout/types'
import { AppSidebar } from './AppSidebar'

vi.mock('@/hooks/use-platform', () => ({ usePlatform: () => ({ isMac: false, platform: 'win32' }) }))
vi.mock('@ui/tooltip-wrapper', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@features/projects/ProjectControls', () => ({ ProjectControls: () => null }))
vi.mock('@features/projects/ProjectWorkspaceTree', () => ({ ProjectWorkspaceTree: () => null }))

const items: SidebarItem[] = [
  { id: 'AGENTS', label: 'Agents', description: 'Agents', icon: Bot },
  { id: 'SETTINGS', label: 'Settings', description: 'Settings', icon: Settings },
]
const projects = [
  { id: 'project-a', name: 'Alpha', root_path: 'C:/fixture/alpha', remote_url: '' },
]

afterEach(() => {
  cleanup()
  resetAppStore()
})

function mount(activeSection: string, onSectionChange = vi.fn()) {
  useAppStore.setState({
    availableAgents: ['codex', 'opencode'],
    activeAgentProvider: 'codex',
    activeAgentScope: 'GLOBAL',
    activeAgentProjectId: '',
    projects,
  })
  render(<AppSidebar
    items={items}
    activeSection={activeSection}
    onSectionChange={onSectionChange}
    projects={projects}
    selectedProjectID={null}
    onSelectProject={vi.fn()}
    onCreateProject={vi.fn()}
  />)
  return { onSectionChange }
}

describe('sidebar Agents and Settings submenus', () => {
  it('selects an available provider and maps the project scope choice to its exact workspace ID', () => {
    mount('AGENTS')
    fireEvent.click(screen.getByRole('button', { name: 'OpenCode' }))
    expect(useAppStore.getState().activeAgentProvider).toBe('opencode')

    fireEvent.click(screen.getAllByRole('button', { name: 'Global' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(useAppStore.getState().activeAgentScope).toBe('PROJECT')
    expect(useAppStore.getState().activeAgentProjectId).toBe('project-a')
  })

  it('exposes Antigravity as the active Google harness and hides Gemini CLI', () => {
    mount('AGENTS')
    act(() => useAppStore.getState().setAvailableAgents(['gemini', 'antigravity']))

    expect(screen.getByRole('button', { name: 'Antigravity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Antigravity' }))
    expect(useAppStore.getState().activeAgentProvider).toBe('antigravity')
  })

  it('resets Settings to the top on entry and routes a subsection choice to its scroll target', () => {
    const scrollToSettingsSection = vi.fn()
    const { onSectionChange } = mount('AGENTS')
    useAppStore.setState({ scrollToSettingsSection })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSectionChange).toHaveBeenCalledExactlyOnceWith('SETTINGS')
    expect(useAppStore.getState().activeSettingsSection).toBe('connections')
    expect(scrollToSettingsSection).toHaveBeenCalledWith('__top__')

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(scrollToSettingsSection).toHaveBeenLastCalledWith('appearance')
  })
})
