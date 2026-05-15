import { Activity, Cpu, Database, FileText, FolderTree, ListTodo, Settings2, Terminal } from 'lucide-react'
import { Command } from 'cmdk'
import { useAppStore } from '@core/store'
import { sidebarItems, type SectionID } from '@layout/sections'

interface AppCommandPaletteProps {
  onCreateIssue: (state: string) => void
  onTogglePolling: () => void
}

export function AppCommandPalette({ onCreateIssue, onTogglePolling }: AppCommandPaletteProps) {
  const paletteOpen = useAppStore(s => s.paletteOpen)
  const setPaletteOpen = useAppStore(s => s.setPaletteOpen)
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const projects = useAppStore(s => s.projects)
  const setActiveSection = useAppStore(s => s.setActiveSection)
  const setSelectedProjectID = useAppStore(s => s.setSelectedProjectID)

  const navItems: { id: SectionID; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'ISSUES', label: 'Go to Tasks', icon: ListTodo },
    { id: 'PROJECTS', label: 'Go to Projects', icon: FolderTree },
    { id: 'CONSOLE', label: 'Go to Development', icon: Terminal },
    { id: 'AGENTS', label: 'Go to Agents', icon: Cpu },
    { id: 'WAREHOUSE', label: 'Go to Usage', icon: Database },
    { id: 'SETTINGS', label: 'Go to Settings', icon: Settings2 },
    { id: 'DOCS', label: 'Go to Documentation', icon: FileText },
  ]

  const itemClass = 'flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm text-foreground hover:bg-muted/50 data-[selected=true]:bg-muted/50'

  return (
    <Command.Dialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      label="Global Command Palette"
      className="fixed top-1/2 left-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl z-[100] overflow-hidden"
    >
      <Command.Input
        placeholder="Type a command or search..."
        className="w-full border-b border-border bg-transparent p-4 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        <Command.Empty className="p-4 text-center text-sm text-muted-foreground">No results found.</Command.Empty>

        <Command.Group heading="Navigation" className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Command.Item
              key={id}
              onSelect={() => { setActiveSection(id); setPaletteOpen(false) }}
              className={itemClass}
            >
              <Icon className="size-4" /> {label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Actions" className="px-2 py-1 mt-2 text-xs font-semibold text-muted-foreground border-t border-border/40">
          <Command.Item onSelect={() => { onCreateIssue('Backlog'); setPaletteOpen(false) }} className={itemClass}>
            <ListTodo className="size-4" /> Create New Task
          </Command.Item>
          <Command.Item onSelect={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPaletteOpen(false) }} className={itemClass}>
            <Settings2 className="size-4" /> Toggle Theme
          </Command.Item>
          <Command.Item onSelect={() => { onTogglePolling(); setPaletteOpen(false) }} className={itemClass}>
            <Activity className="size-4" /> Toggle Connection Mode (SSE/Polling)
          </Command.Item>
        </Command.Group>

        {projects.length > 0 && (
          <Command.Group heading="Projects" className="px-2 py-1 mt-2 text-xs font-semibold text-muted-foreground border-t border-border/40">
            {projects.map(p => (
              <Command.Item
                key={p.id}
                onSelect={() => { setActiveSection('PROJECTS'); setSelectedProjectID(p.id); setPaletteOpen(false) }}
                className={itemClass}
              >
                <FolderTree className="size-4" /> {p.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
