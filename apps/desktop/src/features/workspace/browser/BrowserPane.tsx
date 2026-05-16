import { useRef, useEffect, useCallback, useState } from 'react'
import { useAppStore } from '@core/store'
import { ArrowLeft, ArrowRight, RotateCw, Globe, X, Plus, Crosshair, ExternalLink, Lock, Search, Maximize2, Minimize2, MoreHorizontal, Copy, Home, Code2, Trash2 } from 'lucide-react'
import { useGrabMode } from './use-grab-mode'
import { GrabConfirmation } from './GrabConfirmation'
import { formatGrabPayload } from './grab-format'

/**
 * Electron webview element type — not part of standard HTMLElement typings.
 * We cast through `any` when accessing webview-specific APIs.
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

export function BrowserPane() {
  const browserTabs = useAppStore((s) => s.browserTabs)
  const activeBrowserTabId = useAppStore((s) => s.activeBrowserTabId)
  const updateBrowserTab = useAppStore((s) => s.updateBrowserTab)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab)
  const setActiveBrowserTab = useAppStore((s) => s.setActiveBrowserTab)
  const setBrowserHomepage = useAppStore((s) => s.setBrowserHomepage)

  const activeTab = browserTabs.find((t) => t.id === activeBrowserTabId)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { grabState, lastPayload, armGrab, handleConsoleMessage, resetGrab } = useGrabMode()

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  // Sync URL input with active tab
  useEffect(() => {
    if (activeTab) setUrlInput(activeTab.url)
  }, [activeTab?.id, activeTab?.url])

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
      if (activeTab) {
        updateBrowserTab(activeTab.id, { url: fullUrl, loading: true })
      }
    },
    [activeTab, updateBrowserTab],
  )

  // Webview event handlers
  const handleDomReady = useCallback(() => {
    if (!webviewRef.current || !activeTab) return
    const wv = webviewRef.current
    updateBrowserTab(activeTab.id, {
      title: wv.getTitle?.() || activeTab.url,
      url: wv.getURL?.() || activeTab.url,
      loading: false,
      canGoBack: wv.canGoBack?.() || false,
      canGoForward: wv.canGoForward?.() || false,
    })
  }, [activeTab?.id, updateBrowserTab])

  const handleDidNavigate = useCallback(() => {
    if (!webviewRef.current || !activeTab) return
    const wv = webviewRef.current
    updateBrowserTab(activeTab.id, {
      url: wv.getURL?.() || activeTab.url,
      title: wv.getTitle?.() || activeTab.url,
      loading: false,
      canGoBack: wv.canGoBack?.() || false,
      canGoForward: wv.canGoForward?.() || false,
    })
  }, [activeTab?.id, updateBrowserTab])

  const handleDidStartLoading = useCallback(() => {
    if (activeTab) {
      updateBrowserTab(activeTab.id, { loading: true })
    }
  }, [activeTab?.id, updateBrowserTab])

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
  }, [activeTab?.id, handleDomReady, handleDidNavigate, handleDidStartLoading])

  // Listen for grab mode console messages from webview
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    wv.addEventListener('console-message', handleConsoleMessage)
    return () => wv.removeEventListener('console-message', handleConsoleMessage)
  }, [activeTab?.id, handleConsoleMessage])

  if (browserTabs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Globe size={48} className="opacity-30" />
        <p className="text-sm">No browser tabs open</p>
        <button
          onClick={() => openBrowserTab('http://localhost:5173')}
          className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent/80 text-accent-foreground"
        >
          Open localhost:5173
        </button>
      </div>
    )
  }

  return (
    <div className={maximized ? 'fixed inset-0 z-50 flex flex-col bg-background' : 'flex flex-col h-full'}>
      {/* Tab strip — Chrome/Orca-style rounded chips with clear active state */}
      <div className="flex items-end gap-1 px-2 pt-2 bg-muted/15 border-b border-border/40 overflow-x-auto">
        {browserTabs.map((tab) => {
          const isActive = tab.id === activeBrowserTabId
          return (
            <button
              key={tab.id}
              onClick={() => setActiveBrowserTab(tab.id)}
              className={`group relative inline-flex items-center gap-2 px-3 h-9 min-w-[140px] max-w-[220px] shrink-0 rounded-t-lg transition-all ${
                isActive
                  ? 'bg-background text-foreground shadow-[0_-1px_0_var(--border)] border-x border-t border-border/50'
                  : 'text-muted-foreground/75 hover:text-foreground bg-foreground/[0.03] hover:bg-foreground/[0.06]'
              }`}
            >
              {tab.loading ? (
                <RotateCw size={12} className="text-primary shrink-0 animate-spin" strokeWidth={2.25} />
              ) : (
                <Globe size={12} className={isActive ? 'text-primary shrink-0' : 'text-muted-foreground/60 shrink-0'} strokeWidth={isActive ? 2.25 : 2} />
              )}
              <span className="text-[12px] font-medium tracking-tight truncate flex-1 text-left">{tab.title || 'New tab'}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  closeBrowserTab(tab.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    closeBrowserTab(tab.id)
                  }
                }}
                className="inline-flex items-center justify-center size-5 -mr-1 rounded-full text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-foreground/[0.10] transition-all shrink-0"
              >
                <X size={11} />
              </span>
            </button>
          )
        })}
        <button
          onClick={() => openBrowserTab()}
          className="inline-flex items-center justify-center size-8 mb-0.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.06] transition-colors shrink-0"
          title="New tab"
        >
          <Plus size={14} strokeWidth={2.25} />
        </button>
      </div>

      {/* Navigation bar — taller pill-style URL input, clearer iconography */}
      <div className="flex items-center gap-1.5 px-3 h-11 border-b border-border/40 bg-background">
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!activeTab?.canGoBack}
          className="grid place-items-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
          title="Back"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!activeTab?.canGoForward}
          className="grid place-items-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
          title="Forward"
        >
          <ArrowRight size={16} strokeWidth={2} />
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          className="grid place-items-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          title="Reload"
        >
          <RotateCw size={15} strokeWidth={2} className={activeTab?.loading ? 'animate-spin' : ''} />
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
          <div className="relative flex items-center h-8 rounded-full bg-muted/40 border border-border/40 hover:bg-muted/60 focus-within:bg-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all">
            <span className="grid place-items-center size-8 text-muted-foreground/70 shrink-0">
              {activeTab?.url?.startsWith('https://') ? (
                <Lock size={11.5} strokeWidth={2.25} className="text-emerald-500/85" />
              ) : (
                <Search size={12} strokeWidth={2.25} />
              )}
            </span>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-transparent text-[12px] text-foreground outline-none pr-3 truncate"
              placeholder="Search or enter URL"
              spellCheck={false}
              aria-label="Address bar"
            />
          </div>
        </form>

        <button
          onClick={() => armGrab(webviewRef.current)}
          className={`grid place-items-center size-8 rounded-full transition-colors ${
            grabState === 'armed'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]'
          }`}
          title="Grab element"
        >
          <Crosshair size={15} strokeWidth={2} />
        </button>
        <button
          onClick={() => {
            const url = activeTab?.url
            if (!url) return
            const bridge = (window as { orchestraDesktop?: { openExternal?: (u: string) => void } }).orchestraDesktop
            if (bridge?.openExternal) bridge.openExternal(url)
            else window.open(url, '_blank')
          }}
          className="grid place-items-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          title="Open in system browser"
        >
          <ExternalLink size={14} strokeWidth={2} />
        </button>
        <button
          onClick={() => setMaximized((m) => !m)}
          className="grid place-items-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          title={maximized ? 'Restore browser pane' : 'Fullscreen browser pane'}
        >
          {maximized ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
        </button>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`grid place-items-center size-8 rounded-full transition-colors ${
              menuOpen ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]'
            }`}
            title="More options"
          >
            <MoreHorizontal size={15} strokeWidth={2} />
          </button>
          {menuOpen && activeTab && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-border/60 bg-popover shadow-xl py-1">
              <BrowserMenuItem
                icon={<Copy size={13} />}
                label="Copy URL"
                onClick={() => {
                  if (activeTab.url) navigator.clipboard.writeText(activeTab.url)
                  setMenuOpen(false)
                }}
              />
              <BrowserMenuItem
                icon={<Home size={13} />}
                label="Set as homepage"
                onClick={() => {
                  if (activeTab.url) setBrowserHomepage(activeTab.url)
                  setMenuOpen(false)
                }}
              />
              <BrowserMenuItem
                icon={<Code2 size={13} />}
                label="View page source"
                onClick={() => {
                  if (activeTab.url && !activeTab.url.startsWith('view-source:')) {
                    openBrowserTab(`view-source:${activeTab.url}`, activeTab.projectId)
                  }
                  setMenuOpen(false)
                }}
              />
              <div className="my-1 border-t border-border/40" />
              <BrowserMenuItem
                icon={<Trash2 size={13} />}
                label="Clear browsing data"
                destructive
                onClick={() => {
                  const wv = webviewRef.current as unknown as { getWebContentsId?: () => number; reload?: () => void } | null
                  // electron webview can clear via session.clearStorageData; fallback: reload
                  try {
                    const ses = (wv as { getWebContents?: () => { session?: { clearStorageData?: () => Promise<void> } } } | null)?.getWebContents?.()?.session
                    if (ses && typeof ses.clearStorageData === 'function') {
                      void ses.clearStorageData()
                    }
                  } catch { /* ignore — best-effort */ }
                  wv?.reload?.()
                  setMenuOpen(false)
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Webview */}
      <div className="flex-1 min-h-0 relative">
        {activeTab && (
          // eslint-disable-next-line react/no-unknown-property -- Electron <webview> attributes
          <webview
            ref={webviewRef as React.RefObject<never>}
            src={activeTab.url}
            className="w-full h-full"
            partition="persist:orchestra-browser"
            allowpopups={true}
          />
        )}
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

function BrowserMenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors ${
        destructive
          ? 'text-red-400/85 hover:bg-red-500/10 hover:text-red-400'
          : 'text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground'
      }`}
    >
      <span className={destructive ? 'text-red-400/70' : 'text-muted-foreground/70'}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
