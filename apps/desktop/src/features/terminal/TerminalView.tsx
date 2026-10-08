import React, { useEffect, useRef, useState } from 'react'
import { TerminalSearch } from './TerminalSearch'
import { ORCHESTRA_FILE_MIME, shellQuote } from '@features/workspace/file-explorer/FileTreeRow'
import { useAppStore } from '@core/store'
import { terminalBackground, resolveThemeMode, type TerminalThemeMode } from './terminal-options'
import {
    acquireTerminalSession,
    disposeTerminalSession,
    parkTerminalSession,
    setTerminalRetention,
    type TerminalSession,
} from './terminal-session'

// Sessions outlive their views (tab switches keep scrollback); release them when the terminal itself is closed.
setTerminalRetention(id => useAppStore.getState().openTerminals.some(t => t.id === id))
useAppStore.subscribe((state, prev) => {
    if (state.openTerminals === prev.openTerminals) return
    const live = new Set(state.openTerminals.map(t => t.id))
    for (const { id } of prev.openTerminals) {
        if (!live.has(id)) disposeTerminalSession(id, { forget: true })
    }
})

interface TerminalViewProps {
    sessionId: string
    projectId?: string
    cwd?: string
    baseUrl: string
    apiToken?: string
    onClose?: () => void
    initialCommand?: string
    theme?: 'light' | 'dark'
    /** Focus the terminal when it is shown. */
    autoFocus?: boolean
    onSplit?: () => void
    onFocusPane?: (direction: 'next' | 'previous') => void
    onTitleChange?: (title: string) => void
}

/** Follows an explicit theme, else the app's `dark` class on <html> (live, no terminal teardown). */
function useThemeMode(explicit?: TerminalThemeMode): TerminalThemeMode {
    const [observed, setObserved] = useState<TerminalThemeMode>(() => resolveThemeMode())
    useEffect(() => {
        if (explicit) return
        const observer = new MutationObserver(() => setObserved(resolveThemeMode()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [explicit])
    return explicit ?? observed
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, projectId, cwd, baseUrl, apiToken, onClose: _onClose, initialCommand, theme, autoFocus, onSplit, onFocusPane, onTitleChange }) => {
    const hostRef = useRef<HTMLDivElement>(null)
    const sessionRef = useRef<TerminalSession | null>(null)
    const [session, setSession] = useState<TerminalSession | null>(null)
    const [searchOpen, setSearchOpen] = useState(false)
    const [isDropTarget, setIsDropTarget] = useState(false)
    const mode = useThemeMode(theme)
    const modeRef = useRef(mode)
    modeRef.current = mode

    // Latest callbacks without re-attaching the session on every render.
    const callbacks = useRef({ onSplit, onFocusPane, onTitleChange })
    callbacks.current = { onSplit, onFocusPane, onTitleChange }
    const hasSplit = !!onSplit
    const hasFocusPane = !!onFocusPane

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const next = acquireTerminalSession({ sessionId, projectId, cwd, baseUrl, apiToken, initialCommand, mode: modeRef.current })
        next.setMode(modeRef.current)
        next.attach(host, {
            onToggleSearch: () => setSearchOpen(open => !open),
            onSplit: hasSplit ? () => callbacks.current.onSplit?.() : undefined,
            onFocusPane: hasFocusPane ? direction => callbacks.current.onFocusPane?.(direction) : undefined,
            onTitleChange: title => callbacks.current.onTitleChange?.(title),
        })
        sessionRef.current = next
        setSession(next)
        return () => {
            sessionRef.current = null
            setSession(null)
            setSearchOpen(false)
            parkTerminalSession(sessionId)
        }
        // cwd/projectId/initialCommand only matter when a session is first created.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, baseUrl, apiToken, hasSplit, hasFocusPane])

    useEffect(() => {
        session?.setMode(mode)
    }, [session, mode])

    // Also moves keyboard focus when split-pane focus changes via the store.
    useEffect(() => {
        if (autoFocus) session?.focus()
    }, [session, autoFocus])

    const handleDragOver = (e: React.DragEvent) => {
        const types = Array.from(e.dataTransfer.types)
        if (types.includes(ORCHESTRA_FILE_MIME) || types.includes('text/plain')) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
            if (!isDropTarget) setIsDropTarget(true)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDropTarget(false)
        const raw = e.dataTransfer.getData(ORCHESTRA_FILE_MIME)
        let toInsert = ''
        if (raw) {
            try {
                const { path } = JSON.parse(raw) as { path: string }
                toInsert = shellQuote(path)
            } catch {
                /* fall through to plain text */
            }
        }
        if (!toInsert) {
            const plain = e.dataTransfer.getData('text/plain')
            if (!plain) return
            // If the plain payload looks pre-quoted, use as-is; else quote it.
            toInsert = /^['"]/.test(plain) ? plain : shellQuote(plain)
        }
        // Send a leading space so the path is appended after whatever the user
        // has typed without gluing it to the previous token. Trailing space
        // makes it easy to keep typing additional args.
        sessionRef.current?.send(' ' + toInsert + ' ')
        sessionRef.current?.focus()
    }

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropTarget(false)
    }

    return (
        <div
            className="w-full h-full overflow-hidden"
            style={{ background: terminalBackground(mode) }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="relative h-full pl-3 pt-2">
                <div ref={hostRef} className="w-full h-full" />
                {isDropTarget && (
                    <div className="pointer-events-none absolute inset-0 ring-2 ring-primary/60 ring-inset rounded-sm bg-primary/[0.04]" />
                )}
                {searchOpen && session && (
                    <TerminalSearch
                        searchAddon={session.searchAddon}
                        onClose={() => {
                            setSearchOpen(false)
                            session.focus()
                        }}
                    />
                )}
            </div>
        </div>
    )
}
