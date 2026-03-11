import React, { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface TerminalViewProps {
    sessionId: string
    projectId?: string
    baseUrl: string
    onClose?: () => void
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, projectId, baseUrl, onClose }) => {
    const terminalRef = useRef<HTMLDivElement>(null)
    const xtermRef = useRef<Terminal | null>(null)
    const wsRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!terminalRef.current) return

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 12,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
            theme: {
                background: '#0c0c0e',
                foreground: '#ffffff',
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
    }, [sessionId, projectId, baseUrl])

    return (
        <div className="w-full h-full bg-[#0c0c0e] p-2 rounded-xl border border-white/5 overflow-hidden">
            <div ref={terminalRef} className="w-full h-full" />
        </div>
    )
}
