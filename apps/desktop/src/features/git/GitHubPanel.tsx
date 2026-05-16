import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, CircleDot, GitPullRequest } from 'lucide-react'
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
import { GitHubIssuesTab } from './GitHubIssuesTab'
import { GitHubPRsTab } from './GitHubPRsTab'

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

  const [issuePage, setIssuePage] = useState(1)
  const [issueHasMore, setIssueHasMore] = useState(false)
  const [prPage, setPrPage] = useState(1)
  const [prHasMore, setPrHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

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

  useEffect(() => {
    fetchDefaultBranch(config, projectId)
      .then((branch) => {
        setDefaultBranch(branch)
        setNewPRBase(branch)
      })
      .catch(() => {})
  }, [config, projectId])

  useEffect(() => { loadData() }, [loadData])

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

          {tab === 'issues' && (
            <GitHubIssuesTab
              issues={issues}
              issueFilter={issueFilter}
              onSetIssueFilter={setIssueFilter}
              loadError={!!loadError}
              showCreateIssue={showCreateIssue}
              onToggleShowCreate={() => setShowCreateIssue((v) => !v)}
              newIssueTitle={newIssueTitle}
              setNewIssueTitle={setNewIssueTitle}
              newIssueBody={newIssueBody}
              setNewIssueBody={setNewIssueBody}
              onCreateIssue={handleCreateIssue}
              loading={loading}
              expandedIssue={expandedIssue}
              onToggleExpandedIssue={(n) => setExpandedIssue(expandedIssue === n ? null : n)}
              onToggleIssueState={handleToggleIssueState}
              hasMore={issueHasMore}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMoreIssues()}
            />
          )}

          {tab === 'prs' && (
            <GitHubPRsTab
              prs={prs}
              branches={branches}
              loadError={!!loadError}
              showCreatePR={showCreatePR}
              onToggleShowCreate={() => setShowCreatePR((v) => !v)}
              newPRTitle={newPRTitle}
              setNewPRTitle={setNewPRTitle}
              newPRBody={newPRBody}
              setNewPRBody={setNewPRBody}
              newPRHead={newPRHead}
              setNewPRHead={setNewPRHead}
              newPRBase={newPRBase}
              setNewPRBase={setNewPRBase}
              onCreatePR={handleCreatePR}
              loading={loading}
              onOpenPR={onOpenPR}
              hasMore={prHasMore}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMorePRs()}
            />
          )}
        </div>
      )}
    </div>
  )
}
