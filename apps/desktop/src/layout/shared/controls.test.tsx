import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSelector, CustomDropdown, ProjectSelector, RuntimeSelector, getAgentIcon } from './controls'

afterEach(cleanup)

describe('shared selector menu walkthroughs', () => {
  it('selects the exact project ID from a task project selector and closes', () => {
    const onChange = vi.fn()
    render(<ProjectSelector value="project-a" projects={[{ id: 'project-a', name: 'Alpha' }, { id: 'project-b', name: 'Beta' }]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('project-b')
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
  })

  it('keeps task assignee names scoped to the selected agent option', () => {
    const onChange = vi.fn()
    render(<AgentSelector value="agent-codex" agents={['codex', 'opencode']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /codex/i }))
    fireEvent.click(screen.getByRole('button', { name: 'OpenCodeopencode' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('agent-opencode')
  })

  it('offers only configured runtimes and reports the exact target', () => {
    const onChange = vi.fn()
    render(<RuntimeSelector value="LOCAL" runtimes={[
      { target: 'LOCAL', configured: true },
      { target: 'GCP', configured: true },
      { target: 'SSH', configured: false },
    ]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Local/i }))
    expect(screen.getByRole('button', { name: 'Gcp' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ssh' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gcp' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('GCP')
  })

  it('does not open a disabled selector or dispatch a selection', () => {
    const onChange = vi.fn()
    render(<CustomDropdown value="one" options={[{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }]} onChange={onChange} disabled />)
    const trigger = screen.getByRole('button', { name: /One/ })

    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('button', { name: 'Two' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders native antigravity icon for antigravity provider', () => {
    const { container } = render(<>{getAgentIcon('antigravity', 20)}</>)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('./antigravity.png')
    expect(img?.getAttribute('alt')).toBe('Antigravity')
    expect(img?.getAttribute('width')).toBe('20')
    expect(img?.getAttribute('height')).toBe('20')
    expect(container.querySelector('svg')).toBeNull()
  })
})
