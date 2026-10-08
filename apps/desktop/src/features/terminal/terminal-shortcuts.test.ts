import { describe, expect, it } from 'vitest'
import { resolveTerminalShortcut, type TerminalKeyEvent, type TerminalShortcutContext } from './terminal-shortcuts'

const key = (e: Partial<TerminalKeyEvent> & { key: string }): TerminalKeyEvent => ({
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...e,
})
const win: TerminalShortcutContext = { isMac: false, isWindows: true, hasSelection: false }
const linux: TerminalShortcutContext = { isMac: false, isWindows: false, hasSelection: false }
const mac: TerminalShortcutContext = { isMac: true, isWindows: false, hasSelection: false }

describe('resolveTerminalShortcut', () => {
    it('keeps Ctrl+C as SIGINT unless text is selected', () => {
        expect(resolveTerminalShortcut(key({ key: 'c', ctrlKey: true }), win)).toBeNull()
        expect(resolveTerminalShortcut(key({ key: 'c', ctrlKey: true }), { ...win, hasSelection: true })).toEqual({ type: 'copySelection' })
        expect(resolveTerminalShortcut(key({ key: 'C', ctrlKey: true, shiftKey: true }), win)).toEqual({ type: 'copySelection' })
    })

    it('uses Cmd for copy/search/clear/split on macOS and leaves Ctrl+C alone', () => {
        expect(resolveTerminalShortcut(key({ key: 'c', metaKey: true }), mac)).toBeNull()
        expect(resolveTerminalShortcut(key({ key: 'c', metaKey: true }), { ...mac, hasSelection: true })).toEqual({ type: 'copySelection' })
        expect(resolveTerminalShortcut(key({ key: 'f', metaKey: true }), mac)).toEqual({ type: 'toggleSearch' })
        expect(resolveTerminalShortcut(key({ key: 'k', metaKey: true }), mac)).toEqual({ type: 'clear' })
        expect(resolveTerminalShortcut(key({ key: 'd', metaKey: true }), mac)).toEqual({ type: 'splitRight' })
        expect(resolveTerminalShortcut(key({ key: 'c', ctrlKey: true }), mac)).toBeNull()
    })

    it('maps pane shortcuts on Windows/Linux to Ctrl+Shift chords', () => {
        expect(resolveTerminalShortcut(key({ key: 'D', ctrlKey: true, shiftKey: true }), win)).toEqual({ type: 'splitRight' })
        expect(resolveTerminalShortcut(key({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }), win)).toEqual({ type: 'focusPane', direction: 'previous' })
        expect(resolveTerminalShortcut(key({ key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true }), linux)).toEqual({ type: 'focusPane', direction: 'next' })
        expect(resolveTerminalShortcut(key({ key: 'f', ctrlKey: true }), win)).toEqual({ type: 'toggleSearch' })
        expect(resolveTerminalShortcut(key({ key: 'A', ctrlKey: true, shiftKey: true }), win)).toEqual({ type: 'selectAll' })
        // Plain Ctrl+A stays readline "start of line".
        expect(resolveTerminalShortcut(key({ key: 'a', ctrlKey: true }), win)).toBeNull()
    })

    it('encodes Shift+Enter and Ctrl+Backspace for TUIs and readline', () => {
        expect(resolveTerminalShortcut(key({ key: 'Enter', shiftKey: true }), win)).toEqual({ type: 'sendInput', data: '\x1b\r' })
        expect(resolveTerminalShortcut(key({ key: 'Backspace', ctrlKey: true }), linux)).toEqual({ type: 'sendInput', data: '\x17' })
    })

    it('translates word navigation on Linux but leaves ConPTY/PSReadLine arrows alone', () => {
        expect(resolveTerminalShortcut(key({ key: 'ArrowLeft', altKey: true }), linux)).toEqual({ type: 'sendInput', data: '\x1bb' })
        expect(resolveTerminalShortcut(key({ key: 'ArrowRight', ctrlKey: true }), linux)).toEqual({ type: 'sendInput', data: '\x1bf' })
        expect(resolveTerminalShortcut(key({ key: 'Backspace', altKey: true }), linux)).toEqual({ type: 'sendInput', data: '\x1b\x7f' })
        expect(resolveTerminalShortcut(key({ key: 'ArrowLeft', ctrlKey: true }), win)).toBeNull()
        expect(resolveTerminalShortcut(key({ key: 'ArrowRight', altKey: true }), win)).toBeNull()
        expect(resolveTerminalShortcut(key({ key: 'ArrowLeft', altKey: true, code: 'Numpad4' }), linux)).toBeNull()
    })

    it('maps macOS Cmd line-editing and viewport keys', () => {
        expect(resolveTerminalShortcut(key({ key: 'ArrowLeft', metaKey: true }), mac)).toEqual({ type: 'sendInput', data: '\x01' })
        expect(resolveTerminalShortcut(key({ key: 'ArrowRight', metaKey: true }), mac)).toEqual({ type: 'sendInput', data: '\x05' })
        expect(resolveTerminalShortcut(key({ key: 'Backspace', metaKey: true }), mac)).toEqual({ type: 'sendInput', data: '\x15' })
        expect(resolveTerminalShortcut(key({ key: 'ArrowUp', metaKey: true }), mac)).toEqual({ type: 'scrollViewport', position: 'top' })
        expect(resolveTerminalShortcut(key({ key: 'ArrowDown', metaKey: true }), mac)).toEqual({ type: 'scrollViewport', position: 'bottom' })
    })

    it('ignores IME composition', () => {
        expect(resolveTerminalShortcut(key({ key: 'Enter', shiftKey: true, isComposing: true }), win)).toBeNull()
    })
})
