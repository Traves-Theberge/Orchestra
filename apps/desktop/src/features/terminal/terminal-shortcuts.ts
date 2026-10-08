export interface TerminalKeyEvent {
    key: string
    code?: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    repeat?: boolean
    isComposing?: boolean
}

export interface TerminalShortcutContext {
    isMac: boolean
    isWindows: boolean
    hasSelection: boolean
}

export type TerminalShortcutAction =
    | { type: 'copySelection' }
    | { type: 'selectAll' }
    | { type: 'toggleSearch' }
    | { type: 'clear' }
    | { type: 'splitRight' }
    | { type: 'focusPane'; direction: 'next' | 'previous' }
    | { type: 'scrollViewport'; position: 'top' | 'bottom' }
    | { type: 'sendInput'; data: string }

export function detectPlatform(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): Pick<TerminalShortcutContext, 'isMac' | 'isWindows'> {
    return { isMac: /^mac/i.test(platform), isWindows: /^win/i.test(platform) }
}

/**
 * Resolves a key event to a terminal-level action before xterm encodes it, following Orca's
 * terminal-shortcut-policy. Returns null to let xterm handle the key normally.
 *
 * Chords that readline/PSReadLine/TUIs rely on stay untouched: plain Ctrl+C is only a copy when a
 * selection exists, and Windows keeps Ctrl/Alt+Arrow because PSReadLine and ConPTY bind them natively.
 */
export function resolveTerminalShortcut(e: TerminalKeyEvent, ctx: TerminalShortcutContext): TerminalShortcutAction | null {
    if (e.isComposing) return null
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const mod = ctx.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    const bare = !e.ctrlKey && !e.metaKey && !e.altKey

    if (ctx.isMac) {
        if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            if (key === 'c' && ctx.hasSelection) return { type: 'copySelection' }
            if (key === 'a') return { type: 'selectAll' }
            if (key === 'f') return { type: 'toggleSearch' }
            if (key === 'k') return { type: 'clear' }
            if (key === 'd') return { type: 'splitRight' }
            if (e.code === 'BracketLeft') return { type: 'focusPane', direction: 'previous' }
            if (e.code === 'BracketRight') return { type: 'focusPane', direction: 'next' }
            // xterm has no Cmd+Arrow/Backspace mapping; use readline line editing like iTerm2/Ghostty.
            if (e.key === 'Backspace') return { type: 'sendInput', data: '\x15' }
            if (e.key === 'ArrowLeft') return { type: 'sendInput', data: '\x01' }
            if (e.key === 'ArrowRight') return { type: 'sendInput', data: '\x05' }
            if (e.key === 'ArrowUp') return { type: 'scrollViewport', position: 'top' }
            if (e.key === 'ArrowDown') return { type: 'scrollViewport', position: 'bottom' }
        }
    } else {
        if (mod && !e.altKey) {
            if (e.shiftKey) {
                if (key === 'c') return { type: 'copySelection' }
                if (key === 'a') return { type: 'selectAll' }
                if (key === 'k') return { type: 'clear' }
                if (key === 'd') return { type: 'splitRight' }
                if (e.code === 'BracketLeft') return { type: 'focusPane', direction: 'previous' }
                if (e.code === 'BracketRight') return { type: 'focusPane', direction: 'next' }
            } else {
                // Plain Ctrl+C is SIGINT unless the user has something selected.
                if (key === 'c' && ctx.hasSelection) return { type: 'copySelection' }
                if (key === 'f') return { type: 'toggleSearch' }
            }
        }
    }

    // Shift+Enter inserts a newline in agent TUIs; ESC CR is the encoding they accept without kitty negotiation.
    if (e.shiftKey && bare && e.key === 'Enter') return { type: 'sendInput', data: '\x1b\r' }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'Backspace') return { type: 'sendInput', data: '\x17' }

    if (!ctx.isWindows) {
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.key === 'Backspace') return { type: 'sendInput', data: '\x1b\x7f' }
            if (e.code?.startsWith('Numpad') !== true) {
                if (e.key === 'ArrowLeft') return { type: 'sendInput', data: '\x1bb' }
                if (e.key === 'ArrowRight') return { type: 'sendInput', data: '\x1bf' }
            }
        }
        // readline ignores xterm's CSI 1;5D/C, so word-navigate with ESC b/f (macOS reserves Ctrl+Arrow).
        if (!ctx.isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            if (e.key === 'ArrowLeft') return { type: 'sendInput', data: '\x1bb' }
            if (e.key === 'ArrowRight') return { type: 'sendInput', data: '\x1bf' }
        }
    }
    return null
}
