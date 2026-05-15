import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { Project } from '@core/api/types'
import type { BackendConfig, GitCommit, GitStatusEntry, GitHubPR, StashEntry, ConflictStatus } from '@core/api/client'
import {
  fetchProjectGitHistory,
  fetchProjectGitStatus,
  fetchProjectGitDiff,
  fetchProjectGitBranches,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitPull,
  gitFetch,
  gitMerge,
  gitDeleteBranch,
  createGitHubRepo,
  gitStashList,
  gitStashApply,
  gitStashDrop,
  gitGetConflicts,
  gitMergeAbort,
  gitConflictResolve,
} from '@core/api/client'
import { BranchBar } from './BranchBar'
import { BranchManagerView } from './BranchManagerView'
import { StagingArea } from './StagingArea'
import { CommitBar } from './CommitBar'
import { CommitTimeline } from './CommitTimeline'
import { DiffViewer } from './DiffViewer'
import { GitHubPanel } from './GitHubPanel'
import { PRReviewView } from './PRReviewView'
import { ResizableSplit } from './ResizableSplit'
import { CreateRepoDialog } from './CreateRepoDialog'
import { ConflictBanner } from './ConflictBanner'

type SubTab = 'changes' | 'history' | 'branches' | 'prs' | 'issues'

const subTabs: { key: SubTab; label: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'history', label: 'History' },
  { key: 'branches', label: 'Branches' },
  { key: 'prs', label: 'PRs' },
  { key: 'issues', label: 'Issues' },
]

function classifyFiles(files: GitStatusEntry[]): { unstaged: GitStatusEntry[]; staged: GitStatusEntry[] } {
  const staged: GitStatusEntry[] = []
  const unstaged: GitStatusEntry[] = []
  if (!files) return { staged, unstaged }
  for (const entry of files) {
    const s = entry.status
    if (s === '??' || s === '? ') {
      unstaged.push({ ...entry, status: '?' })
      continue
    }
    const indexCode = s.charAt(0)
    const wtCode = s.charAt(1)
    if (indexCode !== ' ' && indexCode !== '?') {
      staged.push({ ...entry, status: indexCode })
    }
    if (wtCode !== ' ' && wtCode !== '?') {
      unstaged.push({ ...entry, status: wtCode })
    }
  }
  return { staged, unstaged }
}

export function GitTab({
  project,
  config,
}: {
  project: Project
  config: BackendConfig | null
}) {
  const [currentBranch, setCurrentBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [files, setFiles] = useState<GitStatusEntry[]>([])
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0 })
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFileStaged, setSelectedFileStaged] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('changes')
  const [activePR, setActivePR] = useState<GitHubPR | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreateRepo, setShowCreateRepo] = useState(false)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [conflicts, setConflicts] = useState<ConflictStatus>({ in_merge: false, files: [] })

  const loadAll = useCallback(async () => {
    if (!config) return
    setRefreshing(true)
    try {
      const [branchData, statusData, historyData] = await Promise.all([
        fetchProjectGitBranches(config, project.id),
        fetchProjectGitStatus(config, project.id),
        fetchProjectGitHistory(config, project.id),
      ])
      setCurrentBranch(branchData.current || '')
      setBranches(branchData.branches || [])
      setRemoteBranches(branchData.remotes || [])
      setFiles(statusData?.files || [])
      setAheadBehind(statusData?.branch || { ahead: 0, behind: 0 })
      setCommits(historyData || [])
      const [stashData, conflictData] = await Promise.all([
        gitStashList(config, project.id),
        gitGetConflicts(config, project.id),
      ])
      setStashes(stashData)
      setConflicts(conflictData)
    } catch (err) {
      console.error('git load failed', err)
    } finally {
      setRefreshing(false)
    }
  }, [config, project.id])

  useEffect(() => { loadAll() }, [loadAll])

  // Fetch diff when file or commit is selected
  useEffect(() => {
    if (!config) return
    if (selectedCommit) {
      fetchProjectGitDiff(config, project.id, { hash: selectedCommit })
        .then((d) => setDiff(d))
        .catch(() => setDiff(null))
    } else if (selectedFile) {
      fetchProjectGitDiff(config, project.id, { file: selectedFile, staged: selectedFileStaged })
        .then((d) => setDiff(d))
        .catch(() => setDiff(null))
    } else {
      setDiff(null)
    }
  }, [config, project.id, selectedFile, selectedFileStaged, selectedCommit])

  const { staged, unstaged } = classifyFiles(files)

  function handleFileSelect(path: string, isStaged: boolean) {
    setSelectedFile(path)
    setSelectedFileStaged(isStaged)
    setSelectedCommit(null)
  }

  function handleCommitSelect(hash: string) {
    setSelectedCommit(hash)
    setSelectedFile(null)
  }

  async function handleStage(path: string) {
    if (!config) return
    try {
      await gitStage(config, project.id, [path])
      await loadAll()
    } catch (err) {
      console.error('stage failed', err)
    }
  }

  async function handleUnstage(path: string) {
    if (!config) return
    try {
      await gitUnstage(config, project.id, [path])
      await loadAll()
    } catch (err) {
      console.error('unstage failed', err)
    }
  }

  async function handleStageAll() {
    if (!config) return
    try {
      await gitStage(config, project.id, unstaged.map((f) => f.path))
      await loadAll()
    } catch (err) {
      console.error('stage all failed', err)
    }
  }

  async function handleUnstageAll() {
    if (!config) return
    try {
      await gitUnstage(config, project.id, staged.map((f) => f.path))
      await loadAll()
    } catch (err) {
      console.error('unstage all failed', err)
    }
  }

  async function handleCommit(message: string) {
    if (!config) return
    try {
      await gitCommit(config, project.id, message)
      await loadAll()
    } catch (err) {
      console.error('commit failed', err)
    }
  }

  async function handlePush() {
    if (!config) return
    try {
      await gitPush(config, project.id)
      await loadAll()
    } catch (err) {
      console.error('push failed', err)
    }
  }

  async function handlePull() {
    if (!config) return
    try {
      await gitPull(config, project.id)
      await loadAll()
    } catch (err) {
      console.error('pull failed', err)
    }
  }

  const handleFetch = useCallback(async () => {
    if (!config) return
    try {
      await gitFetch(config, project.id)
      loadAll()
    } catch (err) {
      console.error('fetch failed', err)
    }
  }, [config, project.id, loadAll])

  const handleMerge = useCallback(async (branch: string) => {
    if (!config) return
    try {
      await gitMerge(config, project.id, branch)
      loadAll()
    } catch (err) {
      console.error('merge failed', err)
    }
  }, [config, project.id, loadAll])

  const handleDeleteBranch = useCallback(async (branch: string) => {
    if (!config) return
    try {
      await gitDeleteBranch(config, project.id, branch)
      loadAll()
    } catch (err) {
      console.error('delete branch failed', err)
    }
  }, [config, project.id, loadAll])

  const handleCreateRepo = useCallback(async (opts: { name: string; description: string; private: boolean }) => {
    if (!config) return
    await createGitHubRepo(config, project.id, opts)
    setShowCreateRepo(false)
    loadAll()
  }, [config, project.id, loadAll])

  const handleStashApply = useCallback(async (ref: string) => {
    if (!config) return
    try { await gitStashApply(config, project.id, ref); loadAll() }
    catch (err) { console.error('stash apply failed', err) }
  }, [config, project.id, loadAll])

  const handleStashDrop = useCallback(async (ref: string) => {
    if (!config) return
    try { await gitStashDrop(config, project.id, ref); loadAll() }
    catch (err) { console.error('stash drop failed', err) }
  }, [config, project.id, loadAll])

  const handleConflictResolve = useCallback(async (file: string) => {
    if (!config) return
    try { await gitConflictResolve(config, project.id, file); loadAll() }
    catch (err) { console.error('resolve failed', err) }
  }, [config, project.id, loadAll])

  const handleMergeAbort = useCallback(async () => {
    if (!config) return
    try { await gitMergeAbort(config, project.id); loadAll() }
    catch (err) { console.error('merge abort failed', err) }
  }, [config, project.id, loadAll])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Waiting for backend connection…
      </div>
    )
  }

  const hasGitHub = !!(project.github_owner && project.github_repo)

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      {/* Unified strip: branch + actions (left) · sub-tabs (right) */}
      <div className="flex items-center h-9 border-b border-border/30 shrink-0">
        <BranchBar
          projectId={project.id}
          config={config}
          currentBranch={currentBranch}
          branches={branches}
          remoteBranches={remoteBranches}
          aheadBehind={aheadBehind}
          onBranchChange={loadAll}
          onPush={handlePush}
          onPull={handlePull}
          onFetch={handleFetch}
          onMerge={handleMerge}
          onDeleteBranch={handleDeleteBranch}
          stashes={stashes}
          onStashApply={handleStashApply}
          onStashDrop={handleStashDrop}
        />

        <div className="w-px h-4 bg-border/40 mx-1.5 shrink-0" />

        <AppTooltip content="Refresh">
          <button
            onClick={loadAll}
            disabled={refreshing}
            className="shrink-0 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-refresh-spin' : ''} />
          </button>
        </AppTooltip>

        <div className="flex-1" />

        {/* Sub-tabs aligned right */}
        <div className="flex items-center gap-0 pr-2 shrink-0">
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveSubTab(tab.key)}
                className={`relative inline-flex items-center px-3 h-9 text-[12px] font-medium tracking-tight transition-colors ${
                  isActive ? 'text-foreground' : 'text-muted-foreground/65 hover:text-foreground'
                }`}
              >
                {tab.label}
                {isActive && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Changes tab */}
      {activeSubTab === 'changes' && (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        <ConflictBanner conflicts={conflicts} onResolve={handleConflictResolve} onAbort={handleMergeAbort} />
        <ResizableSplit
          left={
            <div className="flex flex-col h-full">
              <CommitBar
                stagedCount={staged.length}
                aheadCount={aheadBehind.ahead}
                onCommit={handleCommit}
                onPush={handlePush}
              />
              <StagingArea
                unstaged={unstaged}
                staged={staged}
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                onStage={handleStage}
                onUnstage={handleUnstage}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
              />
            </div>
          }
          right={
            <DiffViewer
              filePath={selectedFile}
              diff={diff}
              mode={diffMode}
              onModeChange={setDiffMode}
            />
          }
        />
        </div>
      )}

      {/* History tab */}
      {activeSubTab === 'history' && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-80 shrink-0 border-r border-border/40 overflow-hidden">
            <CommitTimeline
              commits={commits}
              selectedHash={selectedCommit}
              onSelectCommit={handleCommitSelect}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            <DiffViewer
              filePath={selectedCommit ? `commit ${selectedCommit.slice(0, 7)}` : null}
              diff={diff}
              mode={diffMode}
              onModeChange={setDiffMode}
            />
          </div>
        </div>
      )}

      {/* Branches tab */}
      {activeSubTab === 'branches' && (
        <div className="flex-1 overflow-hidden min-h-0">
          <BranchManagerView config={config} projectId={project.id} />
        </div>
      )}

      {/* PRs tab */}
      {activeSubTab === 'prs' && (
        hasGitHub ? (
          <div className="flex-1 overflow-hidden min-h-0">
            <GitHubPanel
              projectId={project.id}
              config={config}
              githubToken={project.github_token ?? ''}
              onOpenPR={setActivePR}
              forceTab="prs"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">No GitHub repository connected</p>
              <p className="text-[11px] text-muted-foreground/70">Connect GitHub in the project header to view pull requests.</p>
            </div>
          </div>
        )
      )}

      {/* Issues tab */}
      {activeSubTab === 'issues' && (
        hasGitHub ? (
          <div className="flex-1 overflow-hidden min-h-0">
            <GitHubPanel
              projectId={project.id}
              config={config}
              githubToken={project.github_token ?? ''}
              onOpenPR={setActivePR}
              forceTab="issues"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">No GitHub repository connected</p>
              <p className="text-[11px] text-muted-foreground/70">Connect GitHub in the project header to view issues.</p>
            </div>
          </div>
        )
      )}

      {/* PR Review overlay */}
      {activePR && (
        <PRReviewView
          projectId={project.id}
          config={config}
          pr={activePR}
          onClose={() => setActivePR(null)}
        />
      )}

      {showCreateRepo && (
        <CreateRepoDialog
          projectName={project.name}
          onCancel={() => setShowCreateRepo(false)}
          onCreate={handleCreateRepo}
        />
      )}
    </div>
  )
}
