# Chat visualization & inline HTML render handoff

## Pinned references

- **T3 Code (`pingdotgg/t3code`)**:
  - PR #15968: `feat: agents can show HTML pages inline in threads` (Ben Davis `@bmdavis419` / `@davis7`, Theo Browne `@t3dotgg`). Introduced inline HTML renders in chat threads with responsive auto-height calculation across breakpoint intervals, sandboxed iframe (`sandbox="allow-scripts allow-forms"`, omitting `allow-same-origin`), zero-flash theming via synchronous fragment injection (`#t3-theme=...`), safe link interception, and maximize/modal inspection with fluid/tablet/mobile width controls and source code inspection.
  - PR #16196: `refactor: HTML render frames speak the MCP Apps bridge protocol` (Julius Marminge `@juliusmarminge`). Upgraded inline HTML renders to use bidirectional JSON-RPC MCP Apps protocol: `ui/notifications/size-changed` for dynamic document auto-resizing and `ui/notifications/host-context-changed` for theme synchronization and color scheme broadcast.
  - PR #16283: `fix(web): inline HTML renders no longer trap the thread's scroll`.
- **Orca (`stablyai/orca` at `3284b4c70c901402831bb4ccc5576ea083d2e5ae`)**:
  - Inspected `src/main/native-chat`, `src/renderer`, and transcript presentation. Orca has no inline HTML visualization or live canvas feature; native chat is purely markdown prose and terminal/command cards. Documented that no comparable visualization pattern exists in Orca.

## Orchestra adaptation and boundaries

Orchestra adopts the 1:1 T3 Code visualization capability adapted to Orchestra's Electron + React desktop architecture and Go orchestration backend:

1. **Shared Protocol & Utilities (`apps/desktop/src/features/workspace/chat/html-render/htmlRender.ts`)**:
   - Implements MCP Apps bridge notifications: `ui/notifications/size-changed`, `ui/notifications/host-context-changed`, and `ui/open-link`.
   - Responsive multi-width height measurement curve with standard sampling widths (`[320, 375, 430, 520, 640, 728, 860, 1000, 1144]`), clamped between 80px and 2000px.
   - Orchestra theme variable mapping including categorical chart palettes (`--chart-1` through `--chart-6`), fonts, background, foreground, border, and muted colors.
   - Zero-flash bootstrap injection: embeds `:root` variables synchronously into `<head>` before first paint using the URL hash fragment (`#t3-theme=...`).
   - Extractors for both tool execution results (`html_render`, `html_preview`, `render_html`) and markdown fenced code blocks (`orchestra-html`).

2. **Security & Sandboxing (`apps/desktop/src/features/workspace/chat/html-render/HtmlRenderDocument.tsx`)**:
   - Strict iframe isolation with `sandbox="allow-scripts allow-forms"`. Critically omits `allow-same-origin` to ensure rendered scripts cannot access Electron IPC, `window.orchestra`, local cookies, tokens, or local storage.
   - Uses `srcDoc` with synchronously injected bootstrap to prevent Chromium cross-origin navigation blocks on `blob:` URLs in sandboxed contexts.
   - Intercepts external navigation via `postMessage` protocol, dispatching links to the host application or default browser.
   - Smooth loading fade-in (`opacity-0` -> `opacity-100` on load) with backdrop placeholder to prevent blank white flashes.

3. **Inline Frame & Modal Inspector (`HtmlRenderFrame.tsx`, `HtmlRenderModal.tsx`)**:
   - `HtmlRenderFrame`: Renders responsive auto-sized inline visualization directly in the conversation stream, featuring a hover expand button to inspect.
   - `HtmlRenderModal`: Pop-out studio dialog with Preview vs. Source code tabs, viewport presets (Fluid 100%, Tablet 768px, Mobile 390px with Dynamic Island frame), clipboard copy, and `.html` file export. Cleaned of redundant header branding text and icons for a distraction-free studio experience.

4. **Streaming & Stability Refinements**:
   - **Zero-Flicker Streaming (`MarkdownRenderer.tsx`)**: Displays an animated `StreamingVisualizationSkeleton` while a ````orchestra-html```` block is incomplete/streaming, preventing hundreds of rapid iframe reloads and syntax error crashes. Transitions smoothly to the live interactive frame once the code block is closed.
   - **In-Place Multi-Mockup Rendering**: Retains code blocks in the natural markdown flow, rendering multiple distinct mocks sequentially without message inversion or layout teleporting.
   - **Scroll Pinning (`WorkspaceChat.tsx`)**: Replaces asynchronous `scrollIntoView({ behavior: 'smooth' })` during streaming with direct scroll pinning (`scrollTop = scrollHeight`), eliminating scroll bouncing, jitter, and false jump button triggers.
   - **Refined Agent Working Status**: Replaces the plain loader paragraph with `AgentWorkingStatus` featuring an animated orbital glowing badge, typing dots, descriptive status text, and an accessible inline Stop button.

## Behavioral verification

- **TypeScript Typecheck**: `npm run typecheck` in `apps/desktop` passed with 0 errors.
- **Unit & Integration Tests**:
  - `apps/desktop/src/features/workspace/chat/html-render/htmlRender.test.ts` (12 tests passed).
  - `apps/desktop/src/features/workspace/chat/html-render/HtmlRenderFrame.test.tsx` (3 tests passed).
  - `apps/desktop/src/features/workspace/chat/ChatMessage.test.tsx` (4 tests passed).
  - `apps/desktop/src/ui/MarkdownRenderer.test.tsx` (2 tests passed).
  - `apps/desktop/src/features/workspace/chat/WorkspaceChat.test.tsx` (45 tests passed).
- **Backend Tests**: `go test ./...` in `apps/backend` passed completely across all packages.
