import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '@core/store'
import { ArrowLeft, ArrowRight, RotateCw, Crosshair } from 'lucide-react'
import { useGrabMode } from './use-grab-mode'
import { GrabConfirmation } from './GrabConfirmation'
import { formatGrabPayload } from './grab-format'
import type { BrowserTab } from '@core/store/types'

/**
 * Electron webview element type.
 */
type WebviewElement = HTMLElement & {
  src: string
  getTitle: () => string
  getURL: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  addEventListener: HTMLElement['addEventListener']
  removeEventListener: HTMLElement['removeEventListener']
}

interface BrowserContentProps {
  tab: BrowserTab
}

export function BrowserContent({ tab }: BrowserContentProps) {
  const updateBrowserTab = useAppStore((s) => s.updateBrowserTab)

  const webviewRef = useRef<WebviewElement | null>(null)
  const [urlInput, setUrlInput] = useState(tab.url)
  const { grabState, lastPayload, armGrab, handleConsoleMessage, resetGrab } = useGrabMode()

  // Sync URL input with tab
  useEffect(() => {
    setUrlInput(tab.url)
  }, [tab.id, tab.url])

  // Navigate
  const navigate = useCallback(
    (url: string) => {
      let fullUrl = url
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        fullUrl = `https://${url}`
      }
      if (webviewRef.current) {
        webviewRef.current.src = fullUrl
      }
      updateBrowserTab(tab.id, { url: fullUrl, loading: true })
    },
    [tab.id, updateBrowserTab],
  )

  // Webview event handlers
  const handleDomReady = useCallback(() => {
    if (!webviewRef.current) return
    const wv = webviewRef.current
    updateBrowserTab(tab.id, {
      title: wv.getTitle?.() || tab.url,
      url: wv.getURL?.() || tab.url,
      loading: false,
      canGoBack: wv.canGoBack?.() || false,
      canGoForward: wv.canGoForward?.() || false,
    })
  }, [tab.id, tab.url, updateBrowserTab])

  const handleDidNavigate = useCallback(() => {
    if (!webviewRef.current) return
    const wv = webviewRef.current
    updateBrowserTab(tab.id, {
      url: wv.getURL?.() || tab.url,
      title: wv.getTitle?.() || tab.url,
      loading: false,
      canGoBack: wv.canGoBack?.() || false,
      canGoForward: wv.canGoForward?.() || false,
    })
  }, [tab.id, tab.url, updateBrowserTab])

  const handleDidStartLoading = useCallback(() => {
    updateBrowserTab(tab.id, { loading: true })
  }, [tab.id, updateBrowserTab])

  // Attach / detach webview listeners
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    wv.addEventListener('dom-ready', handleDomReady)
    wv.addEventListener('did-navigate', handleDidNavigate)
    wv.addEventListener('did-navigate-in-page', handleDidNavigate)
    wv.addEventListener('did-start-loading', handleDidStartLoading)

    return () => {
      wv.removeEventListener('dom-ready', handleDomReady)
      wv.removeEventListener('did-navigate', handleDidNavigate)
      wv.removeEventListener('did-navigate-in-page', handleDidNavigate)
      wv.removeEventListener('did-start-loading', handleDidStartLoading)
    }
  }, [tab.id, handleDomReady, handleDidNavigate, handleDidStartLoading])

  // Listen for grab mode console messages
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    wv.addEventListener('console-message', handleConsoleMessage)
    return () => wv.removeEventListener('console-message', handleConsoleMessage)
  }, [tab.id, handleConsoleMessage])

  return (
    <div className="flex flex-col h-full">
      {/* Navigation bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 shrink-0">
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!tab.canGoBack}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!tab.canGoForward}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowRight size={14} />
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          className="p-1 rounded text-muted-foreground hover:text-foreground"
        >
          <RotateCw size={14} className={tab.loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => armGrab(webviewRef.current)}
          className={`p-1 rounded ${grabState === 'armed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Grab element (click to capture)"
        >
          <Crosshair size={14} />
        </button>
        <form
          className="flex-1 mx-1"
          onSubmit={(e) => {
            if (urlInput) {
              e.preventDefault()
              navigate(urlInput)
            }
          }}
        >
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-background border border-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-primary"
            placeholder="Enter URL..."
          />
        </form>
      </div>

      {/* Webview */}
      <div className="flex-1 min-h-0 relative">
        {/* eslint-disable-next-line react/no-unknown-property -- Electron <webview> attributes */}
        <webview
          ref={webviewRef as React.RefObject<never>}
          src={tab.url}
          className="w-full h-full"
          partition="persist:orchestra-browser"
          allowpopups={true}
        />
        {grabState === 'captured' && lastPayload && (
          <GrabConfirmation
            payload={lastPayload}
            onCopy={() => {
              navigator.clipboard.writeText(formatGrabPayload(lastPayload))
              resetGrab()
            }}
            onSendToAgent={() => {
              window.dispatchEvent(new CustomEvent('orchestra-grab-to-agent', {
                detail: { text: formatGrabPayload(lastPayload) }
              }))
              resetGrab()
            }}
            onDismiss={resetGrab}
          />
        )}
      </div>
    </div>
  )
}
