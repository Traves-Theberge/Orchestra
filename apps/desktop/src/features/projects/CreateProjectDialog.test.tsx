import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateProjectDialog } from './CreateProjectDialog'
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip'

const withTooltips = ({ children }: { children: React.ReactNode }) => <TooltipProvider>{children}</TooltipProvider>
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CreateProjectDialog failures', () => {
  it('submits new repositories separately from local registration', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    render(<CreateProjectDialog open onOpenChange={vi.fn()} onSubmit={submit} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('option', { name: /New project/ }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'my-app' } })
    fireEvent.change(screen.getByLabelText('Parent folder'), { target: { value: 'C:\\Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith('C:\\Projects', { source: 'new', name: 'my-app' }))
  })

  it('normalizes a GitHub repository and preserves its destination after failure', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('destination retained'))
    render(<CreateProjectDialog open onOpenChange={vi.fn()} onSubmit={submit} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('option', { name: /GitHub repository/ }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'my-app' } })
    fireEvent.change(screen.getByLabelText('Parent folder'), { target: { value: 'C:\\Projects' } })
    fireEvent.change(screen.getByLabelText('GitHub owner/repo'), { target: { value: 'example/app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('destination retained')
    expect(submit).toHaveBeenCalledWith('C:\\Projects', { source: 'clone', name: 'my-app', remote_url: 'https://github.com/example/app.git' })
    expect(screen.getByLabelText('Project name')).toHaveValue('my-app')
  })

  it('keeps the entered path and dialog open after registration fails, then allows retry', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('unauthorized project path')).mockResolvedValueOnce(undefined)
    const close = vi.fn()
    render(<CreateProjectDialog open onOpenChange={close} onSubmit={submit} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('option', { name: /Local folder/ }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'C:\\Projects\\app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('unauthorized project path')
    expect(input).toHaveValue('C:\\Projects\\app')
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('shows picker failure and preserves a manually entered path', async () => {
    vi.stubGlobal('orchestraDesktop', { selectFolder: vi.fn().mockRejectedValue(new Error('dialog unavailable')) })
    render(<CreateProjectDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('option', { name: /Local folder/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'C:\\Projects\\app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Browse filesystem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dialog unavailable')
    expect(screen.getByRole('textbox')).toHaveValue('C:\\Projects\\app')
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeEnabled()
  })

  it('explains manual entry when no native picker is available', async () => {
    vi.stubGlobal('orchestraDesktop', undefined)
    render(<CreateProjectDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('option', { name: /Local folder/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse filesystem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the absolute project folder path')
  })
})
