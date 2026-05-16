import React from 'react'
import { ChevronRight, File, Folder as FolderIcon, FolderOpen, RefreshCcw } from 'lucide-react'
import type { ProjectTreeNode } from '@core/api/client'

export type VisibleTreeEntry = { node: ProjectTreeNode; level: number; parentPath: string | null }

export function injectTreeChildren(nodes: ProjectTreeNode[], targetPath: string, children: ProjectTreeNode[]): ProjectTreeNode[] {
    return nodes.map((node) => {
        if (node.path === targetPath) return { ...node, children }
        if (node.children?.length) return { ...node, children: injectTreeChildren(node.children, targetPath, children) }
        return node
    })
}

export function filterTreeNodes(nodes: ProjectTreeNode[], query: string, showHidden: boolean): ProjectTreeNode[] {
    const q = query.trim().toLowerCase()
    const out: ProjectTreeNode[] = []
    for (const n of nodes) {
        if (!showHidden && n.name.startsWith('.')) continue
        const kids = n.children ? filterTreeNodes(n.children, query, showHidden) : []
        const match = !q || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
        if (n.is_dir) {
            if (match || kids.length || !q) out.push({ ...n, children: kids })
        } else if (match) {
            out.push(n)
        }
    }
    return out
}

export function flattenVisibleTree(nodes: ProjectTreeNode[], expanded: Record<string, boolean>, level = 0, parent: string | null = null): VisibleTreeEntry[] {
    const out: VisibleTreeEntry[] = []
    for (const node of nodes) {
        out.push({ node, level, parentPath: parent })
        if (node.is_dir && expanded[node.path] && node.children?.length)
            out.push(...flattenVisibleTree(node.children, expanded, level + 1, node.path))
    }
    return out
}

export function getNodeIcon(node: ProjectTreeNode, isOpen: boolean, tone: 'active' | 'default') {
    const cls = tone === 'active' ? 'text-primary' : 'text-muted-foreground/60'
    if (node.is_dir) return isOpen ? <FolderOpen size={13} className={cls} strokeWidth={1.75} /> : <FolderIcon size={13} className={cls} strokeWidth={1.75} />
    return <File size={13} className={cls} strokeWidth={1.75} />
}

export function FileTree({ items, level = 0, expandedPaths, loadingPaths, onToggle, onFileClick, activeFile, focusedPath }: {
    items: ProjectTreeNode[]; level?: number; expandedPaths: Record<string, boolean>; loadingPaths: Record<string, boolean>
    onToggle: (n: ProjectTreeNode) => void | Promise<void>; onFileClick?: (p: string) => void; activeFile?: string | null; focusedPath?: string | null
}) {
    return (
        <div className="flex flex-col">{items.map((item, i) => {
            const isOpen = !!expandedPaths[item.path]
            const isActive = activeFile === item.path
            const isFocused = focusedPath === item.path
            const loading = !!loadingPaths[item.path]
            return (
                <React.Fragment key={`${item.path}-${i}`}>
                    <div
                        role="button"
                        tabIndex={-1}
                        style={{ paddingLeft: `${level * 12 + 12}px` }}
                        className={`group relative flex items-center gap-2 h-7 pr-3 cursor-pointer transition-colors ${
                            isActive
                                ? 'bg-foreground/[0.06] text-foreground'
                                : isFocused
                                    ? 'bg-foreground/[0.03] text-foreground'
                                    : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.03]'
                        }`}
                        onClick={() => item.is_dir ? void onToggle(item) : onFileClick?.(item.path)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                if (item.is_dir) void onToggle(item)
                                else onFileClick?.(item.path)
                            }
                        }}
                    >
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />}
                        {item.is_dir ? (
                            loading
                                ? <RefreshCcw size={11} className="text-muted-foreground/40 animate-refresh-spin shrink-0" />
                                : <ChevronRight size={11} className={`text-muted-foreground/40 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                        ) : <span className="w-[11px] shrink-0" />}
                        {getNodeIcon(item, isOpen, isActive ? 'active' : 'default')}
                        <span className="truncate text-[12px] font-medium tracking-tight">{item.name}</span>
                    </div>
                    {isOpen && item.children?.length ? (
                        <FileTree items={item.children} level={level + 1} expandedPaths={expandedPaths} loadingPaths={loadingPaths}
                            onToggle={onToggle} onFileClick={onFileClick} activeFile={activeFile} focusedPath={focusedPath} />
                    ) : null}
                    {isOpen && item.is_dir && !item.children?.length && !loading && (
                        <div
                            style={{ paddingLeft: `${(level + 1) * 12 + 12}px` }}
                            className="h-6 flex items-center text-[10px] text-muted-foreground/40"
                        >
                            empty
                        </div>
                    )}
                </React.Fragment>
            )
        })}</div>
    )
}
