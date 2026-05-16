import { useCallback, useEffect, useState } from 'react'
import type { BackendConfig, GitCommit, GitStatusEntry, StashEntry, ConflictStatus } from '@core/api/client'
import {
  fetchProjectGitHistory,
  fetchProjectGitStatus,
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

export function classifyFiles(files: GitStatusEntry[]): { unstaged: GitStatusEntry[]; staged: GitStatusEntry[] } {
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

export function useGitActions(config: BackendConfig | null, projectId: string) {
  const [currentBranch, setCurrentBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [files, setFiles] = useState<GitStatusEntry[]>([])
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0 })
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [conflicts, setConflicts] = useState<ConflictStatus>({ in_merge: false, files: [] })

  const loadAll = useCallback(async () => {
    if (!config) return
    setRefreshing(true)
    try {
      const [branchData, statusData, historyData] = await Promise.all([
        fetchProjectGitBranches(config, projectId),
        fetchProjectGitStatus(config, projectId),
        fetchProjectGitHistory(config, projectId),
      ])
      setCurrentBranch(branchData.current || '')
      setBranches(branchData.branches || [])
      setRemoteBranches(branchData.remotes || [])
      setFiles(statusData?.files || [])
      setAheadBehind(statusData?.branch || { ahead: 0, behind: 0 })
      setCommits(historyData || [])
      const [stashData, conflictData] = await Promise.all([
        gitStashList(config, projectId),
        gitGetConflicts(config, projectId),
      ])
      setStashes(stashData)
      setConflicts(conflictData)
    } catch (err) {
      console.error('git load failed', err)
    } finally {
      setRefreshing(false)
    }
  }, [config, projectId])

  useEffect(() => { loadAll() }, [loadAll])

  const { staged, unstaged } = classifyFiles(files)

  const handleStage = useCallback(async (path: string) => {
    if (!config) return
    try { await gitStage(config, projectId, [path]); await loadAll() }
    catch (err) { console.error('stage failed', err) }
  }, [config, projectId, loadAll])

  const handleUnstage = useCallback(async (path: string) => {
    if (!config) return
    try { await gitUnstage(config, projectId, [path]); await loadAll() }
    catch (err) { console.error('unstage failed', err) }
  }, [config, projectId, loadAll])

  const handleStageAll = useCallback(async () => {
    if (!config) return
    try { await gitStage(config, projectId, unstaged.map((f) => f.path)); await loadAll() }
    catch (err) { console.error('stage all failed', err) }
  }, [config, projectId, unstaged, loadAll])

  const handleUnstageAll = useCallback(async () => {
    if (!config) return
    try { await gitUnstage(config, projectId, staged.map((f) => f.path)); await loadAll() }
    catch (err) { console.error('unstage all failed', err) }
  }, [config, projectId, staged, loadAll])

  const handleCommit = useCallback(async (message: string) => {
    if (!config) return
    try { await gitCommit(config, projectId, message); await loadAll() }
    catch (err) { console.error('commit failed', err) }
  }, [config, projectId, loadAll])

  const handlePush = useCallback(async () => {
    if (!config) return
    try { await gitPush(config, projectId); await loadAll() }
    catch (err) { console.error('push failed', err) }
  }, [config, projectId, loadAll])

  const handlePull = useCallback(async () => {
    if (!config) return
    try { await gitPull(config, projectId); await loadAll() }
    catch (err) { console.error('pull failed', err) }
  }, [config, projectId, loadAll])

  const handleFetch = useCallback(async () => {
    if (!config) return
    try { await gitFetch(config, projectId); loadAll() }
    catch (err) { console.error('fetch failed', err) }
  }, [config, projectId, loadAll])

  const handleMerge = useCallback(async (branch: string) => {
    if (!config) return
    try { await gitMerge(config, projectId, branch); loadAll() }
    catch (err) { console.error('merge failed', err) }
  }, [config, projectId, loadAll])

  const handleDeleteBranch = useCallback(async (branch: string) => {
    if (!config) return
    try { await gitDeleteBranch(config, projectId, branch); loadAll() }
    catch (err) { console.error('delete branch failed', err) }
  }, [config, projectId, loadAll])

  const handleCreateRepo = useCallback(async (opts: { name: string; description: string; private: boolean }) => {
    if (!config) return
    await createGitHubRepo(config, projectId, opts)
    loadAll()
  }, [config, projectId, loadAll])

  const handleStashApply = useCallback(async (ref: string) => {
    if (!config) return
    try { await gitStashApply(config, projectId, ref); loadAll() }
    catch (err) { console.error('stash apply failed', err) }
  }, [config, projectId, loadAll])

  const handleStashDrop = useCallback(async (ref: string) => {
    if (!config) return
    try { await gitStashDrop(config, projectId, ref); loadAll() }
    catch (err) { console.error('stash drop failed', err) }
  }, [config, projectId, loadAll])

  const handleConflictResolve = useCallback(async (file: string) => {
    if (!config) return
    try { await gitConflictResolve(config, projectId, file); loadAll() }
    catch (err) { console.error('resolve failed', err) }
  }, [config, projectId, loadAll])

  const handleMergeAbort = useCallback(async () => {
    if (!config) return
    try { await gitMergeAbort(config, projectId); loadAll() }
    catch (err) { console.error('merge abort failed', err) }
  }, [config, projectId, loadAll])

  return {
    currentBranch,
    branches,
    remoteBranches,
    files,
    aheadBehind,
    commits,
    refreshing,
    stashes,
    conflicts,
    staged,
    unstaged,
    loadAll,
    handleStage,
    handleUnstage,
    handleStageAll,
    handleUnstageAll,
    handleCommit,
    handlePush,
    handlePull,
    handleFetch,
    handleMerge,
    handleDeleteBranch,
    handleCreateRepo,
    handleStashApply,
    handleStashDrop,
    handleConflictResolve,
    handleMergeAbort,
  }
}
