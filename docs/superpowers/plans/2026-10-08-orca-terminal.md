# Orca-grade terminal for Orchestra

Goal: give Orchestra's terminal views the renderer, addon set, resize, output, keybinding and
pane-lifecycle engineering Orca ships, while keeping the Go ConPTY/PTY WebSocket transport.

## 1. Orca findings (source: `stablyai/orca`, `src/`)

| Area | What Orca does | Files |
|---|---|---|
| xterm | `@xterm/xterm` 6.1 beta; addons fit, search, serialize, unicode11, web-links, webgl, image (opt-in), ligatures (opt-in). `allowProposedApi`, 5k default scrollback, `scrollbar.width: 7`, `cursorInactiveStyle: outline` only for block cursor, `drawBoldTextInBrightColors`, scroll sensitivity 1.15 / fast 5 | `renderer/src/lib/pane-manager/pane-terminal-options.ts`, `pane-lifecycle.ts` (`openTerminal`) |
| Renderer | WebGL attached after `open()`, auto/on/off policy, context-loss latch -> DOM fallback, atlas rebuild, forced refresh after attach, WebGL released while hidden | `pane-webgl-renderer.ts`, `terminal-webgl-auto-policy.ts`, `pane-webgl-context-loss-policy.ts`, `terminal-renderer-policy.ts` |
| Unicode | Unicode 11 widths activated BEFORE any write (restore bytes would otherwise bake v6 widths) plus ZWJ-aware provider | `shared/terminal-unicode-provider.ts` |
| Resize | ResizeObserver -> rAF loop waiting for a *stable proposed grid* (max 8 frames) before a single fit; skips zero-size/hidden containers; fit only changes PTY when cols/rows differ | `pane-fit-resize-observer.ts`, `pane-fit.ts`, `pty-size-reconcile.ts` |
| Output | PTY output queued and drained in budgeted batches (foreground coalescing, background throttling, backlog cap = max(2 MB, 120 chars x scrollback)); ACK/credit flow control on the multiplexed stream | `pane-terminal-output-*.ts`, `shared/terminal-multiplex-flow-control.ts`, `terminal-scrollback-policy.ts` |
| Transport | node-pty in a *daemon* process (not renderer); headless xterm mirrors screen; history checkpoints on disk; snapshot (serialize) restore with mode rehydration | `main/daemon/terminal-host*.ts`, `terminal-snapshot.ts`, `terminal-history-*.ts` |
| Lifecycle | Panes outlive tab switches (hidden, not disposed); xterm detached/reparented; scroll intent preserved; viewport re-presented on reveal | `pane-reveal-fit.ts`, `pane-reveal-repaint.ts`, `pane-viewport-present.ts`, `terminal-hidden-view-parking.ts` |
| Keybindings | One pure policy resolves key events *before* xterm: copy/selectAll/search/clear/split/focus/close, Shift+Enter `ESC CR` (CSI-u when kitty negotiated), Ctrl+Backspace `^W`, Alt+Backspace, Alt/Ctrl+Arrow word nav -> `ESC b/f` (Ctrl+Arrow skipped on local ConPTY because PSReadLine owns it), mac Cmd+Arrow/Backspace line ops | `terminal-pane/terminal-shortcut-policy.ts`, `terminal-keyboard-shortcut-matching.ts` |
| Paste/copy | Bracketed-paste aware, newline normalised, control chars sanitised; right-click paste; selection copy guards | `terminal-bracketed-paste.ts`, `shared/terminal-bracketed-paste-text.ts`, `terminal-selection-copy.ts` |
| Links | WebLinksAddon, modifier-gated activation, hard-wrapped URL re-assembly, OSC 8 + file path providers, hover tooltip | `terminal-web-link-click.ts`, `terminal-link-handlers.ts` |
| Split panes | Own pane tree (nested, drag dividers, equalize, expand, focus next/prev) | `lib/pane-manager/pane-tree-ops.ts`, `pane-divider*.ts` |
| Agent status | Title (OSC 0/2) + process inspection + agent hooks | `terminal-pane/agent-completion-*.ts`, `shared/terminal-title-*.ts` |
| Theming | Composed `ITheme` per mode with transparent overview-ruler border, visible scrollbar slider, min-contrast gated on background luminance | `terminal-appearance.ts`, `shared/terminal-themes` |

## 2. Orchestra gaps (before)

`features/terminal/TerminalView.tsx` (279 lines): xterm 6.0 + fit + search only, DOM renderer, `new Terminal` per mount
and `dispose()` on every tab switch/theme change (scrollback lost; backend replays raw 100 KB tail), `Blob.text()` for
output (async => chunk reordering), a write per WS message, two fit paths with an 80 ms debounce that always
re-sends resize, no unicode11, no links, no shortcut handling (Ctrl+C never copies, Shift+Enter submits), theme only
read at mount, search without result counts.

## 3. Decision

Keep the Go PTY/ConPTY WebSocket backend. Orca's node-pty-in-daemon model is tied to Electron main and a headless-xterm
snapshot protocol; Orchestra's backend already owns session lifetime (`terminal.Manager`, reattach by id, 100 KB log
replay) and the same backend serves browser mode and the TUI. Replacing it gains little and risks ConPTY regressions.
We port Orca's *renderer-side* engineering instead:

1. Session objects that outlive React mounts (park/attach, like Orca's hidden panes).
2. Orca's xterm options, addons (webgl with context-loss fallback, unicode11, web-links, search, fit), stable-grid fit.
3. rAF-batched binary output (`arraybuffer`, UTF-8 safe, in order).
4. Pure shortcut policy + clipboard behaviour.
5. Live theme following without teardown; search with result counts.

Out of scope (follow-ups): nested split tree, kitty keyboard protocol (needs xterm 6.1 beta), serialize-based
cross-reload restore (needs a backend replay-offset protocol), image/ligature addons, OSC 7/133 + title-driven agent status.

## 4. File changes (`apps/desktop/src/features/terminal/`)

- `terminal-options.ts` new: options, themes, font stack, scrollback constants.
- `terminal-shortcuts.ts` new: pure `resolveTerminalShortcut`.
- `terminal-fit.ts` new: `createStableFit` (rAF stable-grid) + `createSizeReporter` (dedupe).
- `terminal-output.ts` new: `createOutputBatcher` (coalesce, flush per frame, size-capped writes).
- `terminal-reconnect.ts` new: backoff schedule + close-code policy.
- `terminal-session.ts` new: `TerminalSession` (xterm, addons, WS, parking) + registry (`acquire/park/dispose`, LRU/TTL cap).
- `TerminalView.tsx` rewritten as a thin host: acquire session, attach, drag/drop, search UI. Public props and
  `clearInitialCommandTracking` unchanged; new optional `onSplit`, `onFocusPane`, `onTitleChange`.
- `TerminalSearch.tsx`: match counter (`onDidChangeResults`) and decorations.
- `workspace/tabs/TerminalPanes.tsx`: pass split/focus callbacks; `TerminalMultiplexer` unchanged (uses `clearInitialCommandTracking`).
- Store: opened terminals removed -> `disposeTerminalSession` via a subscription in `terminal-session.ts`.
- Tests: `terminal-options.test.ts`, `terminal-shortcuts.test.ts`, `terminal-fit.test.ts`, `terminal-output.test.ts`,
  `terminal-reconnect.test.ts`, `terminal-session.test.ts` (registry/park/initial command with fake WS).

## 5. Test strategy

vitest units for all pure modules; session registry test with stubbed `xterm` and `WebSocket`; existing component
tests mock `TerminalView` and stay valid. `tsc --noEmit`, `eslint` on changed files. Live: Playwright (msedge) against the
running Vite + backend via a temporary `preview-terminal.html`: type, resize, scrollback, unmount/remount keeps buffer,
WebGL canvas present, screenshots.

## 6. Risks / rollback

- WebGL unavailable or context lost -> automatic DOM renderer fallback.
- Parked sessions hold memory: capped (12) with 10 min TTL for ids not in `openTerminals`.
- Window `Ctrl+C` copy only when a selection exists, otherwise SIGINT passes through.
- Rollback: restore `TerminalView.tsx` from git; new files are additive; remove three added deps.
