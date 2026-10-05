import type { GitHubIssue } from '@core/api/client'
export type WorkspaceSourceMode = 'smart' | 'github' | 'branch' | 'name'
export function workspaceSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80)
}
/** Resolve references only against observations from the selected repository. */
export function resolveWorkspaceSource(input: string, mode: WorkspaceSourceMode, remote: string, branches: string[], issues: GitHubIssue[]): { name: string; baseRef?: string } {
  const value = input.trim()
  if (!value) throw new Error('Enter a worktree name or repository reference.')
  if (/jira|linear\.app|gitlab/i.test(value) && /^https?:/i.test(value)) throw new Error('Jira, Linear and GitLab references are not available in this worktree flow.')
  if (mode !== 'name' && (mode === 'github' || /^#\d+$/.test(value) || /^https?:/i.test(value))) {
    let number = /^#?\d+$/.test(value) ? Number(value.replace('#', '')) : 0
    if (!number) {
      let url: URL
      try { url = new URL(value) } catch { throw new Error('Enter #123 or a GitHub issue URL.') }
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
      const repository = remote.replace(/\.git$/, '').match(/github\.com[:/]([^/]+)\/([^/]+)\/?$/)
      if (url.hostname !== 'github.com' || !match || !repository || `${match[1]}/${match[2]}`.toLowerCase() !== `${repository[1]}/${repository[2]}`.toLowerCase()) throw new Error('Choose an issue from this project’s configured GitHub repository.')
      number = Number(match[3])
    }
    const issue = issues.find(issue => issue.number === number)
    if (!issue) throw new Error('That GitHub issue has not been observed in this project. Select an issue from the list or use Name.')
    return { name: workspaceSlug(`issue-${number}-${issue.title}`) }
  }
  if (mode === 'branch' || (mode === 'smart' && branches.includes(value))) {
    if (!branches.includes(value)) throw new Error('Choose a branch observed in this project.')
    return { name: workspaceSlug(`${value}-work`), baseRef: value }
  }
  const name = workspaceSlug(value)
  if (!name) throw new Error('Enter a name containing letters or numbers.')
  return { name }
}
