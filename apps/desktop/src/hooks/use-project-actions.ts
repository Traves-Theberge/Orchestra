import { useEffect } from 'react'
import {
  createProject,
  deleteProject,
  fetchAgentConfig,
  fetchAgents,
  fetchMCPTools,
  fetchProjectGitHubIssues,
  fetchProjectStats,
  fetchProjects,
  fetchWarehouseStats,
  toDisplayError,
  type BackendConfig,
  type IssueListItem,
} from '@core/api/client'
import type { ProjectStats } from '@core/api/types'
import { useAppStore } from '@core/store'

interface UseProjectActionsOpts {
  setErrorMessage: (m: string) => void
  setStatusMessage: (m: string) => void
}

interface UseProjectActionsResult {
  handleAddProject: (path: string) => Promise<void>
  handleDeleteProject: (projectId: string) => Promise<void>
  refreshProjectsAndStats: () => Promise<void>
}

/**
 * Manages project data loading effects and project CRUD actions.
 * Reads/writes store state via useAppStore.getState() to avoid stale closures.
 */
export function useProjectActions(
  config: BackendConfig | null,
  activeSection: string,
  opts: UseProjectActionsOpts,
): UseProjectActionsResult {
  // Data loading effect — section-specific fetches
  useEffect(() => {
    if (!config) return

    let mounted = true

    // Non-blocking metadata fetches
    fetchAgentConfig(config)
      .then(cfg => mounted && useAppStore.getState().setAgentConfig(cfg))
      .catch(() => mounted && useAppStore.getState().setAgentConfig(null))

    fetchAgents(config)
      .then(agents => mounted && useAppStore.getState().setAvailableAgents(agents))
      .catch(() => mounted && useAppStore.getState().setAvailableAgents([]))

    fetchMCPTools(config)
      .then(tools => mounted && useAppStore.getState().setAllTools(tools))
      .catch(() => mounted && useAppStore.getState().setAllTools([]))

    const loadRequiredData = async () => {
      const needsWarehouse = activeSection === 'WAREHOUSE'

      useAppStore.getState().setDataLoading(true)
      try {
        const projs = await fetchProjects(config)
        if (!mounted) return
        useAppStore.getState().setProjects(projs)

        // Fetch stats for projects that don't have them yet
        // Read current stats from store to avoid stale closure
        const currentStats = useAppStore.getState().projectStats
        const statsMap: Record<string, ProjectStats> = { ...currentStats }
        const pending = projs.filter((p) => !statsMap[p.id])
        const fetched = await Promise.all(pending.map(async (p) => {
          try {
            const s = await fetchProjectStats(config, p.id)
            return [p.id, s] as const
          } catch (e) {
            console.error(`failed to fetch stats for project ${p.id}`, e)
            return null
          }
        }))
        let statsUpdated = false
        for (const entry of fetched) {
          if (!entry) continue
          statsMap[entry[0]] = entry[1]
          statsUpdated = true
        }
        if (mounted && statsUpdated) useAppStore.getState().setProjectStats(statsMap)

        if (needsWarehouse) {
          const stats = await fetchWarehouseStats(config)
          if (mounted) useAppStore.getState().setWarehouseStats(stats)
        }
      } catch (err) {
        if (mounted) {
          const message = toDisplayError(err)
          opts.setErrorMessage(`failed to fetch section data: ${message}`)
        }
      } finally {
        if (mounted) useAppStore.getState().setDataLoading(false)
      }
    }

    loadRequiredData()

    return () => {
      mounted = false
    }
  }, [config, activeSection]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to projects so we know when to re-fetch GitHub backlog
  const projects = useAppStore(s => s.projects)

  // Fetch GitHub issues for connected projects → Kanban backlog
  useEffect(() => {
    if (!config || projects.length === 0) return

    let mounted = true
    const connected = projects.filter(p => p.github_token)
    if (connected.length === 0) {
      useAppStore.getState().setGithubBacklogIssues([])
      return
    }

    Promise.all(connected.map(async (p) => {
      try {
        const ghData = await fetchProjectGitHubIssues(config, p.id)
        return (ghData?.issues ?? []).map(gh => ({
          id: `github-${gh.number}`, issue_id: `github-${gh.number}`,
          identifier: `GH-${gh.number}`, issue_identifier: `GH-${gh.number}`,
          title: gh.title, description: gh.body, state: 'Backlog',
          project_id: p.id, url: gh.html_url,
        } as IssueListItem))
      } catch { return [] as IssueListItem[] }
    })).then(results => {
      if (!mounted) return
      useAppStore.getState().setGithubBacklogIssues(results.flat())
    })
    return () => { mounted = false }
  }, [config, projects])

  const refreshProjectsAndStats = async () => {
    if (!config) return

    const projs = await fetchProjects(config)
    useAppStore.getState().setProjects(projs)

    const currentProjectStats = useAppStore.getState().projectStats
    const statsMap: Record<string, ProjectStats> = { ...currentProjectStats }
    const pending = projs.filter((p) => !statsMap[p.id])
    const fetched = await Promise.all(pending.map(async (p) => {
      try {
        const s = await fetchProjectStats(config, p.id)
        return [p.id, s] as const
      } catch (e) {
        console.error(`failed to fetch stats for project ${p.id}`, e)
        return null
      }
    }))
    let statsChanged = false
    for (const entry of fetched) {
      if (!entry) continue
      statsMap[entry[0]] = entry[1]
      statsChanged = true
    }
    if (statsChanged) {
      useAppStore.getState().setProjectStats(statsMap)
    }
  }

  const handleAddProject = async (path: string) => {
    if (!path || !config) return
    try {
      await createProject(config, path)
      opts.setStatusMessage(`Project at ${path} added successfully.`)
      await refreshProjectsAndStats()
    } catch (err) {
      opts.setErrorMessage(`failed to add project: ${toDisplayError(err)}`)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    if (!config) {
      throw new Error('backend configuration unavailable')
    }
    try {
      await deleteProject(config, projectId)
      opts.setStatusMessage('Project removed.')
      useAppStore.getState().setProjects(
        useAppStore.getState().projects.filter(p => p.id !== projectId)
      )
      useAppStore.getState().setSelectedProjectID(null)
    } catch (err) {
      opts.setErrorMessage(`failed to delete project: ${toDisplayError(err)}`)
      throw err
    }
  }

  return { handleAddProject, handleDeleteProject, refreshProjectsAndStats }
}
