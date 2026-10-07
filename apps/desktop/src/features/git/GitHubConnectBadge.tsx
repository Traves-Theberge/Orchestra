import { useEffect, useState } from 'react'
import { Github } from 'lucide-react'
import { useAppStore } from '@core/store'
import { autoConnectProjectGitHub } from '@core/api/client'
import type { BackendConfig, Project } from '@core/api/types'
import { AppTooltip } from '@ui/tooltip-wrapper'

// One silent attempt per backend + project per app session.
const attempted = new Set<string>()

/** Connects a GitHub project silently via the GitHub CLI login when it isn't connected yet. */
export function useGitHubAutoConnect(config: BackendConfig | null, project: Project) {
  const isGitHub = !!project.github_owner && !!project.github_repo
  const connected = !!project.github_token
  const key = `${config?.baseUrl ?? ''}::${project.id}`
  const [state, setState] = useState<{ key: string; trying: boolean; reason: string }>({ key, trying: false, reason: '' })
  const current = state.key === key ? state : { key, trying: false, reason: '' }
  useEffect(() => {
    if (!config || !isGitHub || connected || attempted.has(key)) return
    attempted.add(key)
    let active = true
    void Promise.resolve().then(() => { if (active) setState({ key, trying: true, reason: '' }) })
      .then(() => autoConnectProjectGitHub(config, project.id))
      .then(result => { if (active) setState({ key, trying: false, reason: result.connected ? '' : result.reason ?? '' }) })
      .catch(() => { if (active) setState({ key, trying: false, reason: 'Automatic connection failed.' }) })
    return () => { active = false }
  }, [config, project.id, isGitHub, connected, key])
  return { isGitHub, connected, trying: current.trying, reason: current.reason }
}

/** The Tasks header's GitHub badge, for the Git panel: connected repo chip, or Connect GitHub. */
export function GitHubConnectBadge({ config, project }: { config: BackendConfig | null; project: Project }) {
  const { isGitHub, connected, trying, reason } = useGitHubAutoConnect(config, project)
  if (!config || !isGitHub) return null
  if (connected) {
    return <span className="inline-flex shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/80" title="GitHub connected">
      <Github size={11} className="text-primary" />
      <span className="font-mono">{project.github_owner}/{project.github_repo}</span>
    </span>
  }
  const connect = () => {
    const state = useAppStore.getState()
    state.setActiveSection('CONSOLE')
    state.openBrowserTab(`${config.baseUrl}/api/v1/github/login?project_id=${project.id}`)
  }
  return <AppTooltip content={reason || 'Connect this repository to GitHub'} side="bottom">
    <button type="button" onClick={connect} disabled={trying}
      className="inline-flex shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[11px] font-semibold transition-colors disabled:opacity-50">
      <Github size={11} />
      {trying ? 'Connecting…' : 'Connect GitHub'}
    </button>
  </AppTooltip>
}
