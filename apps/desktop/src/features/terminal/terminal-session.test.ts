import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- fakes ----------------------------------------------------------------

const h = vi.hoisted(() => {
    class Emitter<T> {
        listeners: Array<(v: T) => void> = []
        event = (fn: (v: T) => void) => { this.listeners.push(fn); return { dispose: () => {} } }
        fire(v: T) { this.listeners.forEach(l => l(v)) }
    }
    class FakeTerminal {
        static instances: FakeTerminal[] = []
        cols = 80
        rows = 24
        options: Record<string, unknown> = {}
        unicode = { activeVersion: '6' }
        buffer = { active: { viewportY: 0, baseY: 0 } }
        written: Uint8Array[] = []
        notices: string[] = []
        resets = 0
        disposed = false
        keyHandler: ((e: KeyboardEvent) => boolean) | null = null
        data = new Emitter<string>()
        resize = new Emitter<{ cols: number; rows: number }>()
        constructor(opts: Record<string, unknown>) { this.options = { ...opts }; FakeTerminal.instances.push(this) }
        onData = this.data.event
        onBinary = new Emitter<string>().event
        onResize = this.resize.event
        onTitleChange = new Emitter<string>().event
        loadAddon() {}
        open() {}
        write(d: Uint8Array | string) { if (typeof d === 'string') this.notices.push(d); else this.written.push(d) }
        reset() { this.resets++ }
        dispose() { this.disposed = true }
        refresh() {}
        focus() {}
        hasSelection() { return false }
        getSelection() { return '' }
        clearSelection() {}
        selectAll() {}
        clear() {}
        paste() {}
        scrollToBottom() {}
        scrollToTop() {}
        scrollToLine() {}
        attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { this.keyHandler = fn }
    }
    class FakeWebSocket {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3
        static instances: FakeWebSocket[] = []
        readyState = 0
        binaryType = ''
        sent: Array<string | Uint8Array> = []
        onopen: (() => void) | null = null
        onmessage: ((e: { data: unknown }) => void) | null = null
        onclose: ((e: { code: number }) => void) | null = null
        closed = false
        constructor(public url: string) { FakeWebSocket.instances.push(this) }
        send(d: string | Uint8Array) { this.sent.push(d) }
        close() { this.closed = true; this.readyState = 3 }
        open() { this.readyState = 1; this.onopen?.() }
        message(d: string | Uint8Array) { this.onmessage?.({ data: d instanceof Uint8Array ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d }) }
        drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
    }
    const state = { webglThrows: false }
    return { FakeTerminal, FakeWebSocket, state }
})

vi.mock('@xterm/xterm', () => ({ Terminal: h.FakeTerminal }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 100, rows: 30 } } fit() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
    WebglAddon: class {
        constructor() { if (h.state.webglThrows) throw new Error('no webgl') }
        onContextLoss() { return { dispose() {} } }
        dispose() {}
    },
}))

import {
    PARKED_ORPHAN_TTL_MS,
    INITIAL_COMMAND_DELAY_MS,
    acquireTerminalSession,
    buildTerminalUrl,
    clearInitialCommandTracking,
    disposeAllTerminalSessions,
    disposeTerminalSession,
    parkTerminalSession,
    pruneParkedSessions,
    setTerminalRetention,
} from './terminal-session'

const config = (over: Partial<Parameters<typeof acquireTerminalSession>[0]> = {}) => ({
    sessionId: 's1', baseUrl: 'http://127.0.0.1:4010', mode: 'dark' as const, ...over,
})
const lastWs = () => h.FakeWebSocket.instances[h.FakeWebSocket.instances.length - 1]
const flushFrames = () => vi.advanceTimersByTime(100)

describe('terminal session registry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('WebSocket', h.FakeWebSocket)
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
        h.FakeTerminal.instances.length = 0
        h.FakeWebSocket.instances.length = 0
        h.state.webglThrows = false
        setTerminalRetention(() => false)
        clearInitialCommandTracking('s1')
    })
    afterEach(() => {
        disposeAllTerminalSessions()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('builds the websocket url from project, cwd and token', () => {
        expect(buildTerminalUrl({ sessionId: 'a b', baseUrl: 'https://x.test:1', projectId: 'p', cwd: 'C:\\w', apiToken: ' t ' }))
            .toBe('wss://x.test:1/api/v1/terminal/a%20b?project_id=p&cwd=C%3A%5Cw&token=t')
        expect(buildTerminalUrl({ sessionId: 's', baseUrl: 'http://127.0.0.1:4010' })).toBe('ws://127.0.0.1:4010/api/v1/terminal/s')
    })

    it('reuses one terminal and socket across detach/attach (tab switch keeps scrollback)', () => {
        const hostA = document.createElement('div')
        const s1 = acquireTerminalSession(config())
        s1.attach(hostA)
        lastWs().open()
        s1.detach()
        parkTerminalSession('s1')
        expect(hostA.contains(s1.element)).toBe(false)
        const s2 = acquireTerminalSession(config())
        const hostB = document.createElement('div')
        s2.attach(hostB)
        expect(s2).toBe(s1)
        expect(hostB.contains(s2.element)).toBe(true)
        expect(h.FakeTerminal.instances).toHaveLength(1)
        expect(h.FakeWebSocket.instances).toHaveLength(1)
        expect(lastWs().closed).toBe(false)
    })

    it('replaces the session only when the connection identity changes', () => {
        const a = acquireTerminalSession(config())
        expect(acquireTerminalSession(config({ cwd: '/elsewhere' }))).toBe(a)
        const b = acquireTerminalSession(config({ apiToken: 'new' }))
        expect(b).not.toBe(a)
        expect(h.FakeTerminal.instances[0].disposed).toBe(true)
    })

    it('uses binary frames, activates unicode 11 and sends the grid size on open', () => {
        acquireTerminalSession(config())
        const ws = lastWs()
        expect(ws.binaryType).toBe('arraybuffer')
        expect(h.FakeTerminal.instances[0].unicode.activeVersion).toBe('11')
        ws.open()
        expect(JSON.parse(ws.sent[0] as string)).toEqual({ type: 'resize', rows: 24, cols: 80 })
    })

    it('preserves output order and batches frames into one write', () => {
        acquireTerminalSession(config())
        const ws = lastWs()
        ws.open()
        ws.message(new TextEncoder().encode('he'))
        ws.message('llo ')
        ws.message(new TextEncoder().encode('world'))
        flushFrames()
        const term = h.FakeTerminal.instances[0]
        expect(term.written).toHaveLength(1)
        expect(new TextDecoder().decode(term.written[0])).toBe('hello world')
    })

    it('injects the initial command exactly once per session id, surviving remounts and reconnects', () => {
        const s = acquireTerminalSession(config({ initialCommand: 'claude' }))
        const ws = lastWs()
        ws.open()
        vi.advanceTimersByTime(INITIAL_COMMAND_DELAY_MS + 1)
        expect(ws.sent).toContain('claude\n')

        // reconnect: no second injection
        ws.drop(1006)
        vi.advanceTimersByTime(600)
        const ws2 = lastWs()
        expect(ws2).not.toBe(ws)
        ws2.open()
        vi.advanceTimersByTime(INITIAL_COMMAND_DELAY_MS + 1)
        expect(ws2.sent).not.toContain('claude\n')
        expect(s.config.sessionId).toBe('s1')
    })

    it('re-injects only after the terminal is closed (forget)', () => {
        acquireTerminalSession(config({ initialCommand: 'codex' }))
        lastWs().open()
        vi.advanceTimersByTime(INITIAL_COMMAND_DELAY_MS + 1)
        disposeTerminalSession('s1', { forget: true })
        acquireTerminalSession(config({ initialCommand: 'codex' }))
        const ws = lastWs()
        ws.open()
        vi.advanceTimersByTime(INITIAL_COMMAND_DELAY_MS + 1)
        expect(ws.sent).toContain('codex\n')
    })

    it('reconnects after an abnormal close, resetting the screen before the log replay', () => {
        acquireTerminalSession(config())
        const ws = lastWs()
        ws.open()
        ws.drop(1006)
        const term = h.FakeTerminal.instances[0]
        expect(term.notices.join('')).toContain('reconnecting')
        vi.advanceTimersByTime(600)
        const ws2 = lastWs()
        expect(ws2).not.toBe(ws)
        ws2.open()
        expect(term.resets).toBe(1)
        expect(JSON.parse(ws2.sent[0] as string)).toMatchObject({ type: 'resize' })
    })

    it('shows a disconnect notice instead of retrying when the upgrade is rejected', () => {
        acquireTerminalSession(config())
        lastWs().drop(1006)
        vi.advanceTimersByTime(60_000)
        expect(h.FakeWebSocket.instances).toHaveLength(1)
        expect(h.FakeTerminal.instances[0].notices.join('')).toContain('DISCONNECTED')
    })

    it('buffers keystrokes typed before the socket opens', () => {
        acquireTerminalSession(config())
        const term = h.FakeTerminal.instances[0]
        term.data.fire('ls')
        term.data.fire('\r')
        const ws = lastWs()
        ws.open()
        expect(ws.sent).toContain('ls\r')
    })

    it('encodes Shift+Enter for agent TUIs and lets plain keys through', () => {
        acquireTerminalSession(config())
        const ws = lastWs()
        ws.open()
        const handler = h.FakeTerminal.instances[0].keyHandler!
        const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })
        expect(handler(shiftEnter)).toBe(false)
        expect(shiftEnter.defaultPrevented).toBe(true)
        expect(ws.sent).toContain('\x1b\r')
        expect(handler(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true)
        expect(handler(new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true }))).toBe(true)
    })

    it('falls back to the DOM renderer when WebGL is unavailable', () => {
        h.state.webglThrows = true
        const s = acquireTerminalSession(config())
        s.attach(document.createElement('div'))
        expect(s.rendererName).toBe('dom')
    })

    it('uses WebGL when available and releases it while parked', () => {
        const s = acquireTerminalSession(config())
        s.attach(document.createElement('div'))
        expect(s.rendererName).toBe('webgl')
        s.detach()
        expect(s.rendererName).toBe('dom')
        s.attach(document.createElement('div'))
        expect(s.rendererName).toBe('webgl')
    })

    it('expires parked sessions that are no longer tracked, but keeps tracked tabs', () => {
        const orphan = acquireTerminalSession(config({ sessionId: 'issue-1' }))
        const tab = acquireTerminalSession(config({ sessionId: 'tab-1' }))
        setTerminalRetention(id => id === 'tab-1')
        orphan.attach(document.createElement('div'))
        tab.attach(document.createElement('div'))
        parkTerminalSession('issue-1')
        parkTerminalSession('tab-1')
        pruneParkedSessions(Date.now() + PARKED_ORPHAN_TTL_MS + 1)
        expect(h.FakeTerminal.instances.filter(t => t.disposed)).toHaveLength(1)
        expect(acquireTerminalSession(config({ sessionId: 'tab-1' }))).toBe(tab)
    })

    it('disposing a session closes its socket and terminal', () => {
        acquireTerminalSession(config())
        const ws = lastWs()
        ws.open()
        disposeTerminalSession('s1')
        expect(ws.closed).toBe(true)
        expect(h.FakeTerminal.instances[0].disposed).toBe(true)
    })
})
