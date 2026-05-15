import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2 } from 'lucide-react'
import { useAppStore } from '@core/store'
import type { TreeNode } from '@core/store/types'
import { FileTreeRow } from './FileTreeRow'
import { FileContextMenu, type FileContextAction } from './FileContextMenu'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'

export function FileExplorer() {
  const explorerRoot = useAppStore((s) => s.explorerRoot)
  const expandedDirs = useAppStore((s) => s.expandedDirs)
  const dirCache = useAppStore((s) => s.dirCache)
  const gitStatusMap = useAppStore((s) => s.gitStatusMap)
  const toggleDir = useAppStore((s) => s.toggleDir)
  const setDirChildren = useAppStore((s) => s.setDirChildren)
  const setDirLoading = useAppStore((s) => s.setDirLoading)
  const setGitStatusMap = useAppStore((s) => s.setGitStatusMap)
  const clearExplorerCache = useAppStore((s) => s.clearExplorerCache)
  const openFile = useAppStore((s) => s.openFile)
  const config = useAppStore((s) => s.config)

  // ---- Auto-detect workspace root from running issues -----------------------
  const snapshot = useAppStore((s) => s.snapshot)
  useEffect(() => {
    if (explorerRoot) return
    const running = snapshot?.running ?? []
    for (const entry of running) {
      if (entry.session_log_path) {
        const logsIdx = entry.session_log_path.indexOf('/_logs/')
        if (logsIdx > 0) {
          useAppStore.getState().setExplorerRoot(entry.session_log_path.slice(0, logsIdx))
          return
        }
      }
    }
  }, [explorerRoot, snapshot])

  // ---- Load root directory when explorerRoot changes -------------------------
  useEffect(() => {
    if (!explorerRoot) return
    clearExplorerCache()

    const ctrl = new AbortController()
    const loadRoot = async () => {
      if (!config) return
      try {
        const url = `${config.baseUrl}/api/v1/workspace/tree?path=${encodeURIComponent(explorerRoot)}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.apiToken}` },
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setDirChildren(explorerRoot, [])
          return
        }
        const tree: Array<{ name: string; path: string; is_dir: boolean }> = await res.json()
        if (ctrl.signal.aborted) return
        const children: TreeNode[] = tree.map((entry) => ({
          name: entry.name,
          path: `${explorerRoot}/${entry.name}`,
          relativePath: entry.name,
          isDirectory: entry.is_dir,
          depth: 0,
        }))
        setDirChildren(explorerRoot, children)

        try {
          const status = await window.orchestraDesktop?.fs?.gitStatus?.(explorerRoot)
          if (status && !ctrl.signal.aborted) setGitStatusMap(status)
        } catch { /* git status is best-effort */ }
      } catch {
        if (!ctrl.signal.aborted) setDirChildren(explorerRoot, [])
      }
    }

    loadRoot()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerRoot])

  // ---- Flatten the tree for virtual scrolling --------------------------------
  const flatRows = useMemo(() => {
    if (!explorerRoot || !dirCache[explorerRoot]) return []
    const rows: TreeNode[] = []

    function walk(dirPath: string) {
      const cache = dirCache[dirPath]
      if (!cache) return
      for (const child of cache.children) {
        rows.push(child)
        if (child.isDirectory && expandedDirs.has(child.path)) {
          walk(child.path)
        }
      }
    }

    walk(explorerRoot)
    return rows
  }, [explorerRoot, dirCache, expandedDirs])

  // ---- Virtualizer -----------------------------------------------------------
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 20,
  })

  // ---- Directory toggle with lazy loading ------------------------------------
  async function handleToggleDir(node: TreeNode) {
    const wasExpanded = expandedDirs.has(node.path)
    toggleDir(node.path)

    if (!wasExpanded && !dirCache[node.path]) {
      setDirLoading(node.path, true)

      if (config) {
        try {
          const url = `${config.baseUrl}/api/v1/workspace/tree?path=${encodeURIComponent(node.path)}`
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.apiToken}` },
          })
          if (res.ok) {
            const tree: Array<{ name: string; path: string; is_dir: boolean }> = await res.json()
            const children: TreeNode[] = tree.map((entry) => ({
              name: entry.name,
              path: `${node.path}/${entry.name}`,
              relativePath: `${node.relativePath}/${entry.name}`,
              isDirectory: entry.is_dir,
              depth: node.depth + 1,
            }))
            setDirChildren(node.path, children)
          } else {
            setDirChildren(node.path, [])
          }
          return
        } catch {
          setDirChildren(node.path, [])
          return
        }
      }

      // Fallback: Electron IPC
      try {
        const entries = await window.orchestraDesktop.fs.readDir(node.path)
        const children: TreeNode[] = entries.map((e) => ({
          name: e.name,
          path: `${node.path}/${e.name}`,
          relativePath: `${node.relativePath}/${e.name}`,
          isDirectory: e.isDirectory,
          depth: node.depth + 1,
        }))
        setDirChildren(node.path, children)
      } catch {
        setDirChildren(node.path, [])
      }
    }
  }

  // ---- Context menu ----------------------------------------------------------
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  const [promptDialog, setPromptDialog] = useState<{
    kind: 'newFile' | 'newFolder' | 'rename'
    node: TreeNode
    initial: string
    error?: string
  } | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [promptPending, setPromptPending] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{ node: TreeNode; error?: string } | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)
  const [statusToast, setStatusToast] = useState<string | null>(null)
  const closeFile = useAppStore((s) => s.closeFile)

  // Auto-clear the small status toast (used for "Path copied" feedback).
  useEffect(() => {
    if (!statusToast) return
    const id = window.setTimeout(() => setStatusToast(null), 1600)
    return () => window.clearTimeout(id)
  }, [statusToast])

  // Refresh a directory's cached children from the backend after an edit.
  const refreshDir = useCallback(
    async (dirPath: string, parentDepth: number, parentRel: string) => {
      if (!config) return
      try {
        const url = `${config.baseUrl}/api/v1/workspace/tree?path=${encodeURIComponent(dirPath)}`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiToken}` } })
        if (!res.ok) return
        const tree: Array<{ name: string; path: string; is_dir: boolean }> = await res.json()
        const children: TreeNode[] = tree.map((entry) => ({
          name: entry.name,
          path: `${dirPath}/${entry.name}`,
          relativePath: parentRel ? `${parentRel}/${entry.name}` : entry.name,
          isDirectory: entry.is_dir,
          depth: parentDepth + 1,
        }))
        setDirChildren(dirPath, children)
      } catch { /* best-effort */ }
    },
    [config, setDirChildren],
  )

  const apiHeaders = useMemo(() => {
    const h: Record<string, string> = {}
    if (config?.apiToken) h['Authorization'] = `Bearer ${config.apiToken}`
    return h
  }, [config?.apiToken])

  // Clipboard with fallback for environments where Clipboard API is denied.
  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }, [])

  // Resolve the parent (target dir for New File/Folder, parent for rename).
  const splitPath = (node: TreeNode) => {
    const parentPath = node.isDirectory
      ? node.path
      : node.path.replace(/\/[^/]+$/, '')
    const parentRel = node.isDirectory
      ? node.relativePath
      : (node.relativePath.includes('/') ? node.relativePath.replace(/\/[^/]+$/, '') : '')
    const parentDepth = node.isDirectory ? node.depth : node.depth - 1
    return { parentPath, parentRel, parentDepth }
  }

  const handleContextAction = useCallback(
    async (action: FileContextAction, node: TreeNode) => {
      switch (action) {
        case 'copyPath': {
          const ok = await copyText(node.path)
          setStatusToast(ok ? 'Path copied' : 'Copy failed')
          return
        }
        case 'copyRelativePath': {
          const ok = await copyText(node.relativePath)
          setStatusToast(ok ? 'Relative path copied' : 'Copy failed')
          return
        }
        case 'openContaining': {
          const { parentPath } = splitPath(node)
          try {
            await window.orchestraDesktop?.openPath?.(parentPath)
          } catch (err) {
            console.warn('[fs] openPath failed', err)
            setStatusToast('Open failed')
          }
          return
        }
        case 'newFile':
        case 'newFolder': {
          setPromptValue('')
          setPromptDialog({ kind: action, node, initial: '' })
          return
        }
        case 'rename': {
          const oldName = node.path.split('/').pop() ?? ''
          setPromptValue(oldName)
          setPromptDialog({ kind: 'rename', node, initial: oldName })
          return
        }
        case 'delete': {
          setConfirmDialog({ node })
          return
        }
      }
    },
    [copyText],
  )

  const submitPrompt = useCallback(async () => {
    if (!promptDialog || !config) return
    const { kind, node } = promptDialog
    const name = promptValue.trim()
    if (!name) {
      setPromptDialog((d) => (d ? { ...d, error: 'Name is required' } : d))
      return
    }
    if (/[\\/]/.test(name)) {
      setPromptDialog((d) => (d ? { ...d, error: 'Name cannot contain "/" or "\\"' } : d))
      return
    }

    setPromptPending(true)
    try {
      if (kind === 'rename') {
        const { parentPath, parentRel, parentDepth } = splitPath(node)
        if (name === (node.path.split('/').pop() ?? '')) {
          setPromptDialog(null)
          return
        }
        const target = `${parentPath}/${name}`
        const res = await fetch(`${config.baseUrl}/api/v1/workspace/rename`, {
          method: 'POST',
          headers: { ...apiHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: node.path, to: target }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          setPromptDialog((d) => (d ? { ...d, error: `Rename failed: ${errText.slice(0, 200) || res.status}` } : d))
          return
        }
        if (!node.isDirectory) closeFile(node.path)
        await refreshDir(parentPath, parentDepth, parentRel)
        setPromptDialog(null)
        return
      }

      // newFile / newFolder
      const { parentPath, parentRel, parentDepth } = splitPath(node)
      const isFile = kind === 'newFile'
      const target = `${parentPath}/${name}`
      const newRel = parentRel ? `${parentRel}/${name}` : name
      const url = isFile
        ? `${config.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(target)}`
        : `${config.baseUrl}/api/v1/workspace/dir?path=${encodeURIComponent(target)}`
      const res = await fetch(url, {
        method: isFile ? 'PUT' : 'POST',
        headers: isFile ? { ...apiHeaders, 'Content-Type': 'text/plain' } : apiHeaders,
        body: isFile ? '' : undefined,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        setPromptDialog((d) =>
          d ? { ...d, error: `Create failed: ${errText.slice(0, 200) || res.status}` } : d,
        )
        return
      }
      await refreshDir(parentPath, parentDepth, parentRel)
      if (isFile) openFile(target, newRel)
      setPromptDialog(null)
    } catch (err) {
      setPromptDialog((d) =>
        d ? { ...d, error: `Failed: ${(err as Error).message}` } : d,
      )
    } finally {
      setPromptPending(false)
    }
  }, [promptDialog, promptValue, config, apiHeaders, refreshDir, closeFile, openFile])

  const submitConfirm = useCallback(async () => {
    if (!confirmDialog || !config) return
    const { node } = confirmDialog
    setConfirmPending(true)
    try {
      const res = await fetch(
        `${config.baseUrl}/api/v1/workspace/path?path=${encodeURIComponent(node.path)}`,
        { method: 'DELETE', headers: apiHeaders },
      )
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        setConfirmDialog((d) =>
          d ? { ...d, error: `Delete failed: ${errText.slice(0, 200) || res.status}` } : d,
        )
        return
      }
      if (!node.isDirectory) closeFile(node.path)
      const { parentPath, parentRel, parentDepth } = splitPath(node)
      await refreshDir(parentPath, parentDepth, parentRel)
      setConfirmDialog(null)
    } catch (err) {
      setConfirmDialog((d) =>
        d ? { ...d, error: `Failed: ${(err as Error).message}` } : d,
      )
    } finally {
      setConfirmPending(false)
    }
  }, [confirmDialog, config, apiHeaders, refreshDir, closeFile])


  // ---- Empty state -----------------------------------------------------------
  if (!explorerRoot) {
    return (
      <div className="p-4 text-center">
        <p className="text-[11px] text-muted-foreground/60">Open a project to see its files.</p>
      </div>
    )
  }

  // ---- Render ----------------------------------------------------------------
  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      role="tree"
      onContextMenu={(e) => {
        // Only fire when the right-click is on the container itself (i.e. the
        // empty area below the rows) — row clicks already call setCtxMenu.
        if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[role="treeitem"]')) {
          return
        }
        if (!explorerRoot) return
        e.preventDefault()
        const rootNode: TreeNode = {
          name: explorerRoot.split('/').pop() ?? explorerRoot,
          path: explorerRoot,
          relativePath: '',
          isDirectory: true,
          depth: -1,
        }
        setCtxMenu({ x: e.clientX, y: e.clientY, node: rootNode })
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const node = flatRows[virtualRow.index]
          return (
            <FileTreeRow
              key={node.path}
              node={node}
              isExpanded={expandedDirs.has(node.path)}
              gitStatus={gitStatusMap[node.relativePath]}
              onToggle={() => handleToggleDir(node)}
              onClick={() => {
                if (!node.isDirectory) {
                  openFile(node.path, node.relativePath)
                }
              }}
              onContextMenu={(e, n) => setCtxMenu({ x: e.clientX, y: e.clientY, node: n })}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          )
        })}
      </div>
      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          variant={ctxMenu.node.depth < 0 ? 'root' : 'item'}
          onAction={(a) => void handleContextAction(a, ctxMenu.node)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <Dialog
        open={!!promptDialog}
        onOpenChange={(open) => {
          if (!open && !promptPending) setPromptDialog(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {promptDialog?.kind === 'newFile'
                ? 'New file'
                : promptDialog?.kind === 'newFolder'
                  ? 'New folder'
                  : 'Rename'}
            </DialogTitle>
            <DialogDescription>
              {promptDialog?.kind === 'rename'
                ? `Rename "${promptDialog.initial}".`
                : `Will be created under ${
                    promptDialog ? splitPath(promptDialog.node).parentRel || explorerRoot : ''
                  }.`}
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !promptPending) {
                e.preventDefault()
                void submitPrompt()
              }
            }}
            placeholder={
              promptDialog?.kind === 'newFile'
                ? 'filename.ts'
                : promptDialog?.kind === 'newFolder'
                  ? 'folder-name'
                  : ''
            }
            className="w-full mt-1 h-9 px-2.5 rounded-md bg-background border border-border/70 text-sm text-foreground focus:outline-none focus:border-primary/60"
          />
          {promptDialog?.error && (
            <p className="mt-2 text-xs text-destructive">{promptDialog.error}</p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPromptDialog(null)}
              disabled={promptPending}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitPrompt()} disabled={promptPending || !promptValue.trim()}>
              {promptPending
                ? 'Saving…'
                : promptDialog?.kind === 'rename'
                  ? 'Rename'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => {
          if (!open && !confirmPending) setConfirmDialog(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" /> Delete
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.node.isDirectory
                ? 'This folder and everything inside will be permanently deleted.'
                : 'This file will be permanently deleted.'}
            </DialogDescription>
          </DialogHeader>
          {confirmDialog && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="font-mono text-xs text-foreground">{confirmDialog.node.relativePath}</p>
            </div>
          )}
          {confirmDialog?.error && (
            <p className="mt-2 text-xs text-destructive">{confirmDialog.error}</p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog(null)}
              disabled={confirmPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitConfirm()}
              disabled={confirmPending}
            >
              <Trash2 className="size-4 mr-2" />
              {confirmPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {statusToast && (
        <div className="pointer-events-none fixed bottom-10 left-1/2 -translate-x-1/2 z-[10000] rounded-md border border-border/60 bg-popover px-3 py-1.5 text-[12px] font-medium text-foreground shadow-lg">
          {statusToast}
        </div>
      )}
    </div>
  )
}
