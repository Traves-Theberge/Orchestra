import { File, Folder, GitBranch, Globe, MessageSquare, Terminal } from 'lucide-react'
import { useAppStore } from '@core/store'
import { projectIdForWorkspaceContext, workspaceSelectionKey } from '@core/store/workspace-context'
import type { TabRef, WorkspaceContextID } from '@core/store/types'
import { EditorContent } from '../editor/EditorContent'
import { BrowserContent } from '../browser/BrowserContent'
import { TerminalView } from '@features/terminal/TerminalView'
import { GitTab } from '@features/git'
import { FileExplorer } from '../file-explorer/FileExplorer'
import { ConversationsPanel } from '../panels/ConversationsPanel'

/** Renders one tab's content. Shared by the center strip and the tools panel groups. */
export function TabContent({ projectId, tabRef, onInspectTask }: { projectId: WorkspaceContextID; tabRef: TabRef; onInspectTask?: (identifier: string) => void }) {
  const file = useAppStore(s => tabRef.type === 'editor' ? s.openFiles.find(f => f.id === tabRef.id) : undefined)
  const browserTab = useAppStore(s => tabRef.type === 'browser' ? s.browserTabs.find(t => t.id === tabRef.id) : undefined)
  const terminal = useAppStore(s => tabRef.type === 'terminal' ? s.openTerminals.find(t => t.id === tabRef.id) : undefined)
  const config = useAppStore(s => s.config)

  if (tabRef.type === 'editor') return file ? <EditorContent file={file} /> : null
  if (tabRef.type === 'browser') return browserTab ? <BrowserContent tab={browserTab} /> : null
  if (tabRef.type === 'terminal') {
    if (!terminal || !config) return null
    return (
      <TerminalView
        sessionId={terminal.id}
        projectId={terminal.projectId}
        cwd={terminal.cwd}
        baseUrl={config.baseUrl}
        apiToken={config.apiToken}
        initialCommand={terminal.initialCommand}
      />
    )
  }
  if (tabRef.type === 'git') {
    const state = useAppStore.getState()
    const project = state.projects.find(p => p.id === projectIdForWorkspaceContext(state, projectId))
    const workspace = config ? state.knownProjectWorkspaces[workspaceSelectionKey(config.baseUrl, projectId)] : undefined
    if (!project || !config) return null
    return (
      <div role="tabpanel" aria-label="Git & pull requests" className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <GitTab
          key={`${config.baseUrl}:${projectId}`}
          project={project}
          config={config}
          workspace={workspace ? { id: workspace.workspaceId, path: workspace.path, branch: workspace.branch } : undefined}
          onInspectTask={onInspectTask}
        />
      </div>
    )
  }
  if (tabRef.type === 'files') {
    return (
      <section aria-label="Workspace files view" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <FileExplorer />
      </section>
    )
  }
  if (tabRef.type === 'conversations') {
    return (
      <div role="tabpanel" aria-label="Conversations" className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <ConversationsPanel projectId={projectId} />
      </div>
    )
  }
  return null
}

/** Small leading icon for a tab. */
export function TabIcon({ tabRef, active, size = 11 }: { tabRef: TabRef; active: boolean; size?: number }) {
  const className = active ? 'text-primary' : 'text-muted-foreground/50'
  if (tabRef.type === 'editor') return <File size={size} className={className} />
  if (tabRef.type === 'browser') return <Globe size={size} className={className} />
  if (tabRef.type === 'git') return <GitBranch size={size} className={className} />
  if (tabRef.type === 'files') return <Folder size={size} className={className} />
  if (tabRef.type === 'conversations') return <MessageSquare size={size} className={className} />
  return <Terminal size={size} className={className} />
}
