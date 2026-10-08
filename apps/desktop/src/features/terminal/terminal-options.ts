import type { ITerminalOptions, ITheme } from '@xterm/xterm'

export type TerminalThemeMode = 'light' | 'dark'

// Mirrors Orca's pane-terminal-options: slim overview ruler, wheel sensitivity tuned for tall cells.
export const TERMINAL_SCROLLBACK_ROWS = 10_000
export const TERMINAL_SCROLL_SENSITIVITY = 1.15
export const TERMINAL_FAST_SCROLL_SENSITIVITY = 5
export const TERMINAL_FONT_SIZE = 13
export const TERMINAL_FONT_FAMILY =
    '"CaskaydiaMono Nerd Font", "CaskaydiaMono NFM", "JetBrainsMono Nerd Font Mono", "Symbols Nerd Font Mono", Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace'

const DARK_BACKGROUND = '#0a0a0b'
const LIGHT_BACKGROUND = '#f8fafc'

export function terminalBackground(mode: TerminalThemeMode): string {
    return mode === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

export function resolveThemeMode(explicit?: TerminalThemeMode): TerminalThemeMode {
    if (explicit) return explicit
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const DARK_THEME: ITheme = {
    background: DARK_BACKGROUND,
    foreground: '#ffffff',
    cursor: 'hsl(161, 72%, 45%)',
    cursorAccent: DARK_BACKGROUND,
    selectionBackground: 'hsla(161, 72%, 45%, 0.3)',
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

const LIGHT_THEME: ITheme = {
    background: LIGHT_BACKGROUND,
    foreground: '#0f172a',
    cursor: 'hsl(161, 72%, 38%)',
    cursorAccent: LIGHT_BACKGROUND,
    selectionBackground: 'hsla(161, 72%, 38%, 0.2)',
    black: '#000000',
    red: '#dc2626',
    green: '#059669',
    yellow: '#b45309',
    blue: '#2563eb',
    magenta: '#7c3aed',
    cyan: '#0891b2',
    white: '#cbd5e1',
    brightBlack: '#475569',
    brightRed: '#ef4444',
    brightGreen: '#10b981',
    brightYellow: '#d97706',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#f1f5f9',
}

/** Composed theme. Overview-ruler border is hidden and the scrollbar slider raised so the 7px bar is visible. */
export function buildTerminalTheme(mode: TerminalThemeMode): ITheme {
    return {
        overviewRulerBorder: 'transparent',
        scrollbarSliderBackground: 'rgba(180, 180, 185, 0.4)',
        scrollbarSliderHoverBackground: 'rgba(180, 180, 185, 0.6)',
        scrollbarSliderActiveBackground: 'rgba(180, 180, 185, 0.8)',
        ...(mode === 'dark' ? DARK_THEME : LIGHT_THEME),
    }
}

// Light backgrounds need contrast correction for TUI colors tuned for dark terminals.
export function minimumContrastFor(mode: TerminalThemeMode): number {
    return mode === 'light' ? 4.5 : 1
}

// First Windows build whose ConPTY reflows on resize; lets xterm reflow wrapped lines the same way.
const CONPTY_REFLOW_BUILD = 21376

/** True when the PTY host is this Windows machine (renderer on Windows talking to a loopback backend). */
export function isLocalWindowsPty(baseUrl: string, platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
    if (!/^win/i.test(platform)) return false
    try {
        const host = new URL(baseUrl).hostname
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
    } catch {
        return false
    }
}

export function buildTerminalOptions(mode: TerminalThemeMode, opts: { windowsConpty?: boolean } = {}): ITerminalOptions {
    return {
        ...(opts.windowsConpty ? { windowsPty: { backend: 'conpty' as const, buildNumber: CONPTY_REFLOW_BUILD } } : {}),
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: 'block',
        // An outlined inactive cursor only reads well for block cursors.
        cursorInactiveStyle: 'outline',
        fontSize: TERMINAL_FONT_SIZE,
        lineHeight: 1.0,
        letterSpacing: 0,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontWeight: '400',
        fontWeightBold: '600',
        scrollback: TERMINAL_SCROLLBACK_ROWS,
        scrollSensitivity: TERMINAL_SCROLL_SENSITIVITY,
        fastScrollSensitivity: TERMINAL_FAST_SCROLL_SENSITIVITY,
        allowTransparency: false,
        minimumContrastRatio: minimumContrastFor(mode),
        drawBoldTextInBrightColors: true,
        macOptionClickForcesSelection: true,
        // Slim gutter reserved by FitAddon; also hosts search-result marks.
        overviewRuler: { width: 7 },
        theme: buildTerminalTheme(mode),
    }
}
