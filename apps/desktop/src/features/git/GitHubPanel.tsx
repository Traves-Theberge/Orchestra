import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@core/store'
import { ChevronDown, ChevronRight, ExternalLink, CircleDot, GitPullRequest, Plus, X } from 'lucide-react'
import type { BackendConfig, GitHubIssue, GitHubPR } from '@core/api/client'
import {
  fetchProjectGitHubIssues,
  fetchProjectGitHubPulls,
  createProjectGitHubIssue,
  updateProjectGitHubIssue,
  createProjectGitHubPull,
  fetchProjectGitBranches,
  fetchDefaultBranch,
} from '@core/api/client'

type SubTab = 'issues' | 'prs'
type IssueFilter = 'open' | 'closed' | 'all'

function friendlyErrorMessage(err: unknown): { summary: string; detail: string } {
  const raw = err instanceof Error ? err.message : String(err)
  if (/unauthorized|401/i.test(raw)) {
    return { summary: 'GitHub authentication failed. Reconnect in project settings.', detail: raw }
  }
  if (/rate.limit|429/i.test(raw)) {
    return { summary: 'GitHub rate limit exceeded. Please wait and try again.', detail: raw }
  }
  return { summary: 'Failed to load GitHub data.', detail: raw }
}

export function GitHubPanel({
  projectId,
  config,
  onOpenPR,
  forceTab,
}: {
  projectId: string
  config: BackendConfig
  githubToken: string
  onOpenPR: (pr: GitHubPR) => void
  forceTab?: 'issues' | 'prs'
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<SubTab>(forceTab ?? 'issues')
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('open')
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [prs, setPRs] = useState<GitHubPR[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null)
  const [showCreateIssue, setShowCreateIssue] = useState(false)
  const [showCreatePR, setShowCreatePR] = useState(false)
  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [newIssueBody, setNewIssueBody] = useState('')
  const [newPRTitle, setNewPRTitle] = useState('')
  const [newPRBody, setNewPRBody] = useState('')
  const [newPRHead, setNewPRHead] = useState('')
  const [newPRBase, setNewPRBase] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<{ summary: string; detail: string } | null>(null)

  // Pagination state
  const [issuePage, setIssuePage] = useState(1)
  const [issueHasMore, setIssueHasMore] = useState(false)
  const [prPage, setPrPage] = useState(1)
  const [prHasMore, setPrHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Default branch for PR base
  const [defaultBranch, setDefaultBranch] = useState('main')

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const [issueData, prData, branchData] = await Promise.all([
        fetchProjectGitHubIssues(config, projectId, issueFilter === 'all' ? 'all' : issueFilter),
        fetchProjectGitHubPulls(config, projectId),
        fetchProjectGitBranches(config, projectId),
      ])
      setIssues(issueData?.issues || [])
      setIssueHasMore(issueData?.has_more || false)
      setIssuePage(1)
      setPRs(prData?.pulls || [])
      setPrHasMore(prData?.has_more || false)
      setPrPage(1)
      setBranches(branchData?.branches || [])
    } catch (err) {
      console.error('github load failed', err)
      setLoadError(friendlyErrorMessage(err))
    }
  }, [config, projectId, issueFilter])

  // Fetch default branch on mount
  useEffect(() => {
    fetchDefaultBranch(config, projectId)
      .then((branch) => {
        setDefaultBranch(branch)
        setNewPRBase(branch)
      })
      .catch(() => {
        // Keep the fallback default
      })
  }, [config, projectId])

  useEffect(() => { loadData() }, [loadData])

  // Set default base branch when PR form opens
  useEffect(() => {
    if (showCreatePR && !newPRBase) {
      setNewPRBase(defaultBranch)
    }
  }, [showCreatePR, defaultBranch, newPRBase])

  const loadMoreIssues = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = issuePage + 1
      const data = await fetchProjectGitHubIssues(config, projectId, issueFilter === 'all' ? 'all' : issueFilter, nextPage)
      setIssues((prev) => [...prev, ...(data?.issues || [])])
      setIssueHasMore(data?.has_more || false)
      setIssuePage(nextPage)
    } catch (err) {
      console.error('load more issues failed', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const loadMorePRs = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = prPage + 1
      const data = await fetchProjectGitHubPulls(config, projectId, nextPage)
      setPRs((prev) => [...prev, ...(data?.pulls || [])])
      setPrHasMore(data?.has_more || false)
      setPrPage(nextPage)
    } catch (err) {
      console.error('load more PRs failed', err)
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleCreateIssue() {
    if (!newIssueTitle.trim() || loading) return
    setLoading(true)
    try {
      await createProjectGitHubIssue(config, projectId, { title: newIssueTitle, body: newIssueBody })
      setNewIssueTitle('')
      setNewIssueBody('')
      setShowCreateIssue(false)
      await loadData()
    } catch (err) {
      console.error('create issue failed', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleIssueState(issue: GitHubIssue) {
    setLoading(true)
    try {
      await updateProjectGitHubIssue(config, projectId, issue.number, {
        state: issue.state === 'open' ? 'closed' : 'open',
      })
      await loadData()
    } catch (err) {
      console.error('toggle issue failed', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreatePR() {
    if (!newPRTitle.trim() || !newPRHead || !newPRBase || loading) return
    setLoading(true)
    try {
      await createProjectGitHubPull(config, projectId, {
        title: newPRTitle,
        body: newPRBody,
        head: newPRHead,
        base: newPRBase,
      })
      setNewPRTitle('')
      setNewPRBody('')
      setNewPRHead('')
      setNewPRBase('')
      setShowCreatePR(false)
      await loadData()
    } catch (err) {
      console.error('create PR failed', err)
    } finally {
      setLoading(false)
    }
  }

  function prStatusStyle(pr: GitHubPR): string {
    if (pr.merged_at) return 'text-purple-400'
    if (pr.state === 'closed') return 'text-destructive'
    return 'text-emerald-500'
  }

  function prStatusLabel(pr: GitHubPR): string {
    if (pr.merged_at) return 'merged'
    return pr.state
  }

  return (
    <div className={forceTab ? 'h-full flex flex-col bg-background' : ''}>
      {!forceTab && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center gap-2 px-3 h-9 hover:bg-foreground/[0.03] transition-colors border-b border-border/30"
        >
          {collapsed ? <ChevronRight size={13} className="text-muted-foreground/60" /> : <ChevronDown size={13} className="text-muted-foreground/60" />}
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">GitHub</span>
          <span className="text-[11px] text-muted-foreground/50 ml-1 tabular-nums">
            {issues.length} issues · {prs.length} PRs
          </span>
        </button>
      )}

      {(forceTab || !collapsed) && (
        <div className={forceTab ? 'flex-1 overflow-auto px-5 py-4' : 'px-3 pb-3'}>
          {loadError && (
            <div className="mb-3 px-3 py-2 rounded-md bg-destructive/10 text-[11px] text-destructive">
              <p className="font-medium">{loadError.summary}</p>
              <details className="mt-1">
                <summary className="text-[10px] text-destructive/70 cursor-pointer">Details</summary>
                <pre className="text-[10px] text-destructive/60 mt-1 whitespace-pre-wrap break-all">{loadError.detail}</pre>
              </details>
            </div>
          )}

          {!forceTab && (
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setTab('issues')}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium tracking-tight transition-colors ${
                  tab === 'issues' ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                <CircleDot size={11} /> Issues
              </button>
              <button
                onClick={() => setTab('prs')}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium tracking-tight transition-colors ${
                  tab === 'prs' ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                <GitPullRequest size={11} /> PRs
              </button>
            </div>
          )}

          {/* Issues tab */}
          {tab === 'issues' && (
            <div>
              <div className="flex items-center gap-1 mb-3">
                <div className="flex items-center rounded-md bg-muted/30 p-0.5">
                  {(['open', 'closed', 'all'] as IssueFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setIssueFilter(f)}
                      className={`px-2.5 h-6 rounded text-[10.5px] font-medium tracking-tight transition-colors capitalize ${
                        issueFilter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowCreateIssue((v) => !v)}
                  className="ml-auto size-7 grid place-items-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  title={showCreateIssue ? 'Cancel' : 'New issue'}
                >
                  {showCreateIssue ? <X size={13} /> : <Plus size={13} />}
                </button>
              </div>

              {showCreateIssue && (
                <div className="mb-3 p-3 rounded-md bg-muted/20 space-y-2">
                  <input
                    value={newIssueTitle}
                    onChange={(e) => setNewIssueTitle(e.target.value)}
                    placeholder="Issue title"
                    className="w-full h-8 px-3 rounded-md bg-background text-[12px] font-medium placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                  />
                  <textarea
                    value={newIssueBody}
                    onChange={(e) => setNewIssueBody(e.target.value)}
                    placeholder="Description (optional)"
                    rows={3}
                    className="w-full px-3 py-2 rounded-md bg-background text-[12px] placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
                  />
                  <button
                    onClick={handleCreateIssue}
                    disabled={!newIssueTitle.trim() || loading}
                    className="inline-flex items-center h-8 px-3 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11.5px] font-semibold tracking-tight disabled:opacity-40 transition-colors"
                  >
                    Create issue
                  </button>
                </div>
              )}

              <div className="flex flex-col">
                {issues.map((issue) => (
                  <div key={issue.number}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.03] cursor-pointer transition-colors"
                      onClick={() => setExpandedIssue(expandedIssue === issue.number ? null : issue.number)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedIssue(expandedIssue === issue.number ? null : issue.number) } }}
                    >
                      <CircleDot size={11} className={issue.state === 'open' ? 'text-emerald-500 shrink-0' : 'text-destructive shrink-0'} />
                      <span className="text-[12px] text-foreground/90 truncate flex-1">
                        <span className="font-mono text-muted-foreground/60 mr-1.5">#{issue.number}</span>
                        {issue.title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          useAppStore.getState().setActiveSection('CONSOLE')
                          useAppStore.getState().openBrowserTab(issue.html_url)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-foreground transition-all p-0.5"
                      >
                        <ExternalLink size={11} />
                      </button>
                    </div>
                    {expandedIssue === issue.number && (
                      <div className="ml-6 px-2 py-1.5 text-[11.5px] text-muted-foreground/85">
                        <p className="mb-2 whitespace-pre-wrap leading-relaxed">{issue.body || 'No description'}</p>
                        <button
                          onClick={() => handleToggleIssueState(issue)}
                          disabled={loading}
                          className="text-[10.5px] font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                          {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {issues.length === 0 && !loadError && (
                  <div className="text-[11px] text-muted-foreground/50 text-center py-6">No issues</div>
                )}
              </div>
              {issueHasMore && (
                <button
                  onClick={() => void loadMoreIssues()}
                  disabled={loadingMore}
                  className="w-full mt-2 h-8 text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-40 transition-colors"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}

          {/* PRs tab */}
          {tab === 'prs' && (
            <div>
              <div className="flex items-center mb-3">
                <button
                  onClick={() => setShowCreatePR((v) => !v)}
                  className="ml-auto size-7 grid place-items-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  title={showCreatePR ? 'Cancel' : 'New PR'}
                >
                  {showCreatePR ? <X size={13} /> : <Plus size={13} />}
                </button>
              </div>

              {showCreatePR && (
                <div className="mb-3 p-3 rounded-md bg-muted/20 space-y-2">
                  <input
                    value={newPRTitle}
                    onChange={(e) => setNewPRTitle(e.target.value)}
                    placeholder="PR title"
                    className="w-full h-8 px-3 rounded-md bg-background text-[12px] font-medium placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                  />
                  <textarea
                    value={newPRBody}
                    onChange={(e) => setNewPRBody(e.target.value)}
                    placeholder="Description"
                    rows={3}
                    className="w-full px-3 py-2 rounded-md bg-background text-[12px] placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/40 resize-none transition-all"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newPRHead}
                      onChange={(e) => setNewPRHead(e.target.value)}
                      className="h-8 px-2 rounded-md bg-background text-[11.5px] outline-none focus:ring-1 focus:ring-primary/40"
                    >
                      <option value="">Head branch</option>
                      {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <select
                      value={newPRBase}
                      onChange={(e) => setNewPRBase(e.target.value)}
                      className="h-8 px-2 rounded-md bg-background text-[11.5px] outline-none focus:ring-1 focus:ring-primary/40"
                    >
                      <option value="">Base branch</option>
                      {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={handleCreatePR}
                    disabled={!newPRTitle.trim() || !newPRHead || !newPRBase || loading}
                    className="inline-flex items-center h-8 px-3 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11.5px] font-semibold tracking-tight disabled:opacity-40 transition-colors"
                  >
                    Create PR
                  </button>
                </div>
              )}

              <div className="flex flex-col">
                {prs.map((pr) => (
                  <button
                    key={pr.number}
                    onClick={() => onOpenPR(pr)}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/[0.03] text-left transition-colors"
                  >
                    <GitPullRequest size={11} className={`shrink-0 ${prStatusStyle(pr)}`} />
                    <span className={`text-[10px] font-semibold uppercase tracking-tight shrink-0 ${prStatusStyle(pr)}`}>
                      {prStatusLabel(pr)}
                    </span>
                    <span className="text-[12px] text-foreground/90 truncate flex-1">
                      <span className="font-mono text-muted-foreground/60 mr-1.5">#{pr.number}</span>
                      {pr.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                      {pr.base.ref} ← {pr.head.ref}
                    </span>
                  </button>
                ))}
                {prs.length === 0 && !loadError && (
                  <div className="text-[11px] text-muted-foreground/50 text-center py-6">No pull requests</div>
                )}
              </div>
              {prHasMore && (
                <button
                  onClick={() => void loadMorePRs()}
                  disabled={loadingMore}
                  className="w-full mt-2 h-8 text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-40 transition-colors"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
