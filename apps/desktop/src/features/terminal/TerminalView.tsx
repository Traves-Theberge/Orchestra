import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { TerminalSearch } from './TerminalSearch'
import { ORCHESTRA_FILE_MIME, shellQuote } from '@features/workspace/file-explorer/FileTreeRow'

// Track which sessions have already had their initial command sent,
// so tab switches (unmount+remount) don't re-inject the command.
const sentInitialCommands = new Set<string>()

export function clearInitialCommandTracking(sessionId: string) {
    sentInitialCommands.delete(sessionId)
}

interface TerminalViewProps {
    sessionId: string
    projectId?: string
    cwd?: string
    baseUrl: string
    apiToken?: string
    onClose?: () => void
    initialCommand?: string
    theme?: 'light' | 'dark'
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, projectId, cwd, baseUrl, apiToken, onClose: _onClose, initialCommand, theme }) => {
    const terminalRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const searchAddonRef = useRef<SearchAddon | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const [searchOpen, setSearchOpen] = useState(false)
    const [isDropTarget, setIsDropTarget] = useState(false)

    useEffect(() => {
        if (!terminalRef.current) return

        const isDark = theme === 'dark' || document.documentElement.classList.contains('dark')
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            lineHeight: 1.0,
            letterSpacing: 0,
            fontFamily: '"CaskaydiaMono Nerd Font", "CaskaydiaMono NFM", "JetBrainsMono Nerd Font Mono", Menlo, Monaco, Consolas, monospace',
            theme: {
                background: isDark ? '#0a0a0b' : '#f8fafc',
                foreground: isDark ? '#ffffff' : '#0f172a',
                cursor: isDark ? 'hsl(161, 72%, 45%)' : 'hsl(161, 72%, 38%)',
                selectionBackground: isDark ? 'rgba(161, 72%, 45%, 0.3)' : 'rgba(161, 72%, 38%, 0.2)',
                black: '#000000',
                red: '#ef4444',
                green: '#10b981',
                yellow: '#f59e0b',
                blue: '#3b82f6',
                magenta: '#8b5cf6',
                cyan: '#06b6d4',
                white: '#ffffff',
                brightBlack: '#475569',
                brightRed: '#f87171',
                brightGreen: '#34d399',
                brightYellow: '#fbbf24',
                brightBlue: '#60a5fa',
                brightMagenta: '#a78bfa',
                brightCyan: '#22d3ee',
                brightWhite: '#f1f5f9',
            }
        })

        const fitAddon = new FitAddon()
        fitAddonRef.current = fitAddon
        term.loadAddon(fitAddon)

        const searchAddon = new SearchAddon()
        searchAddonRef.current = searchAddon
        term.loadAddon(searchAddon)

        term.open(terminalRef.current)
        // Single fit after layout has settled. A single delayed fit is enough —
        // a double-fit causes two PTY resize events which makes Ink-based TUIs
        // (like 8gent) emit ghost artifacts from the intermediate redraw.
        setTimeout(() => { try { fitAddon.fit() } catch { /* container may have zero dimensions */ } }, 150)

        xtermRef.current = term

        // WebSocket connection
        const wsUrl = new URL(baseUrl)
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
        wsUrl.pathname = `/api/v1/terminal/${sessionId}`
        if (projectId) wsUrl.searchParams.set('project_id', projectId)
        if (cwd) wsUrl.searchParams.set('cwd', cwd)
        if (apiToken && apiToken.trim() !== '') wsUrl.searchParams.set('token', apiToken.trim())

        const ws = new WebSocket(wsUrl.toString())
        wsRef.current = ws

        ws.onopen = () => {
            term.write('\r\n\x1b[32mCONNECTED TO ORCHESTRA TERMINAL\x1b[0m\r\n')
            // Send initial size
            const { rows, cols } = term
            ws.send(JSON.stringify({ type: 'resize', rows, cols }))
            // Run initial command if provided (e.g. launching an agent)
            // Only send once per session — prevents re-injection on tab switch remount.
            if (initialCommand && !sentInitialCommands.has(sessionId)) {
                sentInitialCommands.add(sessionId)
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(initialCommand + '\n')
                    }
                }, 500)
            }
        }

        ws.onmessage = async (event) => {
            if (event.data instanceof Blob) {
                const text = await event.data.text()
                term.write(text)
            } else {
                term.write(event.data)
            }
        }

        ws.onclose = () => {
            term.write('\r\n\x1b[31mDISCONNECTED FROM BACKEND\x1b[0m\r\n')
        }

        term.onData(data => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data)
            }
        })

        const handleResize = () => {
            try {
                fitAddon.fit()
                const { rows, cols } = term
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'resize', rows, cols }))
                }
            } catch { /* intentionally empty */ }
        }

        // ResizeObserver for mosaic pane resizing — debounced to avoid
        // rapid sequential resize events which cause Ink TUI ghost artifacts.
        let resizeDebounce: ReturnType<typeof setTimeout> | null = null
        const resizeObserver = new ResizeObserver(() => {
            if (resizeDebounce) clearTimeout(resizeDebounce)
            resizeDebounce = setTimeout(handleResize, 80)
        })
        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current)
        }

        // IntersectionObserver to re-fit when terminal becomes visible again.
        // Single rAF is not enough — layout hasn't settled yet. Chain two rAFs
        // then a 50ms timeout so the containing flex/grid has measured correctly.
        let revealDebounce: ReturnType<typeof setTimeout> | null = null
        const intersectionObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                if (revealDebounce) clearTimeout(revealDebounce)
                revealDebounce = setTimeout(() => {
                    requestAnimationFrame(() => requestAnimationFrame(handleResize))
                }, 50)
            }
        })
        if (terminalRef.current) {
            intersectionObserver.observe(terminalRef.current)
        }

        // Also re-fit when the document becomes visible (tab switch back)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (revealDebounce) clearTimeout(revealDebounce)
                revealDebounce = setTimeout(() => {
                    requestAnimationFrame(() => requestAnimationFrame(handleResize))
                }, 50)
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            if (resizeDebounce) clearTimeout(resizeDebounce)
            if (revealDebounce) clearTimeout(revealDebounce)
            resizeObserver.disconnect()
            intersectionObserver.disconnect()
            ws.close()
            term.dispose()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, projectId, cwd, baseUrl, apiToken, theme])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault()
                setSearchOpen(true)
            }
        }
        const container = terminalRef.current
        container?.addEventListener('keydown', handleKeyDown)
        return () => container?.removeEventListener('keydown', handleKeyDown)
    }, [])

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
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        // Send a leading space so the path is appended after whatever the user
        // has typed without gluing it to the previous token. Trailing space
        // makes it easy to keep typing additional args.
        ws.send(' ' + toInsert + ' ')
        xtermRef.current?.focus()
    }

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropTarget(false)
    }

    return (
        <div
            className="w-full h-full overflow-hidden"
            style={{ background: theme === 'light' ? '#f8fafc' : '#0a0a0b' }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="relative h-full pl-3 pt-2">
                <div ref={terminalRef} className="w-full h-full" />
                {isDropTarget && (
                    <div className="pointer-events-none absolute inset-0 ring-2 ring-primary/60 ring-inset rounded-sm bg-primary/[0.04]" />
                )}
                {searchOpen && (
                    <TerminalSearch
                        searchAddon={searchAddonRef.current}
                        onClose={() => setSearchOpen(false)}
                    />
                )}
            </div>
        </div>
    )
}
