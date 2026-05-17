import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Globe } from 'lucide-react'

interface ProjectSelectorProps {
  projects: Array<{ id: string; name: string }>
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function ProjectSelector({ projects, selectedId, onChange }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = selectedId ? projects.find(p => p.id === selectedId) : null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <span className="text-[10px] text-foreground/40 mr-2">vs</span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/40 bg-background hover:bg-foreground/[0.04] text-[11px] text-foreground/85"
      >
        {selected ? (
          <FolderOpen size={11} className="text-foreground/50" />
        ) : (
          <Globe size={11} className="text-foreground/50" />
        )}
        <span className="truncate max-w-[140px]">
          {selected ? selected.name : 'Global only'}
        </span>
        <ChevronDown size={10} className="text-foreground/40" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-md border border-border/50 bg-popover shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-foreground/[0.04] ${selectedId === null ? 'bg-foreground/[0.06]' : ''}`}
          >
            <Globe size={11} className="text-foreground/50 shrink-0" />
            <span className="flex-1 truncate">Global only — hide project column</span>
          </button>
          {projects.length > 0 && <div className="h-px bg-border/40" />}
          {projects.map(p => (
            <button
              key={p.id}
              role="menuitem"
              type="button"
              onClick={() => { onChange(p.id); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-foreground/[0.04] ${selectedId === p.id ? 'bg-foreground/[0.06]' : ''}`}
            >
              <FolderOpen size={11} className="text-foreground/50 shrink-0" />
              <span className="flex-1 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
