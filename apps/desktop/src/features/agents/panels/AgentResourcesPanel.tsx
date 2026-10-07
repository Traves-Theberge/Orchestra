import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { useAppStore } from '@core/store'
import type { BackendConfig } from '@core/api/types'
import { fetchAgentCatalog, fetchAgentResource, mutateAgentResource, fetchAgentMutationReceipt, type AgentCatalog, type AgentResource, type AgentResourceKind, type AgentResourceScope } from '@core/api/agent-catalog'
import { chatDraftStorageKey } from '@features/workspace/chat/chat-draft-storage'

/** Native format (and a starter document that passes the backend's frontmatter checks) for new agent definitions. */
const STARTER_BODY = '\n---\n\nYou are a focused agent.\n'
const NEW_AGENT_DEFAULTS: Record<string, { format: string; template?: string }> = {
  CLAUDE: { format: 'md' },
  CODEX: { format: 'toml' },
  OPENCODE: { format: 'opencode-markdown', template: `---\ndescription: Describe when to use this agent\nmode: subagent${STARTER_BODY}` },
  ANTIGRAVITY: { format: 'antigravity-markdown', template: `---\nname: my-agent\ndescription: Describe when to use this agent${STARTER_BODY}` },
  OMP: { format: 'omp-markdown', template: `---\nname: my-agent\ndescription: Describe when to use this agent${STARTER_BODY}` },
}

export function AgentResourcesPanel({ config, projectId, harness, scope, kind }: {
  config: BackendConfig; projectId: string; harness: string; scope: AgentResourceScope; kind: AgentResourceKind
}) {
  const [catalog, setCatalog] = useState<AgentCatalog>()
  const [resource, setResource] = useState<AgentResource>()
  const [content, setContent] = useState('')
  const [id, setId] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [unresolved, setUnresolved] = useState('')
  const receiptKey = useRef('')
  const [storageReady, setStorageReady] = useState(false)
  const setDirty = useAppStore(state => state.setAgentHubDirty)
  const createDefaults = kind === 'agent_definition' ? NEW_AGENT_DEFAULTS[harness.toUpperCase()] : undefined
  const dirty = creating ? !!id || content !== (createDefaults?.template ?? '') : !!resource && content !== resource.content
  useEffect(() => {
    let cancelled = false
    void chatDraftStorageKey(config, projectId).then(key => {
      if (cancelled) return
      receiptKey.current = `${key}:resources:${harness}:${scope}:${kind}`
      const saved = localStorage.getItem(receiptKey.current)
      if (saved) setUnresolved(saved)
      setStorageReady(true)
    }).catch(() => { if (!cancelled) setError('Receipt storage is unavailable. Authoring is disabled until recovery identities can be retained.') })
    return () => { cancelled = true }
  }, [config, projectId, harness, scope, kind])
  useEffect(() => { setDirty(dirty || !!unresolved); return () => setDirty(false) }, [dirty, unresolved, setDirty])
  useEffect(() => {
    let cancelled = false
    void fetchAgentCatalog(config, projectId, harness, scope).then(result => { if (!cancelled) { setCatalog(result); setError('') } }).catch(cause => { if (!cancelled) { setCatalog(undefined); setError(String(cause)) } })
    return () => { cancelled = true }
  }, [config, projectId, harness, scope, revision])
  const open = async (resourceId: string) => {
    if (busy || unresolved || dirty) return
    setBusy(true); setError('')
    try { const item = await fetchAgentResource(config, projectId, harness, scope, kind, resourceId); setResource(item); setId(item.id); setContent(item.content); setCreating(false) }
    catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const clearReceipt = () => { localStorage.removeItem(receiptKey.current); setUnresolved('') }
  const complete = () => { clearReceipt(); setResource(undefined); setContent(''); setId(''); setCreating(false); setConfirmDelete(false); setRevision(value => value + 1) }
  const mutate = async (operation: 'create' | 'update' | 'delete') => {
    if (busy || unresolved || !catalog || !storageReady) return
    const requestId = crypto.randomUUID()
    try { localStorage.setItem(receiptKey.current, requestId) } catch { setError('Cannot retain the mutation receipt. No request was sent.'); return }
    setBusy(true); setError(''); setUnresolved(requestId)
    try {
      const receipt = await mutateAgentResource(config, projectId, harness, scope, kind, id, operation, { request_id: requestId, expected_hash: operation === 'create' ? '' : resource?.content_hash ?? '', content: operation === 'delete' ? undefined : content, format: resource?.format ?? (operation === 'create' ? createDefaults?.format : undefined) })
      if (receipt.request_id !== requestId) throw new Error('Mutation receipt identity mismatch')
      if (receipt.status === 'completed') complete()
      else { if (receipt.status === 'rejected') clearReceipt(); setError(receipt.message || receipt.error || `Operation ${receipt.status}; inspect its receipt before retrying.`) }
    } catch (cause) { setError(`Outcome unconfirmed: ${String(cause)}. Check this receipt before changing the resource.`) }
    finally { setBusy(false) }
  }
  const reconcile = async () => {
    setBusy(true)
    try { const receipt = await fetchAgentMutationReceipt(config, projectId, unresolved); if (receipt.request_id !== unresolved) throw new Error('Receipt identity mismatch'); if (receipt.status === 'completed') complete(); else if (receipt.status === 'rejected') { clearReceipt(); setError(receipt.message || receipt.error || 'Operation rejected') } else setError(`Operation ${receipt.status}; no retry was sent.`) }
    catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <div className="flex h-full min-h-0 flex-col gap-4 p-5">
    <div className="flex items-center gap-2"><h2 className="flex-1 text-sm font-semibold">{kind === 'skill' ? 'Skills' : 'Agents'}</h2>
      <AppTooltip content="Refresh resources"><button aria-label="Refresh agent resources" disabled={busy || dirty || !!unresolved} onClick={() => setRevision(value => value + 1)} className="rounded p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCcw size={14} /></button></AppTooltip>
      <Button size="sm" disabled={!catalog?.capabilities?.create || busy || dirty || !!unresolved} onClick={() => { setResource(undefined); setCreating(true); setId(''); setContent(createDefaults?.template ?? '') }}><Plus size={14} />Create {kind === 'skill' ? 'skill' : 'agent'}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{harness} · {scope} · {catalog?.root || 'Native provider scope'}{catalog?.reason && ` · ${catalog.reason}`}</p>
    {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    {unresolved && <div className="flex items-center gap-2"><code className="text-[10px]">{unresolved}</code><Button size="sm" variant="outline" disabled={busy} onClick={() => void reconcile()}>Check receipt</Button></div>}
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="w-48 shrink-0 overflow-auto">{catalog?.items.filter(item => item.kind === kind).map(item => <button key={item.item_id || item.id} disabled={busy || dirty || !!unresolved} onClick={() => void open(item.id)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-xs disabled:opacity-50 ${resource?.id === item.id ? 'bg-accent' : 'hover:bg-muted'}`}><span className="block break-words font-medium">{item.display_name}</span><span className="text-[10px] text-muted-foreground">{item.mode || item.format}</span></button>)}</div>
      {(resource || creating) ? <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {creating ? <label className="text-xs">Native resource name<input aria-label="Native resource name" value={id} disabled={busy || !!unresolved} onChange={event => setId(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2" placeholder="my-agent" /></label> : <p className="break-all text-[11px] text-muted-foreground">{resource?.path}</p>}
        <textarea aria-label="Native resource content" spellCheck={false} value={content} disabled={busy || !!unresolved} onChange={event => setContent(event.target.value)} className="min-h-48 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs" />
        <div className="flex items-center gap-2"><Button size="sm" disabled={busy || !!unresolved || !id.trim() || !dirty || !(creating ? catalog?.capabilities?.create : catalog?.capabilities?.update)} onClick={() => void mutate(creating ? 'create' : 'update')}>Save</Button><Button size="sm" variant="outline" disabled={busy || !!unresolved} onClick={complete}>Cancel</Button>{resource && <Button size="sm" variant="destructive" disabled={busy || !!unresolved || !catalog?.capabilities?.delete} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />Delete</Button>}</div>
      </div> : <p className="text-xs text-muted-foreground">Select a resource to edit its native document.</p>}
    </div>
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Delete {id}?</DialogTitle><DialogDescription>Remove this {scope} {kind === 'skill' ? 'skill' : 'agent'} definition from {harness}. Existing conversation history is retained.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" disabled={busy || !!unresolved} onClick={() => void mutate('delete')}>Delete definition</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
