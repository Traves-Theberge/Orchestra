import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSource } from './worktree-source'
import type { GitHubIssue } from '@core/api/client'
const issues = [{ number: 12, title: 'Fix files' } as GitHubIssue]
describe('worktree source resolution', () => {
  it('resolves observed branch as base without reusing checked out branch', () => expect(resolveWorkspaceSource('feature', 'smart', '', ['feature'], [])).toEqual({ name: 'feature-work', baseRef: 'feature' }))
  it('resolves only an observed issue from configured GitHub repository', () => expect(resolveWorkspaceSource('https://github.com/owner/repo/issues/12', 'smart', 'git@github.com:owner/repo.git', [], issues).name).toBe('issue-12-fix-files'))
  it('rejects foreign repositories, unknown issue numbers and unsupported trackers', () => {
    expect(() => resolveWorkspaceSource('https://github.com/other/repo/issues/12', 'smart', 'https://github.com/owner/repo', [], issues)).toThrow('configured')
    expect(() => resolveWorkspaceSource('#13', 'smart', '', [], issues)).toThrow('not been observed')
    expect(() => resolveWorkspaceSource('https://linear.app/team/issue/a', 'smart', '', [], [])).toThrow('not available')
  })
  it('keeps plain names as workspaces without making tasks', () => expect(resolveWorkspaceSource('Marketing preview', 'name', '', [], []).name).toBe('marketing-preview'))
})
