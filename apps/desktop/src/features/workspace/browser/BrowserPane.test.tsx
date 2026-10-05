import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { BrowserPane } from './BrowserPane'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  resetAppStore()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
})

function renderBrowser() {
  const setBrowserHomepage = vi.fn()
  const openBrowserTab = vi.fn()
  useAppStore.setState({
    browserTabs: [{
      id: 'browser-a', url: 'https://example.test/path', title: 'Fixture page', loading: false,
      canGoBack: false, canGoForward: false, projectId: 'project-a',
    }],
    activeBrowserTabId: 'browser-a',
    setBrowserHomepage,
    openBrowserTab,
  })
  render(<><BrowserPane /><button>Outside browser menu</button></>)
  return { setBrowserHomepage, openBrowserTab }
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Browser options' }))
}

describe('BrowserPane action menu walkthrough', () => {
  it('sets the selected fixture URL as homepage, then closes', () => {
    const { setBrowserHomepage } = renderBrowser()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Set as homepage' }))
    expect(setBrowserHomepage).toHaveBeenCalledExactlyOnceWith('https://example.test/path')
    expect(screen.queryByText('Set as homepage')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browser options' })).toHaveFocus()
  })

  it('opens page source using the active tab workspace identity', () => {
    const { openBrowserTab } = renderBrowser()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'View page source' }))
    expect(openBrowserTab).toHaveBeenCalledExactlyOnceWith('view-source:https://example.test/path', 'project-a')
    expect(screen.queryByText('View page source')).not.toBeInTheDocument()
  })

  it('copies only the active tab URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderBrowser()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://example.test/path')
    expect(screen.queryByText('Copy URL')).not.toBeInTheDocument()
  })

  it('dismisses on Escape or outside click without changing browser state', () => {
    const { setBrowserHomepage, openBrowserTab } = renderBrowser()
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Set as homepage')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browser options' })).toHaveFocus()
    expect(setBrowserHomepage).not.toHaveBeenCalled()
    expect(openBrowserTab).not.toHaveBeenCalled()

    openMenu()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside browser menu' }))
    expect(screen.queryByText('Set as homepage')).not.toBeInTheDocument()
    expect(setBrowserHomepage).not.toHaveBeenCalled()
    expect(openBrowserTab).not.toHaveBeenCalled()
  })

  it('clears only the active webview session through the host API and reloads that view', () => {
    renderBrowser()
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    const webview = document.querySelector('webview') as (HTMLElement & {
      getWebContents: () => { session: { clearStorageData: () => Promise<void> } }
      reload: () => void
    }) | null
    expect(webview).not.toBeNull()
    webview!.getWebContents = () => ({ session: { clearStorageData } })
    webview!.reload = reload

    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Clear browsing data' }))
    expect(clearStorageData).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.queryByText('Clear browsing data')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browser options' })).toHaveFocus()
  })
})
