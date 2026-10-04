# Workspace resizing and browser connection recovery

## References inspected before implementation

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: `apps/web/src/components/preview/RightPanelResizeHandle.tsx` uses an overlapping 8px grab area around a thin visual divider. `apps/web/src/hooks/useResizableWidth.ts` clamps widths, restores scoped localStorage preferences and persists once at drag end. Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/renderer/src/components/activity/activity-thread-list-resize-handle.tsx` uses a 12px grab area, separator semantics and hover/active indicator. Both pinned files were downloaded and read; neither reference application was run.

Orchestra adapts these patterns with an 8px divider, pointer capture, bounded percentages, per-backend URL/project preferences, drag-end persistence, arrow keys, Shift acceleration, Home/End bounds and double-click reset. Narrow screens use a horizontal divider between stacked panes. Unlike T3's fixed pixel width and Orca's externally supplied mouse callback, Orchestra owns the responsive percentage split locally. Chat remains mounted while tools hide or resize; project/task/Kanban ownership is unchanged. No reference code or assets were copied.

## Fetch failure investigation

The collaborative preview was still using the now-stopped isolated fixture backend at 4010. Network inspection showed connection refusal there. The managed native app at 4014 was healthy: its latest chat creation POST returned 201 and message submission POST returned 202. This does not prove that every earlier reported creation failure had this cause.

Changing only the shared store configuration did not update the app's separate backend hook or SSE loop. Browser mode now supports a tab-scoped saved backend connection through the existing Settings save handler, and restores it on mount. Electron continues to use its desktop bridge/profile. Browser connection storage contains the configured token, as connection settings require, and is separate from the hashed draft receipts. The preview was connected to the actual managed profile without sending a provider message or retrying an uncertain operation. Actual browser reads loaded one project, reported SSE Live and cleared alerts; a full reload retained the 4014 connection.

## Verification

- Focused workspace/chat tests: 40 passed; final split/layout checks: five passed. Keyboard bounds, workspace isolation, reset, hide and remount restoration are covered.
- Production browser: opened Files & terminals using the visible control, focused the divider and pressed Shift+ArrowLeft. Chat width changed from 633.6px at 60% to 528px at 50%. After full navigation reload and reopening tools, it remained 50% / 528px. No alert remained.
- Typecheck and scoped lint passed. Production build passed with the existing chunk-size warning.
- Native Electron receives the renderer update through Vite HMR. The browser check exercised real layout and localStorage; it did not independently exercise a continuous pointer drag, narrow-screen resize gesture or signed-in inference.

Screenshot: `C:/Users/trave/.t3/userdata/browser-artifacts/browser-screenshot-localhost-muudwmc7-538f1d60.png`.
