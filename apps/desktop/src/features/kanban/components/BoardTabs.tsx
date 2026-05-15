import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Folder } from 'lucide-react'

import type { Project } from '@core/api/types'

type Props = {
  activeTab: 'board' | 'workitems'
  onTabChange: (tab: 'board' | 'workitems') => void
  projects: Project[]
  selectedProjectID: string | null
  onSelectProject: (id: string) => void
}

export function BoardTabs({ activeTab, onTabChange, projects, selectedProjectID, onSelectProject }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  const activeProject = projects.find(p => p.id === selectedProjectID) ?? null

  return (
    <div className="flex items-center gap-1 px-5 pt-4 shrink-0">
      <button
        onClick={() => onTabChange('board')}
        className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${activeTab === 'board' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'}`}
      >
        Board
      </button>
      <button
        onClick={() => onTabChange('workitems')}
        className={`h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${activeTab === 'workitems' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'}`}
      >
        Work Items
      </button>

      {activeTab === 'workitems' && projects.length > 0 && (
        <div className="relative ml-2" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="h-8 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 border border-border/40 bg-background hover:bg-foreground/[0.04] text-foreground/80 transition-colors"
          >
            <Folder size={12} className="text-muted-foreground/60 shrink-0" />
            <span className="max-w-[160px] truncate">{activeProject?.name ?? 'Select project'}</span>
            <ChevronDown size={11} className="text-muted-foreground/50 shrink-0" />
          </button>

          {pickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-w-[280px] rounded-lg border border-border/40 bg-popover shadow-lg overflow-hidden">
              {projects.map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => { onSelectProject(p.id); setPickerOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-foreground/[0.04] transition-colors ${idx > 0 ? 'border-t border-border/20' : ''} ${p.id === selectedProjectID ? 'bg-foreground/[0.06]' : ''}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.id === selectedProjectID ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                  <span className="text-[12px] font-medium text-foreground/85 truncate flex-1">{p.name}</span>
                  {p.issue_source_type && (
                    <span className="text-[10px] text-muted-foreground/50 shrink-0 font-mono">{p.issue_source_type}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
