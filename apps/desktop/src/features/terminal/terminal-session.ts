import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { buildTerminalOptions, buildTerminalTheme, isLocalWindowsPty, minimumContrastFor, type TerminalThemeMode } from './terminal-options'
import { createSizeReporter, createStableFit } from './terminal-fit'
import { createOutputBatcher, type OutputBatcher } from './terminal-output'
import { reconnectDelay, shouldReconnect } from './terminal-reconnect'
import { detectPlatform, resolveTerminalShortcut, type TerminalShortcutAction } from './terminal-shortcuts'

// Track which sessions have already had their initial command sent,
// so tab switches and reconnects don't re-inject the command.
const sentInitialCommands = new Set<string>()

export function clearInitialCommandTracking(sessionId: string) {
    sentInitialCommands.delete(sessionId)
}

/** Delay before injecting the initial command, giving the shell time to print its prompt. */
export const INITIAL_COMMAND_DELAY_MS = 500
/** Keystrokes typed before the socket opens are held (bounded) and flushed on connect. */
const PRECONNECT_INPUT_MAX_CHARS = 64 * 1024
/** Context losses tolerated before the session stays on the DOM renderer. */
const WEBGL_MAX_CONTEXT_LOSSES = 3

export interface TerminalSessionConfig {
    sessionId: string
    projectId?: string
    cwd?: string
    baseUrl: string
    apiToken?: string
    initialCommand?: string
    mode: TerminalThemeMode
}

/** Callbacks owned by whichever view currently hosts the session; swapped on every attach. */
export interface TerminalViewHandlers {
    onToggleSearch?: () => void
    onSplit?: () => void
    onFocusPane?: (direction: 'next' | 'previous') => void
    onTitleChange?: (title: string) => void
}

export function buildTerminalUrl(config: Pick<TerminalSessionConfig, 'sessionId' | 'projectId' | 'cwd' | 'baseUrl' | 'apiToken'>): string {
    const url = new URL(config.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = `/api/v1/terminal/${config.sessionId}`
    if (config.projectId) url.searchParams.set('project_id', config.projectId)
    if (config.cwd) url.searchParams.set('cwd', config.cwd)
    if (config.apiToken && config.apiToken.trim() !== '') url.searchParams.set('token', config.apiToken.trim())
    return url.toString()
}

function openLink(uri: string) {
    if (window.orchestraDesktop?.openExternal) void window.orchestraDesktop.openExternal(uri)
    else window.open(uri, '_blank', 'noopener,noreferrer')
}

const encoder = new TextEncoder()

/**
 * One shell: an xterm instance, its addons and its PTY WebSocket. Outlives React mounts — the view
 * attaches/detaches the persistent element so tab switches keep scrollback and screen state
 * (Orca keeps hidden panes alive the same way).
 */
export class TerminalSession {
    readonly term: Terminal
    readonly fitAddon = new FitAddon()
    readonly searchAddon = new SearchAddon()
    /** Persistent DOM node xterm renders into; moved between hosts. */
    readonly element: HTMLDivElement
    parkedAt: number | null = null

    private webgl: WebglAddon | null = null
    private webglLosses = 0
    private opened = false
    private host: HTMLElement | null = null
    private handlers: TerminalViewHandlers = {}
    private resizeObserver: ResizeObserver | null = null
    private ws: WebSocket | null = null
    private wasOpen = false
    private disposed = false
    private reconnectAttempt = 0
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private initialTimer: ReturnType<typeof setTimeout> | null = null
    private preconnect = ''
    private savedViewportY: number | null = null
    private savedAtBottom = true
    private readonly batcher: OutputBatcher
    private readonly reporter = createSizeReporter(size => this.sendControl({ type: 'resize', rows: size.rows, cols: size.cols }))
    private readonly stableFit = createStableFit({
        propose: () => this.fitAddon.proposeDimensions(),
        current: () => ({ cols: this.term.cols, rows: this.term.rows }),
        fit: () => this.fitNow(),
        isMeasurable: () => this.host !== null && this.host.clientWidth > 0 && this.host.clientHeight > 0,
    })
    private readonly onVisibility = () => {
        if (document.visibilityState === 'visible' && this.host) this.reveal()
    }

    constructor(readonly config: TerminalSessionConfig) {
        this.element = document.createElement('div')
        this.element.className = 'orchestra-terminal-host'
        this.element.style.width = '100%'
        this.element.style.height = '100%'
        this.term = new Terminal(buildTerminalOptions(config.mode, { windowsConpty: isLocalWindowsPty(config.baseUrl) }))
        this.term.loadAddon(this.fitAddon)
        this.term.loadAddon(this.searchAddon)
        this.term.loadAddon(new Unicode11Addon())
        this.term.unicode.activeVersion = '11'
        this.term.loadAddon(new WebLinksAddon((event, uri) => {
            // Require Ctrl/Cmd so a plain click still selects text (Orca's modifier-gated links).
            if (event.ctrlKey || event.metaKey) openLink(uri)
        }))

        this.batcher = createOutputBatcher(data => this.term.write(data))
        this.term.onData(data => this.sendInput(data))
        this.term.onBinary(data => {
            if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(Uint8Array.from(data, c => c.charCodeAt(0)))
        })
        this.term.onResize(size => this.reporter.report(size))
        this.term.onTitleChange(title => this.handlers.onTitleChange?.(title))
        this.term.attachCustomKeyEventHandler(event => this.handleKey(event))
        this.element.addEventListener('contextmenu', this.onContextMenu)
        document.addEventListener('visibilitychange', this.onVisibility)

        this.connect()
    }

    // ---- view attachment -----------------------------------------------------

    attach(host: HTMLElement, handlers: TerminalViewHandlers = {}) {
        if (this.disposed) return
        this.handlers = handlers
        this.host = host
        this.parkedAt = null
        host.appendChild(this.element)
        if (!this.opened) {
            // Unicode widths must be active before the first write; the addon was activated in the constructor.
            this.term.open(this.element)
            this.opened = true
        }
        this.attachWebgl()
        this.fitNow()
        this.resizeObserver = new ResizeObserver(() => this.stableFit.request())
        this.resizeObserver.observe(host)
        this.reveal()
    }

    /** Remove from the DOM but keep the shell, buffer and socket alive. */
    detach() {
        if (!this.host) return
        this.captureViewport()
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        this.stableFit.cancel()
        this.disposeWebgl()
        this.element.remove()
        this.host = null
        this.handlers = {}
        this.parkedAt = Date.now()
    }

    focus() {
        this.term.focus()
    }

    setMode(mode: TerminalThemeMode) {
        this.term.options.theme = buildTerminalTheme(mode)
        this.term.options.minimumContrastRatio = minimumContrastFor(mode)
    }

    /** Write text straight to the shell (drag-and-drop paths, programmatic input). */
    send(text: string) {
        this.sendInput(text)
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        document.removeEventListener('visibilitychange', this.onVisibility)
        this.element.removeEventListener('contextmenu', this.onContextMenu)
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        if (this.initialTimer) clearTimeout(this.initialTimer)
        this.resizeObserver?.disconnect()
        this.stableFit.cancel()
        this.batcher.dispose()
        this.closeSocket()
        this.disposeWebgl()
        this.term.dispose()
        this.element.remove()
        this.host = null
    }

    // ---- sizing / rendering --------------------------------------------------

    private fitNow() {
        if (!this.opened || !this.host || this.host.clientWidth === 0 || this.host.clientHeight === 0) return
        try {
            this.fitAddon.fit()
        } catch { /* container may be mid-layout */ }
    }

    /** Re-present after becoming visible: refit once the layout settled, repaint, restore scroll. */
    private reveal() {
        this.stableFit.request()
        requestAnimationFrame(() => {
            if (this.disposed || !this.host) return
            this.restoreViewport()
            try { this.term.refresh(0, this.term.rows - 1) } catch { /* disposed */ }
        })
    }

    private captureViewport() {
        const buffer = this.term.buffer.active
        this.savedViewportY = buffer.viewportY
        this.savedAtBottom = buffer.viewportY >= buffer.baseY
    }

    private restoreViewport() {
        if (this.savedViewportY === null) return
        if (this.savedAtBottom) this.term.scrollToBottom()
        else this.term.scrollToLine(this.savedViewportY)
        this.savedViewportY = null
    }

    private attachWebgl() {
        if (this.webgl || this.webglLosses >= WEBGL_MAX_CONTEXT_LOSSES) return
        try {
            const addon = new WebglAddon()
            addon.onContextLoss(() => {
                // GPU reset: fall back to the DOM renderer, retry on the next attach.
                this.webglLosses += 1
                this.disposeWebgl()
                try { this.term.refresh(0, this.term.rows - 1) } catch { /* disposed */ }
            })
            this.term.loadAddon(addon)
            this.webgl = addon
            // A fresh WebGL canvas starts empty.
            this.term.refresh(0, this.term.rows - 1)
        } catch {
            // WebGL unavailable (software rendering, blocked): stay on the DOM renderer.
            this.webglLosses = WEBGL_MAX_CONTEXT_LOSSES
            this.webgl = null
        }
    }

    private disposeWebgl() {
        const addon = this.webgl
        this.webgl = null
        if (!addon) return
        try { addon.dispose() } catch { /* already gone */ }
    }

    get rendererName(): 'webgl' | 'dom' {
        return this.webgl ? 'webgl' : 'dom'
    }

    // ---- transport -----------------------------------------------------------

    private connect() {
        if (this.disposed) return
        const ws = new WebSocket(buildTerminalUrl(this.config))
        ws.binaryType = 'arraybuffer'
        this.ws = ws

        ws.onopen = () => {
            this.wasOpen = true
            const isReconnect = this.reconnectAttempt > 0
            this.reconnectAttempt = 0
            this.reporter.reset()
            // The backend replays its output log on connect; drop what we already drew to avoid duplicates.
            if (isReconnect) this.term.reset()
            this.reporter.report({ cols: this.term.cols, rows: this.term.rows })
            if (this.preconnect) {
                ws.send(this.preconnect)
                this.preconnect = ''
            }
            this.scheduleInitialCommand(ws)
        }
        ws.onmessage = event => {
            if (typeof event.data === 'string') this.batcher.push(encoder.encode(event.data))
            else this.batcher.push(new Uint8Array(event.data as ArrayBuffer))
        }
        ws.onclose = event => {
            if (this.ws !== ws || this.disposed) return
            this.ws = null
            this.batcher.flush()
            const retry = shouldReconnect({ wasOpen: this.wasOpen, disposed: this.disposed, code: event.code })
            const delay = retry ? reconnectDelay(this.reconnectAttempt) : null
            if (delay === null) {
                this.term.write('\r\n\x1b[31mDISCONNECTED FROM BACKEND\x1b[0m\r\n')
                return
            }
            this.term.write('\r\n\x1b[33mConnection lost, reconnecting...\x1b[0m\r\n')
            this.reconnectAttempt += 1
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null
                this.connect()
            }, delay)
        }
    }

    private closeSocket() {
        const ws = this.ws
        this.ws = null
        if (!ws) return
        ws.onmessage = null
        ws.onclose = null
        // Closing a still-connecting socket logs a browser error; let it open, then close it quietly.
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close()
        else ws.close()
    }

    private scheduleInitialCommand(ws: WebSocket) {
        const { initialCommand, sessionId } = this.config
        // Only send once per session — prevents re-injection on tab switch remount and reconnect.
        if (!initialCommand || sentInitialCommands.has(sessionId)) return
        sentInitialCommands.add(sessionId)
        this.initialTimer = setTimeout(() => {
            this.initialTimer = null
            if (ws.readyState === WebSocket.OPEN) ws.send(initialCommand + '\n')
        }, INITIAL_COMMAND_DELAY_MS)
    }

    private sendInput(data: string) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(data)
        } else if (this.ws && this.preconnect.length + data.length <= PRECONNECT_INPUT_MAX_CHARS) {
            this.preconnect += data
        }
    }

    private sendControl(message: { type: 'resize'; rows: number; cols: number }) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
    }

    // ---- input ---------------------------------------------------------------

    private canRun(action: TerminalShortcutAction): boolean {
        if (action.type === 'splitRight') return !!this.handlers.onSplit
        if (action.type === 'focusPane') return !!this.handlers.onFocusPane
        if (action.type === 'toggleSearch') return !!this.handlers.onToggleSearch
        return true
    }

    private run(action: TerminalShortcutAction) {
        switch (action.type) {
            case 'copySelection': this.copySelection(); break
            case 'selectAll': this.term.selectAll(); break
            case 'toggleSearch': this.handlers.onToggleSearch?.(); break
            case 'clear': this.term.clear(); break
            case 'splitRight': this.handlers.onSplit?.(); break
            case 'focusPane': this.handlers.onFocusPane?.(action.direction); break
            case 'scrollViewport': if (action.position === 'top') this.term.scrollToTop(); else this.term.scrollToBottom(); break
            case 'sendInput': this.sendInput(action.data); break
        }
    }

    private handleKey(event: KeyboardEvent): boolean {
        if (event.type !== 'keydown') return true
        const action = resolveTerminalShortcut(event, { ...detectPlatform(), hasSelection: this.term.hasSelection() })
        if (!action || !this.canRun(action)) return true
        // preventDefault also suppresses the follow-up keypress that xterm would otherwise encode.
        event.preventDefault()
        if (event.repeat && action.type !== 'sendInput') return false
        this.run(action)
        return false
    }

    private copySelection() {
        const text = this.term.getSelection()
        if (!text) return
        void navigator.clipboard?.writeText(text).catch(() => { /* clipboard denied */ })
        this.term.clearSelection()
    }

    // Windows Terminal convention: right-click copies a selection, otherwise pastes.
    private readonly onContextMenu = (event: MouseEvent) => {
        if (!detectPlatform().isWindows) return
        event.preventDefault()
        if (this.term.hasSelection()) {
            this.copySelection()
            return
        }
        void navigator.clipboard?.readText().then(text => { if (text) this.term.paste(text) }).catch(() => { /* clipboard denied */ })
    }
}

// ---- registry ---------------------------------------------------------------

const MAX_PARKED_SESSIONS = 16
export const PARKED_ORPHAN_TTL_MS = 10 * 60 * 1000

const sessions = new Map<string, TerminalSession>()
// Ids the app still tracks (open terminal tabs); parked sessions for anything else expire after the TTL.
let isRetained: (id: string) => boolean = () => false
let parkTimer: ReturnType<typeof setTimeout> | null = null

export function setTerminalRetention(fn: (id: string) => boolean) {
    isRetained = fn
}

export function getTerminalSession(sessionId: string): TerminalSession | undefined {
    return sessions.get(sessionId)
}

/** Existing session for the id, or a new one. Connection identity changes (host/token) replace it. */
export function acquireTerminalSession(config: TerminalSessionConfig): TerminalSession {
    const existing = sessions.get(config.sessionId)
    if (existing && existing.config.baseUrl === config.baseUrl && existing.config.apiToken === config.apiToken) return existing
    existing?.dispose()
    const session = new TerminalSession(config)
    sessions.set(config.sessionId, session)
    return session
}

export function disposeTerminalSession(sessionId: string, opts: { forget?: boolean } = {}) {
    const session = sessions.get(sessionId)
    session?.dispose()
    sessions.delete(sessionId)
    if (opts.forget) clearInitialCommandTracking(sessionId)
}

/** Detach a session's view and bound the number of hidden sessions kept alive. */
export function parkTerminalSession(sessionId: string, now: number = Date.now()) {
    sessions.get(sessionId)?.detach()
    pruneParkedSessions(now)
}

export function pruneParkedSessions(now: number = Date.now()) {
    const parked = [...sessions.values()].filter(s => s.parkedAt !== null).sort((a, b) => (a.parkedAt ?? 0) - (b.parkedAt ?? 0))
    for (const session of parked) {
        const stale = !isRetained(session.config.sessionId) && now - (session.parkedAt ?? now) >= PARKED_ORPHAN_TTL_MS
        if (stale) disposeTerminalSession(session.config.sessionId)
    }
    const remaining = parked.filter(s => sessions.get(s.config.sessionId) === s)
    for (const session of remaining.slice(0, Math.max(0, remaining.length - MAX_PARKED_SESSIONS))) disposeTerminalSession(session.config.sessionId)
    schedulePrune()
}

function schedulePrune() {
    if (parkTimer) clearTimeout(parkTimer)
    parkTimer = null
    if (![...sessions.values()].some(s => s.parkedAt !== null)) return
    parkTimer = setTimeout(() => pruneParkedSessions(), PARKED_ORPHAN_TTL_MS / 2)
}

export function disposeAllTerminalSessions() {
    for (const id of [...sessions.keys()]) disposeTerminalSession(id)
    if (parkTimer) clearTimeout(parkTimer)
    parkTimer = null
}
