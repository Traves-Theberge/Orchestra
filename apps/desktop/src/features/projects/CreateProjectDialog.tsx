import { useEffect, useId, useState } from 'react'
import { ArrowLeft, Folder, FolderPlus, Github, Link2, Loader2 } from 'lucide-react'
import { Command } from 'cmdk'
import { Button } from '@ui/button'
import { toDisplayError, type ProjectSetupOptions } from '@core/api/client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@ui/dialog'

type Source = 'local' | 'new' | 'url' | 'github'
const sources = [
  { id: 'new', title: 'New project', description: 'Start a new Git repository from a name', icon: FolderPlus },
  { id: 'local', title: 'Local folder', description: 'Browse a folder on disk', icon: Folder },
  { id: 'url', title: 'Git URL', description: 'Clone from a remote URL', icon: Link2 },
  { id: 'github', title: 'GitHub repository', description: 'Clone GitHub owner/repo', icon: Github },
] as const

// Adapted from T3 Code's MIT-licensed source-first command palette.
// Attribution: docs/licenses/t3-code-project-controls.txt.
export function CreateProjectDialog({ open, onOpenChange, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (path: string, setup?: ProjectSetupOptions) => Promise<void>
}) {
  const [source, setSource] = useState<Source | null>(null)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [remote, setRemote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pathId = useId(), nameId = useId(), remoteId = useId()
  useEffect(() => {
    if (open) { setSource(null); setPath(''); setName(''); setRemote(''); setError(null) }
  }, [open])

  async function browse() {
    setError(null)
    if (typeof window.orchestraDesktop?.selectFolder !== 'function') {
      setError('Folder browsing is unavailable. Enter the absolute project folder path below.')
      return
    }
    setPending(true)
    try {
      const selected = await window.orchestraDesktop.selectFolder()
      if (selected) setPath(selected)
    } catch (cause) { setError(`Could not choose a folder: ${toDisplayError(cause)}. Enter the absolute path or try browsing again.`) }
    finally { setPending(false) }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!source || !path.trim()) return
    setPending(true); setError(null)
    try {
      if (source === 'local') await onSubmit(path.trim())
      else {
        if (source === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(remote.trim())) throw new Error('Enter a GitHub repository as owner/repo.')
        const setup: ProjectSetupOptions = { source: source === 'new' ? 'new' : 'clone', name: name.trim() }
        if (source !== 'new') setup.remote_url = source === 'github' ? `https://github.com/${remote.trim().replace(/\.git$/, '')}.git` : remote.trim()
        await onSubmit(path.trim(), setup)
      }
      onOpenChange(false)
    } catch (cause) { setError(`Could not add project: ${toDisplayError(cause)}`) }
    finally { setPending(false) }
  }

  const field = 'h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40'
  const title = source ? sources.find(item => item.id === source)!.title : 'Add project'
  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value) }}>
    <DialogContent className="max-w-xl gap-0 overflow-hidden rounded-2xl border-border/60 bg-background p-0 shadow-2xl">
      <DialogHeader className="sr-only"><DialogTitle>{title}</DialogTitle><DialogDescription>Choose a project source and its local folder.</DialogDescription></DialogHeader>
      {!source ? <Command className="pt-3" label="Add project sources">
        <div className="px-5 pb-3"><Command.Input autoFocus placeholder="Search..." aria-label="Search project sources" className="h-9 w-full bg-transparent text-sm outline-none" /></div>
        <Command.List className="px-2 pb-3">
          <Command.Empty className="p-4 text-sm text-muted-foreground">No matching sources.</Command.Empty>
          <Command.Group heading="Sources" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {sources.map(item => <Command.Item key={item.id} value={item.title} onSelect={() => { setSource(item.id); setError(null) }} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-muted-foreground data-[selected=true]:bg-muted/50 data-[selected=true]:text-foreground">
              <item.icon className="size-4 shrink-0" /><div><div className="text-sm font-medium">{item.title}</div><div className="text-xs text-muted-foreground/60">{item.description}</div></div>
            </Command.Item>)}
          </Command.Group>
        </Command.List>
        <div className="border-t border-border/40 px-5 py-3 text-xs text-muted-foreground"><span className="mr-4">↑ ↓ Navigate</span><span className="mr-4">Enter Select</span>Esc Close</div>
      </Command> : <form onSubmit={submit} className="space-y-5 p-5">
        <div className="flex items-center gap-3"><button type="button" aria-label="Back to sources" disabled={pending} onClick={() => { setSource(null); setError(null) }} className="rounded-md p-1 text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /></button><h2 className="text-base font-medium">{title}</h2></div>
        {source !== 'local' && <div className="space-y-2"><label htmlFor={nameId} className="text-xs text-muted-foreground">Project name</label><input id={nameId} autoFocus value={name} onChange={event => setName(event.target.value)} required disabled={pending} placeholder="my-project" className={field} /></div>}
        {(source === 'url' || source === 'github') && <div className="space-y-2"><label htmlFor={remoteId} className="text-xs text-muted-foreground">{source === 'github' ? 'GitHub owner/repo' : 'Git clone URL'}</label><input id={remoteId} value={remote} onChange={event => setRemote(event.target.value)} required disabled={pending} placeholder={source === 'github' ? 'owner/repository' : 'https://host/repository.git'} className={field} /></div>}
        <div className="space-y-2"><label htmlFor={pathId} className="text-xs text-muted-foreground">{source === 'local' ? 'Workspace Root Path' : 'Parent folder'}</label><div className="flex gap-2"><input id={pathId} autoFocus={source === 'local'} value={path} onChange={event => setPath(event.target.value)} required disabled={pending} placeholder="C:\\Users\\you\\Projects" className={field} /><Button type="button" variant="outline" aria-label="Browse filesystem" tooltip="Browse filesystem" disabled={pending} onClick={browse}><Folder className="size-4" /></Button></div></div>
        {source !== 'local' && <p className="text-xs text-muted-foreground">Creates a new folder inside the parent. Existing folders are kept. {source === 'new' ? 'An initial commit by Orchestra makes task worktrees available.' : 'Git uses the backend host’s existing authentication.'}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending || !path.trim() || (source !== 'local' && !name.trim()) || ((source === 'url' || source === 'github') && !remote.trim())}>{pending ? <Loader2 className="size-4 animate-spin" /> : source === 'new' ? 'Create project' : source === 'local' ? 'Add Project' : 'Clone project'}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>
}
