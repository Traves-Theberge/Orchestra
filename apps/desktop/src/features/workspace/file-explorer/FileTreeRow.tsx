import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react'
import type { TreeNode } from '@core/store/types'

export const ORCHESTRA_FILE_MIME = 'application/x-orchestra-file'

// Posix single-quoted shell escape: wraps the whole path in '...' and
// replaces any embedded single quote with the closing/escaping/reopening
// pattern '\''. Safe regardless of spaces, $, ", parens, etc.
export function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

type FileTreeRowProps = {
  node: TreeNode
  isExpanded: boolean
  gitStatus?: string
  onToggle: () => void
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  style: React.CSSProperties
}

function gitStatusColor(status?: string): string {
  if (!status) return 'text-foreground'
  switch (status) {
    case 'M':
    case 'MM':
      return 'text-orange-400'
    case 'A':
    case '??':
      return 'text-green-400'
    case 'D':
      return 'text-red-400'
    default:
      return 'text-foreground'
  }
}

export function FileTreeRow({
  node,
  isExpanded,
  gitStatus,
  onToggle,
  onClick,
  onContextMenu,
  style,
}: FileTreeRowProps) {
  const paddingLeft = node.depth * 16 + 8
  const isDir = node.isDirectory

  return (
    <div
      role="treeitem"
      tabIndex={0}
      className="flex items-center cursor-pointer select-none hover:bg-accent/50"
      style={{ ...style, height: 26, paddingLeft }}
      onClick={isDir ? onToggle : onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (isDir) onToggle()
          else onClick()
        }
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, node)
      }}
      aria-expanded={isDir ? isExpanded : undefined}
      draggable
      onDragStart={(e) => {
        const payload = JSON.stringify({
          path: node.path,
          relativePath: node.relativePath,
          isDirectory: isDir,
        })
        e.dataTransfer.setData(ORCHESTRA_FILE_MIME, payload)
        e.dataTransfer.setData('text/plain', shellQuote(node.path))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      {isDir ? (
        isExpanded ? (
          <ChevronDown className="size-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 flex-shrink-0 text-muted-foreground" />
        )
      ) : (
        <File className="size-3.5 flex-shrink-0 text-muted-foreground" />
      )}
      <span
        className={`ml-1.5 text-sm truncate ${gitStatusColor(gitStatus)}`}
      >
        {node.name}
      </span>
    </div>
  )
}
