import { describe, expect, it } from 'vitest'
import { projectWorkspaceAgentRows, sameObservedPath, shortObservedAge } from './workspace-agent-projection'
import type { ProjectWorktree, WorkspaceChatSession } from '@core/api/client'
import type { RunningEntry } from '@core/api/types'

const workspace = { id: 'child', path: 'C:\\Repos\\feature' } as ProjectWorktree
const native = { id: 'chat', project_id: 'repo', workspace_id: 'child', workspace_path: 'c:/repos/feature', title: 'Build', provider: 'codex', status: 'idle', requested_model: 'requested', effective_model: 'observed' } as WorkspaceChatSession & { workspace_id: string; workspace_path: string }
const run = { issue_id: 'task', project_id: 'repo', worktree_path: 'C:\\Repos\\feature', issue_identifier: 'TASK-1', session_id: 'runtime', state: 'RUNNING', provider: 'claude', requested_model: 'requested', title: 'Real task', last_message: 'Reading files' } as RunningEntry
describe('exact workspace agent projection', () => {
  it('joins native and runtime by project and actual workspace ownership', () => {
    expect(projectWorkspaceAgentRows('repo', workspace, [native], [run])).toMatchObject([{ sessionId: 'chat', model: 'observed', modelObserved: true }, { taskId: 'task', title: 'Real task', preview: 'Reading files', modelObserved: false }])
  })
  it('rejects cross-project, cross-workspace and missing cwd observations', () => {
    expect(projectWorkspaceAgentRows('repo', workspace, [{ ...native, project_id: 'wrong' }, { ...native, workspace_id: 'other' }, { ...native, workspace_path: '' }], [{ ...run, project_id: 'wrong' }, { ...run, worktree_path: '' }, { ...run, worktree_path: 'C:\\Repos\\other' }])).toEqual([])
  })
  it('does not infer native ownership for legacy rows without scope', () => {
    expect(projectWorkspaceAgentRows('repo', workspace, [{ ...native, workspace_id: undefined, workspace_path: undefined }], [])).toEqual([])
  })
  it('treats POSIX paths as case sensitive and Windows as case insensitive', () => {
    expect(sameObservedPath('/Repo', '/repo')).toBe(false)
    expect(sameObservedPath('C:\\Repos\\feature\\', 'c:/repos/feature')).toBe(true)
  })
  it('uses actual timestamps only for elapsed presentation', () => {
    expect(shortObservedAge('invalid', 0)).toBe('')
    expect(shortObservedAge('2026-10-04T12:00:00Z', Date.parse('2026-10-04T14:00:00Z'))).toBe('2h')
  })
})
