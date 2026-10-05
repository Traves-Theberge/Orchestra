import { useRef, useState } from 'react'
import {
  createIssue,
  deleteIssue,
  fetchIssues,
  fetchIssueDetail,
  fetchProjectGitHubIssues,
  fetchSessionDetail,
  stopIssueSession,
  toDisplayError,
  updateIssue,
  updateProjectGitHubIssue,
  createProjectGitHubIssue,
  type BackendConfig,
  type IssueCreatePayload,
  type IssueUpdatePayload,
  type IssueListItem,
} from '@core/api/client'
import type { SessionDetail } from '@core/api/types'
import type { IssueDetailResult } from '@features/issue-detail/types'
import { useAppStore } from '@core/store'

export type IssueInspectionOwner = { projectId: string; baseUrl: string; apiToken: string }

interface UseIssueActionsOpts {
  onRefresh: () => Promise<void>
  executeIssueLookup: (id: string) => Promise<void>
  issueLookupId: string
  setIssueLookupId: (id: string) => void
  setIssueLookupResult: (r: IssueDetailResult | null) => void
  setIssueLookupError: (e: string) => void
  setIssueLookupPending: (p: boolean) => void
  setErrorMessage: (m: string) => void
  setStatusMessage: (m: string) => void
}

interface UseIssueActionsResult {
  handleIssueUpdate: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  handleStopSession: (identifier: string, provider?: string) => Promise<void>
  handleCreateIssue: (initialState: string) => void
  handleTaskSubmit: (payload: IssueCreatePayload) => Promise<void>
  handleIssueDelete: (identifier: string) => Promise<void>
  handleInspectIssueFromList: (issueIdentifier: string, owner?: IssueInspectionOwner) => Promise<void>
  handleInspectSession: (sessionId: string) => Promise<void>
  sessionLookupResult: SessionDetail | null
  sessionLookupPending: boolean
  sessionLookupError: string
}

/**
 * Encapsulates all issue CRUD, session management, and inspection handlers.
 * Reads store state via useAppStore.getState() to avoid stale closures.
 */
export function useIssueActions(
  config: BackendConfig | null,
  opts: UseIssueActionsOpts,
): UseIssueActionsResult {
  const [sessionLookupResult, setSessionLookupResult] = useState<SessionDetail | null>(null)
  const [sessionLookupPending, setSessionLookupPending] = useState(false)
  const [sessionLookupError, setSessionLookupError] = useState('')
  const issueInspectionSequence = useRef(0)
  const inspectedOwner = useRef<{ identifier: string; owner: IssueInspectionOwner } | null>(null)
  const matchesIssue = (issue: IssueListItem, identifier: string) => [issue.id, issue.issue_id, issue.identifier, issue.issue_identifier].includes(identifier)
  const captureTaskTarget = (identifier: string) => {
    const state = useAppStore.getState()
    if (!config || state.config?.baseUrl !== config.baseUrl || state.config.apiToken !== config.apiToken) throw new Error('Backend changed. Refresh this task before changing it.')
    const selectedProject = state.selectedProjectID || (state.projects.some(project => project.id === state.activeProjectId) ? state.activeProjectId : null)
    const inspection = inspectedOwner.current?.identifier === identifier ? inspectedOwner.current.owner : null
    const projectId = inspection?.projectId || selectedProject
    if (inspection && (inspection.baseUrl !== config.baseUrl || inspection.apiToken !== config.apiToken || (selectedProject && selectedProject !== inspection.projectId))) throw new Error('Task context changed. Open it again from its project before changing it.')
    const globalMatches = state.allBoardIssues.filter(issue => matchesIssue(issue, identifier))
    const matches = globalMatches.filter(issue => !projectId || issue.project_id === projectId)
    if (globalMatches.length > 0 && matches.length === 0) throw new Error('Task belongs to another project. Open its workspace before changing it.')
    if (matches.length > 1) throw new Error('Task label is ambiguous. Open its project workspace before changing it.')
    const issue = matches[0]
    const virtual = identifier.startsWith('GH-') || globalMatches.some(issue => (issue.identifier || issue.issue_identifier || '').startsWith('GH-'))
    if (virtual && (!issue?.project_id || !projectId)) throw new Error('GitHub task requires an explicit project. Open its project workspace before changing it.')
    const repositoryKey = (projects: typeof state.projects) => {
      const project = projects.find(project => project.id === (issue?.project_id || projectId))
      return JSON.stringify([project?.id, project?.root_path, project?.github_owner, project?.github_repo])
    }
    const capturedRepository = repositoryKey(state.projects)
    const assertCurrent = () => {
      const current = useAppStore.getState()
      const currentProject = current.selectedProjectID || (current.projects.some(project => project.id === current.activeProjectId) ? current.activeProjectId : null)
      if (current.config?.baseUrl !== config.baseUrl || current.config.apiToken !== config.apiToken || (projectId && currentProject !== projectId) || repositoryKey(current.projects) !== capturedRepository) throw new Error('Task context changed while the request was pending. The action may have landed; refresh its original project before retrying.')
    }
    return { issue, virtual, assertCurrent }
  }
  const linkedGitHubTarget = (issue: IssueListItem) => {
    const project = useAppStore.getState().projects.find(project => project.id === issue.project_id)
    let url: URL
    try { url = new URL(issue.url || '') } catch { throw new Error('GitHub task link is missing or invalid. Refresh its project before changing it.') }
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
    if (!project?.github_owner || !project.github_repo || url.protocol !== 'https:' || url.hostname !== 'github.com' || !match || match[1].toLowerCase() !== project.github_owner.toLowerCase() || match[2].toLowerCase() !== project.github_repo.toLowerCase()) throw new Error('GitHub issue link does not match its registered repository. Refresh the project before changing it.')
    return { project, number: Number(match[3]) }
  }

  const handleIssueUpdate = async (identifier: string, updates: IssueUpdatePayload) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      // If this is a GitHub backlog issue, promote to local task linked to the SAME GitHub issue
      if (target.virtual) {
        const ghIssue = target.issue
        if (ghIssue) {
          linkedGitHubTarget(ghIssue)
          const updatesRec = updates as Record<string, unknown>
          const newIssue = await createIssue(config, {
            title: updatesRec.title as string || ghIssue.title || '',
            description: updatesRec.description as string || ghIssue.description || '',
            state: updatesRec.state as string || 'Backlog',
            assignee_id: updatesRec.assignee_id as string || '',
            project_id: ghIssue.project_id || '',
            provider: updatesRec.provider as string || '',
          })
          target.assertCurrent()
          if (newIssue.project_id !== ghIssue.project_id || !newIssue.identifier) throw new Error('Created task response does not match the original project. The task may have been created; inspect that project before retrying.')
          const ghUrl = ghIssue.url || ''
          if (newIssue?.identifier && ghUrl) {
            await updateIssue(config, newIssue.identifier, { url: ghUrl } as IssueUpdatePayload)
            target.assertCurrent()
          }
          opts.setStatusMessage(`${identifier} linked to ${newIssue?.identifier || 'local task'}`)
          const updatedIssues = await fetchIssues(config)
          target.assertCurrent()
          useAppStore.getState().setBoardIssues(updatedIssues)
          await opts.onRefresh()
          target.assertCurrent()
          if (newIssue?.identifier) {
            opts.setIssueLookupId(newIssue.identifier)
            await opts.executeIssueLookup(newIssue.identifier)
          }
          return
        }
      }

      await updateIssue(config, identifier, updates)
      target.assertCurrent()

      const updatesRec = updates as Record<string, unknown>
      const issue = target.issue
      if (issue?.project_id && issue.url?.includes('github.com')) {
        const { project, number } = linkedGitHubTarget(issue)
        const sync = {
          ...(updatesRec.title ? { title: updatesRec.title as string } : {}),
          ...(updatesRec.description ? { body: updatesRec.description as string } : {}),
          ...(updatesRec.state && (updatesRec.state === 'Done' || issue.state === 'Done') ? { state: updatesRec.state === 'Done' ? 'closed' : 'open' } : {}),
        }
        if (project.github_token && Object.keys(sync).length > 0) {
          await updateProjectGitHubIssue(config, project.id, number, sync)
          target.assertCurrent()
        }
      }
      const updatedIssues = await fetchIssues(config)
      target.assertCurrent()
      useAppStore.getState().setBoardIssues(updatedIssues)
      await opts.onRefresh()
      target.assertCurrent()
      await opts.executeIssueLookup(identifier)
    } catch (err) {
      opts.setErrorMessage(`update issue failed: ${toDisplayError(err)}`)
    }
  }

  const handleStopSession = async (identifier: string, provider?: string) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      if (target.virtual) throw new Error('GitHub backlog issues have no local agent session. Promote this task before stopping a session.')
      await stopIssueSession(config, identifier, provider)
      target.assertCurrent()
      await updateIssue(config, identifier, { state: 'Todo' })
      target.assertCurrent()
      opts.setStatusMessage(`Session for ${identifier} stopped. Task moved to Todo.`)
      const updatedIssues = await fetchIssues(config)
      target.assertCurrent()
      useAppStore.getState().setBoardIssues(updatedIssues)
      await opts.onRefresh()
      target.assertCurrent()
      await opts.executeIssueLookup(identifier)
    } catch (err) {
      opts.setErrorMessage(`stop session failed: ${toDisplayError(err)}`)
    }
  }

  const handleCreateIssue = (initialState: string) => {
    useAppStore.getState().openCreateTaskDialog({ state: initialState })
  }

  const handleTaskSubmit = async (payload: IssueCreatePayload) => {
    if (!config) return
    try {
      const project = useAppStore.getState().projects.find(p => p.id === payload.project_id)
      const repository = JSON.stringify([project?.id, project?.root_path, project?.github_owner, project?.github_repo])
      const assertCreationContext = () => {
        const current = useAppStore.getState()
        const currentProject = current.projects.find(p => p.id === payload.project_id)
        if (current.config?.baseUrl !== config.baseUrl || current.config.apiToken !== config.apiToken || JSON.stringify([currentProject?.id, currentProject?.root_path, currentProject?.github_owner, currentProject?.github_repo]) !== repository) throw new Error('Project or backend changed while creating the task. Creation may have landed; refresh the original project before retrying.')
      }
      assertCreationContext()
      const localIssue = await createIssue(config, payload)
      assertCreationContext()

      // If project is GitHub-connected, also create a GitHub issue and link it
      if (project?.github_token && project.github_owner && project.github_repo) {
        try {
          if (localIssue.project_id !== project.id || !(localIssue.identifier || localIssue.issue_identifier || localIssue.id)) throw new Error('Created task identity does not match the requested project.')
          const ghIssue = await createProjectGitHubIssue(config, project.id, {
            title: payload.title,
            body: payload.description || '',
          })
          assertCreationContext()
          linkedGitHubTarget({ ...localIssue, project_id: payload.project_id, url: ghIssue.html_url })
          const issueId = localIssue?.identifier || localIssue?.issue_identifier || ''
          if (issueId && ghIssue.html_url) {
            await updateIssue(config, issueId, { url: ghIssue.html_url } as IssueUpdatePayload)
            assertCreationContext()
          }
        } catch (error) {
          throw new Error(`Local task ${localIssue.identifier || localIssue.id || ''} was created; GitHub publication or linking failed: ${toDisplayError(error)} Inspect the original project before retrying.`)
        }
      }
      assertCreationContext()

      opts.setStatusMessage(`Task "${payload.title}" created.`)

      const updatedIssues = await fetchIssues(config)
      assertCreationContext()
      useAppStore.getState().setBoardIssues(updatedIssues)

      if (project?.github_token) {
        try {
          await fetchProjectGitHubIssues(config, project.id, 'open')
        } catch {
          // non-critical
        }
      }
      assertCreationContext()

      void opts.onRefresh()
    } catch (err) {
      opts.setErrorMessage(`create task failed: ${toDisplayError(err)}`)
    }
  }

  const handleIssueDelete = async (identifier: string) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      const issueToClose = target.issue
      if (issueToClose?.project_id && issueToClose.url?.includes('github.com')) {
        const { project, number } = linkedGitHubTarget(issueToClose)
        if (project.github_token) {
          await updateProjectGitHubIssue(config, project.id, number, { state: 'closed' })
          target.assertCurrent()
        }
      }
      if (target.virtual) {
        const keepOther = (issue: IssueListItem) => issue.project_id !== issueToClose?.project_id || !matchesIssue(issue, identifier)
        useAppStore.getState().setBoardIssues(useAppStore.getState().boardIssues.filter(keepOther))
        useAppStore.getState().setGithubBacklogIssues(useAppStore.getState().githubBacklogIssues.filter(keepOther))
        opts.setStatusMessage(`GitHub issue ${identifier} dismissed from board.`)
        await opts.onRefresh()
        target.assertCurrent()
      } else {
        await deleteIssue(config, identifier)
        target.assertCurrent()
        opts.setStatusMessage(`Task ${identifier} deleted.`)
        useAppStore.getState().setBoardIssues(useAppStore.getState().boardIssues.filter(issue => !matchesIssue(issue, identifier)))
        const currentSnapshot = useAppStore.getState().snapshot
        if (currentSnapshot) useAppStore.getState().setSnapshot({
          ...currentSnapshot,
          running: currentSnapshot.running.filter(run => run.issue_identifier !== identifier),
          retrying: currentSnapshot.retrying.filter(run => run.issue_identifier !== identifier),
        })
        useAppStore.getState().setOpenTerminals(useAppStore.getState().openTerminals.filter(terminal => terminal.id !== `issue-${identifier}`))
        const updatedIssues = await fetchIssues(config)
        target.assertCurrent()
        useAppStore.getState().setBoardIssues(updatedIssues)
        await opts.onRefresh()
        target.assertCurrent()
      }
      if (opts.issueLookupId === identifier) { opts.setIssueLookupResult(null); opts.setIssueLookupId('') }
    } catch (err) {
      opts.setErrorMessage(`delete issue failed: ${toDisplayError(err)}`)
      throw err
    }
  }
  const handleInspectIssueFromList = async (issueIdentifier: string, owner?: IssueInspectionOwner) => {
    const sequence = ++issueInspectionSequence.current
    const current = () => {
      const currentConfig = useAppStore.getState().config
      return sequence === issueInspectionSequence.current && (!owner || (currentConfig?.baseUrl === owner.baseUrl && currentConfig.apiToken === owner.apiToken && useAppStore.getState().activeProjectId === owner.projectId))
    }
    if (owner && (!config || config.baseUrl !== owner.baseUrl || config.apiToken !== owner.apiToken || !current())) return
    inspectedOwner.current = owner ? { identifier: issueIdentifier, owner } : null
    opts.setIssueLookupId(issueIdentifier)
    opts.setIssueLookupResult(null)
    opts.setIssueLookupError('')
    opts.setIssueLookupPending(false)
    useAppStore.getState().setInspectDialogOpen(true)

    // For GitHub backlog issues, populate directly from cached data instead of API
    const cachedMatches = useAppStore.getState().allBoardIssues.filter(i =>
        (!owner || i.project_id === owner.projectId) && (i.identifier === issueIdentifier || i.issue_identifier === issueIdentifier || i.id === issueIdentifier)
    )
    if (issueIdentifier.startsWith('GH-') || cachedMatches.some(issue => (issue.identifier || issue.issue_identifier || '').startsWith('GH-'))) {
      const candidates = cachedMatches
      if (candidates.length > 1) {
        opts.setIssueLookupError('This issue label exists in more than one project. Open it from its project workspace.')
        return
      }
      const ghIssue = candidates[0]
      if (ghIssue) {
        const projects = useAppStore.getState().projects
        opts.setIssueLookupResult({
          ...ghIssue,
          project_name: projects.find(p => p.id === ghIssue.project_id)?.name || '',
        } as IssueDetailResult)
        return
      }
    }

    if (owner && config) {
      opts.setIssueLookupPending(true)
      try {
        const issue = await fetchIssueDetail(config, issueIdentifier)
        if (!current()) return
        if (issue.project_id !== owner.projectId || ![issue.id, issue.issue_id, issue.identifier, issue.issue_identifier].includes(issueIdentifier)) {
          throw new Error('Task response belongs to another project or task. Refresh the workspace before opening it.')
        }
        opts.setIssueLookupResult(issue as IssueDetailResult)
      } catch (error) {
        if (current()) opts.setIssueLookupError(toDisplayError(error))
      } finally {
        if (current()) opts.setIssueLookupPending(false)
      }
      return
    }
    await opts.executeIssueLookup(issueIdentifier)
  }

  const handleInspectSession = async (sessionId: string) => {
    if (!config) return
    useAppStore.getState().setSessionInspectDialogOpen(true)
    setSessionLookupPending(true)
    setSessionLookupError('')
    try {
      const result = await fetchSessionDetail(config, sessionId)
      setSessionLookupResult(result)
    } catch (err) {
      setSessionLookupError(toDisplayError(err))
    } finally {
      setSessionLookupPending(false)
    }
  }

  return {
    handleIssueUpdate,
    handleStopSession,
    handleCreateIssue,
    handleTaskSubmit,
    handleIssueDelete,
    handleInspectIssueFromList,
    handleInspectSession,
    sessionLookupResult,
    sessionLookupPending,
    sessionLookupError,
  }
}
