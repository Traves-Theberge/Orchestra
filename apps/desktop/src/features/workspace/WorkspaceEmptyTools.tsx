import { useState } from 'react'
import { Folder, GitBranch, MessageSquare, Terminal, FileText, Globe, Wrench } from 'lucide-react'
import { useAppStore } from '@core/store'
import { getActiveWorkspaceContextId, selectedProjectWorkspace } from '@core/store/workspace-context'

interface WorkspaceEmptyToolsProps {
  projectId: string
  onAddTerminal?: () => void
}

export function WorkspaceEmptyTools({ projectId, onAddTerminal }: WorkspaceEmptyToolsProps) {
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [docError, setDocError] = useState('')

  const openFiles = () => {
    useAppStore.getState().addTabToGroup(projectId, { type: 'files', id: 'files' })
  }

  const openGit = () => {
    useAppStore.getState().addTabToGroup(projectId, { type: 'git', id: 'git' })
  }

  const openConversations = () => {
    useAppStore.getState().addTabToGroup(projectId, { type: 'conversations', id: 'conversations' })
  }

  const openTerminal = () => {
    if (onAddTerminal) {
      onAddTerminal()
    } else {
      const state = useAppStore.getState()
      const project = state.projects.find(p => p.id === projectId)
      const id = `shell-${Date.now()}`
      state.setOpenTerminals([
        ...state.openTerminals,
        { id, title: project ? `${project.name} Shell` : 'Shell', projectId: project?.id, cwd: project?.root_path },
      ])
      state.addTabToGroup(projectId, { type: 'terminal', id })
    }
  }

  const openBrowser = () => {
    const state = useAppStore.getState()
    state.openBrowserTab(undefined, getActiveWorkspaceContextId(state))
  }

  const openMarkdown = async () => {
    const before = useAppStore.getState()
    const owner = getActiveWorkspaceContextId(before)
    const root = selectedProjectWorkspace(before)?.path || before.explorerRoot
    const backend = before.config
    if (!root || !backend?.baseUrl) {
      setDocError('Select a workspace with a connected backend to create a document.')
      return
    }
    const filename = `Untitled-${crypto.randomUUID()}.md`
    const path = `${root.replace(/[\\/]+$/, '')}/${filename}`
    setCreatingDoc(true)
    setDocError('')
    try {
      const response = await fetch(`${backend.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain', ...(backend.apiToken ? { Authorization: `Bearer ${backend.apiToken}` } : {}) },
        body: '# Untitled\n\n',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const now = useAppStore.getState()
      now.openFile(path, filename, undefined, owner)
    } catch (cause) {
      setDocError(`Failed to create document: ${cause instanceof Error ? cause.message : 'request failed'}`)
    } finally {
      setCreatingDoc(false)
    }
  }

  const toolCards = [
    {
      id: 'files',
      label: 'Files & terminals',
      description: 'Explore the workspace project tree, inspect and open files',
      icon: <Folder className="size-4 text-sky-400" />,
      onClick: openFiles,
    },
    {
      id: 'git',
      label: 'Git & pull requests',
      description: 'Inspect repository status, diffs, branches, and review changes',
      icon: <GitBranch className="size-4 text-emerald-400" />,
      onClick: openGit,
    },
    {
      id: 'conversations',
      label: 'Conversations',
      description: 'View conversation history, switch active chats, or start new',
      icon: <MessageSquare className="size-4 text-amber-400" />,
      onClick: openConversations,
    },
    {
      id: 'terminal',
      label: 'New terminal',
      description: 'Launch an interactive shell session in the workspace root',
      icon: <Terminal className="size-4 text-violet-400" />,
      onClick: openTerminal,
    },
    {
      id: 'browser',
      label: 'New browser tab',
      description: 'Open an embedded browser for live preview and web documentation',
      icon: <Globe className="size-4 text-blue-400" />,
      onClick: openBrowser,
    },
    {
      id: 'markdown',
      label: 'New markdown document',
      description: 'Create a scratchpad markdown note for thoughts and tasks',
      icon: <FileText className="size-4 text-rose-400" />,
      onClick: () => { void openMarkdown() },
      disabled: creatingDoc,
    },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-xl w-full flex flex-col items-center gap-5">
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-1">
            <Wrench size={20} />
          </div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Workspace Tools</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            Select a tool to open in this panel, or open files and tools from the + menu in the toolbar.
          </p>
        </div>

        {docError && <p role="alert" className="text-xs text-destructive text-center">{docError}</p>}
        {creatingDoc && <p role="status" className="text-xs text-muted-foreground text-center">Creating document…</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full">
          {toolCards.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.disabled}
              onClick={tool.onClick}
              className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-card/60 hover:bg-accent/50 hover:border-border text-left transition-all group disabled:opacity-50"
            >
              <div className="p-2 rounded-md bg-muted/60 shrink-0 group-hover:bg-background transition-colors">
                {tool.icon}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                  {tool.label}
                </span>
                <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                  {tool.description}
                </span>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-2">
          Open a file or add a tool from the + menu
        </p>
      </div>
    </div>
  )
}
