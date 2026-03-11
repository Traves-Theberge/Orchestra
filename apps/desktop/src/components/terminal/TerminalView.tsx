import React, { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface TerminalViewProps {
    sessionId: string
    projectId?: string
    baseUrl: string
    onClose?: () => void
    theme?: 'light' | 'dark'
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, projectId, baseUrl, onClose, theme }) => {
    const terminalRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<Terminal | null>(null)
    const wsRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!terminalRef.current) return

        const isDark = theme === 'dark' || document.documentElement.classList.contains('dark')
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 12,
            lineHeight: 1.4,
            letterSpacing: 0.5,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
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
        term.loadAddon(fitAddon)
        term.open(terminalRef.current)
        fitAddon.fit()

        xtermRef.current = term

        // WebSocket connection
        const wsUrl = new URL(baseUrl)
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
        wsUrl.pathname = `/api/v1/terminal/${sessionId}`
        if (projectId) wsUrl.searchParams.set('project_id', projectId)

        const ws = new WebSocket(wsUrl.toString())
        wsRef.current = ws

        ws.onopen = () => {
            term.write('\r\n\x1b[32mCONNECTED TO ORCHESTRA TERMINAL\x1b[0m\r\n')
            // Send initial size
            const { rows, cols } = term
            ws.send(JSON.stringify({ type: 'resize', rows, cols }))
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
            fitAddon.fit()
            const { rows, cols } = term
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', rows, cols }))
            }
        }

        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            ws.close()
            term.dispose()
        }
    }, [sessionId, projectId, baseUrl, theme])

    return (
        <div className="w-full h-full bg-background p-2 rounded-xl border border-border overflow-hidden">
            <div ref={terminalRef} className="w-full h-full" />
        </div>
    )
}
