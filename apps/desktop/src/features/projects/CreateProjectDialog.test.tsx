import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateProjectDialog } from './CreateProjectDialog'
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip'

const withTooltips = ({ children }: { children: React.ReactNode }) => <TooltipProvider>{children}</TooltipProvider>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CreateProjectDialog failures', () => {
  it('keeps the entered path and dialog open after registration fails, then allows retry', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('unauthorized project path')).mockResolvedValueOnce(undefined)
    const close = vi.fn()
    render(<CreateProjectDialog open onOpenChange={close} onSubmit={submit} />, { wrapper: withTooltips })
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
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'C:\\Projects\\app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Browse filesystem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dialog unavailable')
    expect(screen.getByRole('textbox')).toHaveValue('C:\\Projects\\app')
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeEnabled()
  })

  it('explains manual entry when no native picker is available', async () => {
    vi.stubGlobal('orchestraDesktop', undefined)
    render(<CreateProjectDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />, { wrapper: withTooltips })
    fireEvent.click(screen.getByRole('button', { name: 'Browse filesystem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the absolute project folder path')
  })
})
