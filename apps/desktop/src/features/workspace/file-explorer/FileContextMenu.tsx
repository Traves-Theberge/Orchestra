import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react'

export type FileContextAction =
  | 'newFile'
  | 'newFolder'
  | 'copyPath'
  | 'copyRelativePath'
  | 'openContaining'
  | 'rename'
  | 'delete'

const MENU_W = 260
const MENU_H = 320

export function FileContextMenu({
  x,
  y,
  variant = 'item',
  onAction,
  onClose,
}: {
  x: number
  y: number
  variant?: 'item' | 'root'
  onAction: (action: FileContextAction) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_W - 8)
  const top = Math.min(Math.max(8, y), window.innerHeight - MENU_H - 8)

  const fire = (a: FileContextAction) => {
    onAction(a)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-portal-menu="open"
      className="fixed z-[9999] bg-popover border border-border/60 rounded-lg shadow-xl py-1 backdrop-blur-sm text-foreground"
      style={{ left, top, minWidth: MENU_W }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Item icon={<FilePlus size={13} />} label="New File" onClick={() => fire('newFile')} />
      <Item icon={<FolderPlus size={13} />} label="New Folder" onClick={() => fire('newFolder')} />
      {variant === 'item' && (
        <>
          <Divider />
          <Item icon={<Copy size={13} />} label="Copy Path" shortcut="Shift+Alt+C" onClick={() => fire('copyPath')} />
          <Item icon={<Copy size={13} />} label="Copy Relative Path" shortcut="Ctrl+Shift+Alt+C" onClick={() => fire('copyRelativePath')} />
          <Item icon={<ExternalLink size={13} />} label="Open Containing Folder" onClick={() => fire('openContaining')} />
          <Divider />
          <Item icon={<Pencil size={13} />} label="Rename" shortcut="Enter" onClick={() => fire('rename')} />
          <Item
            icon={<Trash2 size={13} className="text-destructive" />}
            label="Delete"
            shortcut="Del"
            destructive
            onClick={() => fire('delete')}
          />
        </>
      )}
    </div>,
    document.body,
  )
}

function Item({
  icon,
  label,
  shortcut,
  destructive,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-[12.5px] font-medium text-left transition-colors hover:bg-accent/60 ${
        destructive ? 'text-destructive hover:text-destructive' : 'text-foreground'
      }`}
    >
      <span className="inline-flex size-4 items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70 font-mono">{shortcut}</span>
      )}
    </button>
  )
}

function Divider() {
  return <div className="my-1 h-px bg-border/60" />
}
