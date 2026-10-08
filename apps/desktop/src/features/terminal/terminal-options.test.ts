import { describe, expect, it } from 'vitest'
import { buildTerminalOptions, buildTerminalTheme, isLocalWindowsPty, minimumContrastFor, terminalBackground, TERMINAL_SCROLLBACK_ROWS } from './terminal-options'

describe('buildTerminalOptions', () => {
    it('enables the proposed API (unicode11/search decorations) and generous scrollback', () => {
        const o = buildTerminalOptions('dark')
        expect(o.allowProposedApi).toBe(true)
        expect(o.scrollback).toBe(TERMINAL_SCROLLBACK_ROWS)
        expect(o.overviewRuler?.width).toBe(7)
        expect(o.windowsPty).toBeUndefined()
    })

    it('flags ConPTY so xterm reflows wrapped lines like the host', () => {
        expect(buildTerminalOptions('dark', { windowsConpty: true }).windowsPty).toMatchObject({ backend: 'conpty' })
    })

    it('applies contrast correction only on light backgrounds', () => {
        expect(minimumContrastFor('light')).toBeGreaterThan(1)
        expect(buildTerminalOptions('dark').minimumContrastRatio).toBe(1)
        expect(buildTerminalOptions('light').minimumContrastRatio).toBe(4.5)
    })

    it('themes match the surrounding panel background and hide the ruler border', () => {
        for (const mode of ['dark', 'light'] as const) {
            const t = buildTerminalTheme(mode)
            expect(t.background).toBe(terminalBackground(mode))
            expect(t.overviewRulerBorder).toBe('transparent')
        }
    })
})

describe('isLocalWindowsPty', () => {
    it('is true only for Windows renderers talking to a loopback backend', () => {
        expect(isLocalWindowsPty('http://127.0.0.1:4010', 'Win32')).toBe(true)
        expect(isLocalWindowsPty('http://localhost:3284', 'Win32')).toBe(true)
        expect(isLocalWindowsPty('http://10.0.0.5:3284', 'Win32')).toBe(false)
        expect(isLocalWindowsPty('http://127.0.0.1:4010', 'Linux x86_64')).toBe(false)
        expect(isLocalWindowsPty('not a url', 'Win32')).toBe(false)
    })
})
