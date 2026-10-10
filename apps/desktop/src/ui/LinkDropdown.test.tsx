import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LinkDropdown } from './LinkDropdown'

const mockOpenBrowserTab = vi.fn()
const mockSetActiveSection = vi.fn()
const mockOpenExternal = vi.fn()

vi.mock('@core/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openBrowserTab: mockOpenBrowserTab,
      setActiveSection: mockSetActiveSection,
    }),
}))

describe('LinkDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.orchestraDesktop = {
      openExternal: mockOpenExternal,
    } as unknown as typeof window.orchestraDesktop
  })

  it('renders a plain anchor for in-page hash links', () => {
    const { container } = render(
      <LinkDropdown href="#heading">Jump to Heading</LinkDropdown>
    )
    const anchor = container.querySelector('a')
    expect(anchor).toBeTruthy()
    expect(anchor?.getAttribute('href')).toBe('#heading')
    expect(screen.getByText('Jump to Heading')).toBeDefined()
    expect(container.querySelector('svg')).toBeNull() // no chevron
  })

  it('renders a clickable link and opens dropdown menu on click', async () => {
    render(
      <LinkDropdown href="https://github.com/owner/repo" linkProjectId="project-123">
        GitHub Repo
      </LinkDropdown>
    )

    const link = screen.getByRole('link', { name: /GitHub Repo/i })
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo')
    // Open dropdown via Enter key
    fireEvent.keyDown(link, { key: 'Enter' })

    expect(await screen.findByText('Open in Workspace')).toBeDefined()
    expect(screen.getByText('Open in Default Browser')).toBeDefined()
    expect(screen.getByText('Copy Link Address')).toBeDefined()
  })

  it('opens link in workspace browser when "Open in Workspace" is selected', async () => {
    render(
      <LinkDropdown href="https://example.com/docs" linkProjectId="project-123">
        Documentation
      </LinkDropdown>
    )
    const link = screen.getByRole('link', { name: /Documentation/i })
    fireEvent.keyDown(link, { key: 'Enter' })
    const workspaceOption = await screen.findByText('Open in Workspace')
    fireEvent.click(workspaceOption)

    expect(mockSetActiveSection).toHaveBeenCalledWith('CONSOLE')
    expect(mockOpenBrowserTab).toHaveBeenCalledWith('https://example.com/docs', 'project-123')
  })

  it('opens link in system browser when "Open in Default Browser" is selected', async () => {
    render(
      <LinkDropdown href="https://example.com/api">API Reference</LinkDropdown>
    )
    const link = screen.getByRole('link', { name: /API Reference/i })
    fireEvent.keyDown(link, { key: 'Enter' })
    const defaultBrowserOption = await screen.findByText('Open in Default Browser')
    fireEvent.click(defaultBrowserOption)

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/api')
  })

  it('copies link to clipboard when "Copy Link Address" is selected', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    render(
      <LinkDropdown href="https://example.com/share">Share Link</LinkDropdown>
    )
    const link = screen.getByRole('link', { name: /Share Link/i })
    fireEvent.keyDown(link, { key: 'Enter' })
    const copyOption = await screen.findByText('Copy Link Address')
    fireEvent.click(copyOption)

    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/share')
  })

  it('opens directly in external browser when Ctrl/Cmd-clicked', () => {
    render(
      <LinkDropdown href="https://example.com/fast">Fast Link</LinkDropdown>
    )

    const link = screen.getByRole('link', { name: /Fast Link/i })
    fireEvent.click(link, { ctrlKey: true })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/fast')
    expect(screen.queryByText('Open in Workspace')).toBeNull()
  })
})
