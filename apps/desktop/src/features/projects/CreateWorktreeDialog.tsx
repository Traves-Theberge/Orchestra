import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, FolderPlus, GitBranch, Github, Loader2, Monitor, Sparkles } from 'lucide-react'
import { useAppStore } from '@core/store'
import type { SelectedProjectWorkspace } from '@core/store/types'
import type { BackendConfig } from '@core/api/types'
import { createWorktreeJob, fetchWorktreeJob, fetchProjectWorktrees, createWorkspaceChatSession, fetchProjectGitBranches, fetchProjectGitHubIssues, fetchWorkspaceChatModels, fetchWorkspaceChatProviders, listWorkspaceChatSessions, toDisplayError, type GitHubIssue, type WorktreeJob, type WorkspaceChatProvider, type WorkspaceChatModelCatalog } from '@core/api/client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@ui/dialog'
import { Button } from '@ui/button'
import { resolveWorkspaceSource, workspaceSlug, type WorkspaceSourceMode } from './worktree-source'
import { readCreationReceipt, receiptStorageKey, saveCreationReceipt } from './worktree-creation-receipt'
import { sameObservedPath } from './workspace-agent-projection'

type Receipt = { config: BackendConfig; projectId: string; requestId: string; sessionId: string; provider: string; model: string; createMore: boolean; agentAttempted?: boolean; workspace?: SelectedProjectWorkspace; job?: WorktreeJob }
type Props = { open: boolean; onOpenChange: (open: boolean) => void; initialProjectId?: string; mode?: 'worktree' | 'agent'; initialWorkspace?: SelectedProjectWorkspace; onAddProject?: () => void }

export function CreateWorktreeDialog({ open, onOpenChange, initialProjectId, mode = 'worktree', initialWorkspace, onAddProject }: Props) {
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null)
  const config = useAppStore(state => state.config)
  const projects = useAppStore(state => state.projects)
  const tasks = useAppStore(state => state.allBoardIssues)
  const [projectId, setProjectId] = useState('')
  const [sourceMode, setSourceMode] = useState<WorkspaceSourceMode>('smart')
  const [input, setInput] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [branch, setBranch] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [catalog, setCatalog] = useState<{ scope: string; branches: string[]; providers: WorkspaceChatProvider[]; issues: GitHubIssue[]; loading: boolean; warning: string }>({ scope: '', branches: [], providers: [], issues: [], loading: false, warning: '' })
  const [modelCatalog, setModelCatalog] = useState<{ scope: string; models: WorkspaceChatModelCatalog['models'] }>({ scope: '', models: [] })
  const operation = useRef(false)
  const agentRequests = useRef(new Set<string>())
  const pollStarted = useRef(new Map<string, number>())
  const storageKey = (candidate: Receipt) => receiptStorageKey(candidate.config.baseUrl, candidate.projectId, mode, initialWorkspace?.workspaceId)
  const remember = (candidate: Receipt) => { saveCreationReceipt(storageKey(candidate), { ...candidate, baseUrl: candidate.config.baseUrl }); setReceipt(candidate) }
  const project = projects.find(project => project.id === projectId)
  const scope = JSON.stringify([config?.baseUrl, config?.apiToken, projectId, mode === 'agent' ? initialWorkspace?.workspaceId : 'root'])
  const ownerMatches = (candidate: Receipt) => { const current = useAppStore.getState(); return current.config?.baseUrl === candidate.config.baseUrl && current.config.apiToken === candidate.config.apiToken && current.projects.some(project => project.id === candidate.projectId) }
  useEffect(() => {
    if (!open) return
    const chosen = initialWorkspace?.projectId || initialProjectId || useAppStore.getState().activeProjectId || projects[0]?.id || ''
    setProjectId(chosen)
    const retained = config ? readCreationReceipt(receiptStorageKey(config.baseUrl, chosen, mode, initialWorkspace?.workspaceId), config.baseUrl, chosen) : null
    setInput(''); setBranch(''); setProvider(''); setModel(''); setTaskId(''); setError(retained ? 'A previous creation receipt is retained. Check its status before creating another workspace or agent.' : ''); setSourceMode('smart'); setReceipt(retained && config ? { ...retained, config } : null); setPending(false)
    // Projects are observed separately; reopening chooses the current registered project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProjectId, initialWorkspace?.workspaceId, mode])
  useEffect(() => {
    if (!open || !config || !projectId) return
    let cancelled = false
    const target = { ...config, ...(mode === 'agent' && initialWorkspace ? { workspaceId: initialWorkspace.workspaceId } : {}) }
    setCatalog({ scope, branches: [], providers: [], issues: [], loading: true, warning: '' })
    Promise.allSettled([fetchProjectGitBranches(config, projectId), fetchWorkspaceChatProviders(target, projectId), fetchProjectGitHubIssues(config, projectId)]).then(([refs, harnesses, github]) => {
      if (cancelled) return
      const observedBranches = refs.status === 'fulfilled' && Array.isArray(refs.value.branches) ? refs.value.branches : []
      const observedRemotes = refs.status === 'fulfilled' && Array.isArray(refs.value.remotes) ? refs.value.remotes : []
      const branches = refs.status === 'fulfilled' ? [...new Set([...observedBranches, ...observedRemotes].filter(branch => !branch.includes(' -> ')).map(branch => branch.replace(/^\+\s+/, '')))] : []
      const providers = harnesses.status === 'fulfilled' && Array.isArray(harnesses.value.providers) ? harnesses.value.providers : []
      const issues = github.status === 'fulfilled' && Array.isArray(github.value.issues) ? github.value.issues : []
      setCatalog({ scope, branches, providers, issues, loading: false, warning: refs.status === 'rejected' ? 'Git branches unavailable. Refresh or reopen before creating a worktree.' : github.status === 'rejected' ? 'GitHub issue lookup unavailable for this project. Name and Branch remain available.' : github.status === 'fulfilled' && github.value.has_more ? 'Showing the first page of GitHub issues. Unobserved issue references are not accepted.' : '' })
      setBaseRef(refs.status === 'fulfilled' ? refs.value.current : '')
      setProvider(mode === 'agent' ? providers.find(provider => provider.enabled)?.id || '' : '')
    })
    return () => { cancelled = true }
  }, [open, config, projectId, scope, mode, initialWorkspace])
  const currentCatalog = catalog.scope === scope ? catalog : { ...catalog, providers: [], branches: [], issues: [], loading: true }
  const modelScope = `${scope}:${provider}`
  useEffect(() => {
    setModel('')
    if (!open || !config || !projectId || !provider) return
    let cancelled = false
    fetchWorkspaceChatModels({ ...config, ...(mode === 'agent' && initialWorkspace ? { workspaceId: initialWorkspace.workspaceId } : {}) }, projectId, provider).then(response => {
      if (!cancelled) setModelCatalog({ scope: modelScope, models: (Array.isArray(response.models) ? response.models : []).filter(model => !model.hidden) })
    }).catch(() => { if (!cancelled) setModelCatalog({ scope: modelScope, models: [] }) })
    return () => { cancelled = true }
  }, [open, config, projectId, provider, modelScope, mode, initialWorkspace])
  const availableModels = modelCatalog.scope === modelScope ? modelCatalog.models : []
  const enabledProvider = currentCatalog.providers.some(candidate => candidate.id === provider && candidate.enabled)
  const projectOptions = [{ label: 'Choose project', value: '' }, ...projects.map(project => ({ label: project.name, value: project.id }))]
  const branchOptions = [{ label: 'Choose base branch', value: '' }, ...currentCatalog.branches.map(branch => ({ label: branch, value: branch }))]
  const sourceBranchOptions = [{ label: 'Choose source branch', value: '' }, ...currentCatalog.branches.map(branch => ({ label: branch, value: branch }))]
  const providerOptions = [{ label: mode === 'agent' ? 'Choose registered harness' : 'None — workspace only', value: '' }, ...currentCatalog.providers.filter(provider => provider.enabled).map(provider => ({ label: provider.label, value: provider.id }))]
  const modelOptions = [{ label: 'Harness default model', value: '' }, ...availableModels.map(model => ({ label: model.display_name || model.model, value: model.model || model.id }))]
  const taskOptions = [{ label: 'No task', value: '' }, ...tasks.filter(task => task.project_id === projectId && task.id).map(task => ({ label: `${task.identifier || task.issue_identifier} · ${task.title}`, value: task.id || '' }))]

  async function finish(candidate: Receipt, workspace: SelectedProjectWorkspace) {
    if (!ownerMatches(candidate)) throw new Error('Backend ownership changed. Return to the original backend to inspect this creation receipt.')
    const observed = await fetchProjectWorktrees(candidate.config, candidate.projectId)
    const current = observed.worktrees.find(row => row.id === workspace.workspaceId && !row.prunable && sameObservedPath(row.path, workspace.path))
    if (!current) throw new Error('This workspace is no longer a member of the selected project. Refresh its Git worktrees before continuing.')
    workspace = { projectId: candidate.projectId, workspaceId: current.id, path: current.path, branch: current.branch, registered: current.primary, isMain: current.is_main_worktree }
    if (!ownerMatches(candidate)) throw new Error('Backend ownership changed while validating the checkout.')
    let sessionId = ''
    if (candidate.provider) {
      const target = { ...candidate.config, workspaceId: workspace.workspaceId }
      try {
        if (candidate.agentAttempted || agentRequests.current.has(candidate.sessionId)) throw new Error('Checking the existing agent request; no duplicate creation will be sent.')
        candidate.agentAttempted = true
        candidate.workspace = workspace
        agentRequests.current.add(candidate.sessionId)
        remember(candidate)
        const session = await createWorkspaceChatSession(target, candidate.projectId, candidate.provider, candidate.sessionId, candidate.model ? { requested_model: candidate.model } : undefined)
        if (session.id !== candidate.sessionId || session.project_id !== candidate.projectId || session.provider !== candidate.provider || session.workspace_id !== workspace.workspaceId || !sameObservedPath(session.workspace_path || '', workspace.path)) throw new Error('Agent creation returned a different conversation or workspace identity.')
        sessionId = session.id
      } catch (cause) {
        const list = await listWorkspaceChatSessions(target, candidate.projectId).catch(() => null)
        const confirmed = list?.sessions.find(session => session.id === candidate.sessionId && session.project_id === candidate.projectId && session.provider === candidate.provider && session.workspace_id === workspace.workspaceId && sameObservedPath(session.workspace_path || '', workspace.path))
        if (!confirmed) throw new Error(`Workspace exists; agent creation is unconfirmed. Check its status before retrying: ${toDisplayError(cause)}`)
        sessionId = confirmed.id
      }
    }
    if (!ownerMatches(candidate)) throw new Error('Backend ownership changed after creation. The result belongs to the original backend.')
    useAppStore.getState().selectProjectWorkspace(candidate.projectId, workspace)
    if (sessionId) useAppStore.getState().requestWorkspaceConversation(candidate.projectId, sessionId, workspace)
    saveCreationReceipt(storageKey(candidate), null)
    setReceipt(null); setPending(false)
    if (candidate.createMore) { setInput(''); setBranch(''); setTaskId(''); setError('') } else onOpenChange(false)
  }

  async function reconcile(candidate: Receipt) {
    if (operation.current) return
    operation.current = true
    try {
      if (!ownerMatches(candidate)) throw new Error('Return to the backend where this worktree was submitted before checking its receipt.')
      const job = await fetchWorktreeJob(candidate.config, candidate.projectId, candidate.requestId)
      if (job.request_id !== candidate.requestId || job.project_id !== candidate.projectId) throw new Error('Worktree receipt ownership does not match this request.')
      remember({ ...candidate, job })
      if (job.status === 'completed') {
        if (!job.workspace?.id || !job.workspace.path) throw new Error('Completed worktree receipt has no confirmed workspace identity.')
        const row = job.workspace
        await finish(candidate, { projectId: candidate.projectId, workspaceId: row.id, path: row.path, branch: row.branch, registered: row.primary, isMain: row.is_main_worktree })
      } else if (job.status === 'failed' || job.status === 'unknown') { setPending(false); setError(job.message || 'Worktree creation did not complete. Inspect the retained receipt before starting another request.') }
    } catch (cause) { setPending(false); setError(toDisplayError(cause)) }
    finally { operation.current = false }
  }
  useEffect(() => {
    if (!open || !pending || !receipt || mode === 'agent') return
    const started = pollStarted.current.get(receipt.requestId) || Date.now()
    pollStarted.current.set(receipt.requestId, started)
    const timer = setInterval(() => { void reconcile(receipt) }, 1500)
    const deadline = setTimeout(() => { setPending(false); setError('Creation is taking longer than expected. The request is retained; check its status to continue.') }, Math.max(0, 90000 - (Date.now() - started)))
    return () => { clearInterval(timer); clearTimeout(deadline) }
    // The receipt captures the exact backend, project and request; it is never regenerated by polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, receipt, mode])

  async function submit() {
    if (pending || receipt || !config || !project || currentCatalog.loading || (provider && !enabledProvider)) return
    setError('')
    try {
      if (mode === 'agent' && (!initialWorkspace || initialWorkspace.projectId !== projectId || !provider)) throw new Error('Choose an enabled agent for the selected workspace.')
      if (model && !availableModels.some(candidate => candidate.model === model || candidate.id === model)) throw new Error('Choose a model from the current harness catalog.')
      const candidate: Receipt = { config: { ...config }, projectId, requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), provider, model, createMore }
      if (mode === 'agent' && initialWorkspace) {
        setPending(true); remember({ ...candidate, workspace: initialWorkspace })
        await finish(candidate, initialWorkspace)
        return
      }
      const resolved = resolveWorkspaceSource(input, sourceMode, project.remote_url || '', currentCatalog.branches, currentCatalog.issues)
      const base = resolved.baseRef || baseRef
      if (!base || !currentCatalog.branches.includes(base)) throw new Error('Choose an observed base branch.')
      const targetBranch = branch.trim() || resolved.name
      if (currentCatalog.branches.includes(targetBranch)) throw new Error('That branch already exists. Choose a new target branch in Advanced.')
      if (taskId && !tasks.some(task => task.project_id === projectId && task.id === taskId)) throw new Error('The linked task does not belong to this project.')
      setPending(true); remember(candidate)
      try {
        const job = await createWorktreeJob(config, projectId, { request_id: candidate.requestId, name: resolved.name, branch: targetBranch, base_ref: base, ...(provider ? { provider } : {}), ...(model ? { requested_model: model } : {}), ...(taskId ? { task_id: taskId } : {}) })
        if (job.request_id !== candidate.requestId || job.project_id !== projectId) throw new Error('Worktree creation returned an unexpected request identity.')
        remember({ ...candidate, job })
      } catch (cause) {
        setPending(false)
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
        if (['invalid_json', 'invalid_worktree_job', 'worktree_jobs_unavailable', 'provider_unavailable', 'worktree_job_not_found'].includes(code)) {
          // These codes are returned by the POST handler before a job is recorded or Git starts.
          saveCreationReceipt(storageKey(candidate), null); setReceipt(null); setError(toDisplayError(cause))
        } else setError(`Creation may have landed. Check the retained request before retrying: ${toDisplayError(cause)}`)
      }
    } catch (cause) { setPending(false); setError(toDisplayError(cause)) }
  }
  async function checkReceipt() {
    if (!receipt) return
    setError('')
    pollStarted.current.delete(receipt.requestId)
    if (receipt.workspace) { setPending(true); try { await finish(receipt, receipt.workspace) } catch (cause) { setPending(false); setError(toDisplayError(cause)) } }
    else { setPending(true); await reconcile(receipt) }
  }
  const field = 'h-10 min-w-0 w-full rounded-lg border border-border/70 bg-background px-3 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50'
  const title = mode === 'agent' ? 'New agent' : 'Create worktree'
  let localBackend = false
  try { localBackend = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config?.baseUrl || '').hostname) } catch { /* Invalid connection remains unavailable. */ }
  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value) }}>
    <DialogContent ref={setDialogElement} showCloseButton={!pending} className="flex h-fit max-h-[90vh] w-[90vw] max-w-xl min-w-0 flex-col overflow-visible rounded-2xl border-border/60 bg-background p-5 shadow-2xl sm:p-6" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit() } }}>
      <DialogHeader className="min-w-0 pr-7"><DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle><DialogDescription className="sr-only">Choose a project, workspace source and registered agent. Creating a workspace does not create or queue a task.</DialogDescription></DialogHeader>
      <form className="mt-5 flex min-h-0 min-w-0 flex-col" onSubmit={event => { event.preventDefault(); void submit() }}>
        <div id="worktree-form-fields" className="min-h-0 min-w-0 max-h-[calc(90vh_-_12rem)] space-y-4 overflow-x-hidden overflow-y-auto">
        <div className="min-w-0 space-y-1.5"><div className="flex items-center justify-between gap-2"><label className="text-xs font-medium text-foreground/80">Project</label>{onAddProject && <button type="button" aria-label="Add project" disabled={pending || !!receipt} onClick={onAddProject} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"><FolderPlus size={14} /></button>}</div><WorktreeDropdown id="worktree-project" label="Project" portalContainer={dialogElement} value={projectId} options={projectOptions} disabled={mode === 'agent' || pending || !!receipt} onChange={value => { setProjectId(value); setInput(''); setBranch(''); setTaskId(''); setError('') }} /></div>
        <div className="min-w-0 space-y-1.5"><label className="text-xs font-medium text-foreground/80" htmlFor="worktree-host">Run on</label><div id="worktree-host" className="flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border/70 bg-muted/20 px-3 shadow-sm"><Monitor size={15} className="shrink-0 text-muted-foreground" /><span className="shrink-0 text-xs font-medium">{localBackend && project?.root_path.match(/^[a-z]:[\\/]/i) ? 'Local Windows' : 'Backend host'}</span><span className="min-w-0 flex-1 truncate border-l border-border/60 pl-2 text-xs text-muted-foreground" title={initialWorkspace?.path || project?.root_path}>{initialWorkspace?.path || project?.root_path || 'Select a project'}</span></div></div>
        {mode !== 'agent' && <section className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-card/50 p-3.5 shadow-sm"><div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><label className="text-xs font-medium text-foreground/80">Create from <span className="font-normal text-muted-foreground">(optional)</span></label><div className="min-w-0 flex-1 sm:flex-none"><WorktreeDropdown id="worktree-base" label="Base branch" portalContainer={dialogElement} value={baseRef} options={branchOptions} disabled={pending || !!receipt} onChange={setBaseRef} /></div></div><div role="tablist" id="worktree-source-tabs" aria-label="Worktree source" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border/50 text-xs sm:gap-2">{(['smart', 'github', 'branch', 'name'] as const).map(mode => <button type="button" role="tab" aria-selected={sourceMode === mode} key={mode} disabled={pending || !!receipt} onClick={() => { setSourceMode(mode); setInput(''); setError('') }} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 transition-colors disabled:opacity-50 ${sourceMode === mode ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{mode === 'smart' ? <Sparkles size={14} /> : mode === 'github' ? <Github size={14} /> : mode === 'branch' ? <GitBranch size={14} /> : <span className="text-xs">Aa</span>}{mode === 'github' ? 'GitHub' : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div><div className="min-w-0 space-y-2">{sourceMode === 'branch' ? <WorktreeDropdown id="worktree-source" label="Source branch" portalContainer={dialogElement} value={input} options={sourceBranchOptions} disabled={pending || !!receipt} onChange={setInput} /> : <input id="worktree-source" autoFocus className={field} value={input} disabled={pending || !!receipt} onChange={event => setInput(event.target.value)} placeholder={sourceMode === 'github' ? '#123 or GitHub issue URL' : sourceMode === 'name' ? 'Worktree name' : 'Type a name, #123, branch or GitHub issue URL'} />}{sourceMode === 'github' && currentCatalog.issues.length > 0 && <div className="max-h-28 min-w-0 overflow-auto rounded-lg border border-border/60 bg-background p-1">{currentCatalog.issues.filter(issue => !input || `#${issue.number} ${issue.title}`.toLowerCase().includes(input.toLowerCase())).slice(0, 20).map(issue => <button key={issue.number} type="button" disabled={pending || !!receipt} onClick={() => setInput(`#${issue.number}`)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">#{issue.number} {issue.title}</button>)}</div>}</div></section>}
        <section className="min-w-0 space-y-2 rounded-xl border border-border/60 bg-card/50 p-3.5 shadow-sm"><div className="flex items-center gap-2"><Sparkles size={14} className="text-muted-foreground" /><span className="text-xs font-medium text-foreground/80">Agent {mode !== 'agent' && <span className="font-normal text-muted-foreground">(optional)</span>}</span></div><WorktreeDropdown id="worktree-agent" label="Agent" portalContainer={dialogElement} value={provider} options={providerOptions} disabled={pending || !!receipt || currentCatalog.loading} onChange={value => { if (!currentCatalog.providers.some(candidate => candidate.id === value && candidate.enabled)) setProvider(''); else setProvider(value) }} />{currentCatalog.providers.some(provider => !provider.enabled) && <p className="text-[11px] text-muted-foreground">Unavailable: {currentCatalog.providers.filter(provider => !provider.enabled).map(provider => `${provider.label} (${provider.reason || 'Unavailable'})`).join(', ')}</p>}{provider && <WorktreeDropdown id="worktree-model" label="Agent model" portalContainer={dialogElement} value={model} options={modelOptions} disabled={pending || !!receipt} onChange={setModel} />}</section>
        {mode !== 'agent' && <div className="min-w-0"><button type="button" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)} className="flex items-center gap-2 rounded-md py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">Advanced <ChevronDown size={14} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} /></button>{advanced && <div className="mt-2 min-w-0 space-y-3 rounded-xl border border-border/60 bg-muted/10 p-3.5"><div className="min-w-0 space-y-1.5"><label htmlFor="worktree-branch" className="text-xs font-medium text-foreground/80">New branch</label><input id="worktree-branch" className={`${field} font-mono text-xs`} disabled={pending || !!receipt} value={branch} onChange={event => setBranch(event.target.value)} placeholder={workspaceSlug(input) || 'Derived from name'} /></div><div className="min-w-0 space-y-1.5"><label className="text-xs font-medium text-foreground/80">Link an existing task (optional)</label><WorktreeDropdown id="worktree-task" label="Link an existing task" portalContainer={dialogElement} value={taskId} options={taskOptions} disabled={pending || !!receipt} onChange={setTaskId} /></div><p className="text-xs leading-relaxed text-muted-foreground">Creates a new branch from the selected base. GitHub references supply a name; task linking is explicit. Jira, Linear, remote hosts and branch reuse are unavailable here.</p></div>}</div>}
        {currentCatalog.warning && <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{currentCatalog.warning}</p>}{error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}{receipt && <div role="status" className="min-w-0 space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs"><p>{receipt.job?.message || (pending ? 'Preparing workspace…' : 'Creation status needs checking.')}</p><p className="break-all font-mono text-muted-foreground">Request {receipt.requestId}</p>{receipt.job?.status === 'failed' && !pending && <button type="button" onClick={() => { saveCreationReceipt(storageKey(receipt), null); setReceipt(null); setError('') }} className="mr-3 underline underline-offset-2">Start a new request</button>}{!pending && <button type="button" onClick={() => { void checkReceipt() }} className="underline underline-offset-2">Check creation status</button>}</div>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-background pt-3"><label className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" checked={createMore} disabled={pending || !!receipt} onChange={event => setCreateMore(event.target.checked)} />Create more</label><Button type="submit" className="ml-auto max-w-full shadow-sm shadow-primary/15 focus-visible:ring-2 focus-visible:ring-primary/30" disabled={pending || !!receipt || !project || currentCatalog.loading || (mode === 'agent' ? !enabledProvider : !input.trim() || !baseRef)}>{pending && <Loader2 className="size-4 animate-spin" />}{mode === 'agent' ? 'Create agent' : 'Create worktree'}<kbd className="ml-1 hidden text-[10px] text-primary-foreground/70 sm:inline">Ctrl ↵</kbd></Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

function WorktreeDropdown({ id, label, value, options, disabled, onChange, portalContainer }: {
  id: string
  label: string
  value: string
  options: { label: string; value: string }[]
  disabled: boolean
  onChange: (value: string) => void
  portalContainer: HTMLDivElement | null
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    const closeOnScroll = () => setOpen(false)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', closeOnScroll)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape, true)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', closeOnScroll)
    }
  }, [open])
  function toggle() {
    if (disabled || !portalContainer || !trigger.current) return
    const triggerRect = trigger.current.getBoundingClientRect()
    const containerRect = portalContainer.getBoundingClientRect()
    const width = Math.min(Math.max(triggerRect.width, 200), Math.max(180, containerRect.width - 24))
    const left = Math.max(12, Math.min(triggerRect.left - containerRect.left, containerRect.width - width - 12))
    const below = window.innerHeight - triggerRect.bottom - 12
    const above = triggerRect.top - 12
    const openUp = below < Math.min(220, options.length * 40 + 8) && above > below
    const maxHeight = Math.max(100, Math.min(300, openUp ? above : below))
    setPlacement({ left, width, maxHeight, ...(openUp ? { bottom: containerRect.bottom - triggerRect.top + 4 } : { top: triggerRect.bottom - containerRect.top + 4 }) })
    setOpen(current => !current)
  }
  return <div id={id} role="group" aria-label={label} className="min-w-0 w-full max-w-full">
    <button ref={trigger} type="button" aria-label={`${label}: ${selected?.label || 'Select'}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) toggle(); requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()) } }} className={`flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs font-medium shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'border-primary ring-2 ring-primary/20' : ''}`}>
      <span className="min-w-0 flex-1 truncate">{selected?.label || 'Select...'}</span><ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && portalContainer && placement && createPortal(<div ref={popup} role="listbox" aria-label={label} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      const current = items.findIndex(item => item === document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }} className="absolute z-[70] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-2xl" style={{ left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }}>
      <div className="max-h-[inherit] overflow-auto">{options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} tabIndex={option.value === value ? 0 : -1} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }} className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors last:mb-0 ${option.value === value ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`}>
        <span className="min-w-0 flex-1 break-words">{option.label}</span>{option.value === value && <Check className="size-3 shrink-0" />}
      </button>)}</div>
    </div>, portalContainer)}
  </div>
}
