import { useState, useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { Project } from '@core/api/types'
import type { BackendConfig, GitHubPR } from '@core/api/client'
import { fetchProjectGitDiff } from '@core/api/client'
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
import { useGitActions } from './use-git-actions'
import { GitHubConnectBadge } from './GitHubConnectBadge'

type SubTab = 'changes' | 'history' | 'branches' | 'prs' | 'issues'

const subTabs: { key: SubTab; label: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'history', label: 'History' },
  { key: 'branches', label: 'Branches' },
  { key: 'prs', label: 'PRs' },
  { key: 'issues', label: 'Issues' },
]

function NoGitHubMessage({ kind }: { kind: 'pull requests' | 'issues' }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="text-center space-y-2">
        <p className="text-sm font-semibold text-foreground">No GitHub repository connected</p>
        <p className="text-[11px] text-muted-foreground/70">Connect GitHub from the Git toolbar to view {kind}.</p>
      </div>
    </div>
  )
}

type GitTabProps = {
  project: Project
  config: BackendConfig | null
  onInspectTask?: (identifier: string) => void
  workspace?: { id: string; path: string; branch: string }
}

export function GitTab(props: GitTabProps) {
  return <ScopedGitTab key={`${props.config?.baseUrl}:${props.project.id}:${props.workspace?.id ?? 'registered'}`} {...props} />
}

function ScopedGitTab({
  project,
  config: baseConfig,
  onInspectTask,
  workspace,
}: GitTabProps) {
  const config = useMemo(() => baseConfig && workspace ? { ...baseConfig, workspaceId: workspace.id } : baseConfig, [baseConfig, workspace])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFileStaged, setSelectedFileStaged] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified')
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('changes')
  const [activePR, setActivePR] = useState<GitHubPR | null>(null)
  const [showCreateRepo, setShowCreateRepo] = useState(false)

  const git = useGitActions(config, project.id)

  useEffect(() => {
    if (!config || (!selectedCommit && !selectedFile)) return
    let cancelled = false
    const options = selectedCommit ? { hash: selectedCommit } : { file: selectedFile!, staged: selectedFileStaged }
    fetchProjectGitDiff(config, project.id, options)
      .then((value) => { if (!cancelled) setDiff(value) })
      .catch(() => { if (!cancelled) setDiff(null) })
    return () => { cancelled = true }
  }, [config, project.id, selectedFile, selectedFileStaged, selectedCommit])

  function handleFileSelect(path: string, isStaged: boolean) {
    setSelectedFile(path)
    setSelectedFileStaged(isStaged)
    setSelectedCommit(null)
  }

  function handleCommitSelect(hash: string) {
    setSelectedCommit(hash)
    setSelectedFile(null)
  }

  const handleCreateRepo = async (opts: { name: string; description: string; private: boolean }) => {
    await git.handleCreateRepo(opts)
    setShowCreateRepo(false)
  }

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
      <div className="flex min-w-0 flex-wrap items-center border-b border-border/30 shrink-0">
        <div className="min-w-0 flex-1 overflow-x-auto">
        <BranchBar
          projectId={project.id}
          config={config}
          currentBranch={git.currentBranch}
          branches={git.branches}
          remoteBranches={git.remoteBranches}
          aheadBehind={git.aheadBehind}
          onBranchChange={git.loadAll}
          onPush={git.handlePush}
          onPull={git.handlePull}
          onFetch={git.handleFetch}
          onMerge={git.handleMerge}
          onDeleteBranch={git.handleDeleteBranch}
          stashes={git.stashes}
          onStashApply={git.handleStashApply}
          onStashDrop={git.handleStashDrop}
        />
        </div>

        <div className="w-px h-4 bg-border/40 mx-1.5 shrink-0" />

        <AppTooltip content="Refresh">
          <button
            onClick={git.loadAll}
            disabled={git.refreshing}
            className="shrink-0 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={git.refreshing ? 'animate-refresh-spin' : ''} />
          </button>
        </AppTooltip>

        <div className="shrink-0 pr-1.5"><GitHubConnectBadge config={baseConfig} project={project} /></div>

        <div role="tablist" aria-label="Project Git" className="flex w-full min-w-0 items-center gap-0 overflow-x-auto px-2">
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.key
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
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
      <div title={workspace?.path ?? project.root_path} className="shrink-0 truncate px-3 py-1.5 text-[10px] font-mono text-muted-foreground/60">{project.name} · {workspace?.path ?? project.root_path}</div>

      {activeSubTab === 'changes' && (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <ConflictBanner conflicts={git.conflicts} onResolve={git.handleConflictResolve} onAbort={git.handleMergeAbort} />
          <ResizableSplit
            left={
              <div className="flex flex-col h-full">
                <CommitBar
                  stagedCount={git.staged.length}
                  aheadCount={git.aheadBehind.ahead}
                  onCommit={git.handleCommit}
                  onPush={git.handlePush}
                />
                <StagingArea
                  unstaged={git.unstaged}
                  staged={git.staged}
                  selectedFile={selectedFile}
                  onFileSelect={handleFileSelect}
                  onStage={git.handleStage}
                  onUnstage={git.handleUnstage}
                  onStageAll={git.handleStageAll}
                  onUnstageAll={git.handleUnstageAll}
                />
              </div>
            }
            right={
              <DiffViewer
                filePath={selectedFile}
                diff={selectedFile || selectedCommit ? diff : null}
                mode={diffMode}
                onModeChange={setDiffMode}
              />
            }
          />
        </div>
      )}

      {activeSubTab === 'history' && (
        <ResizableSplit storageKey="git-history-split-width" defaultLeftWidth={260}
          left={
            <CommitTimeline
              commits={git.commits}
              selectedHash={selectedCommit}
              onSelectCommit={handleCommitSelect}
            />
          }
          right={
            <DiffViewer
              filePath={selectedCommit ? `commit ${selectedCommit.slice(0, 7)}` : null}
              diff={selectedFile || selectedCommit ? diff : null}
              mode={diffMode}
              onModeChange={setDiffMode}
            />
          }
        />
      )}

      {activeSubTab === 'branches' && (
        <div className="flex-1 overflow-hidden min-h-0">
          <BranchManagerView config={config} projectId={project.id} />
        </div>
      )}

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
          <NoGitHubMessage kind="pull requests" />
        )
      )}

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
          <NoGitHubMessage kind="issues" />
        )
      )}

      {activePR && (
        <PRReviewView
          projectId={project.id}
          config={config}
          pr={activePR}
          onClose={() => setActivePR(null)}
          onInspectTask={onInspectTask}
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
