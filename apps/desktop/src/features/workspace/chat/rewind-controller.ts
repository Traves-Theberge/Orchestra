import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  activateWorkspaceChatBranch, editWorkspaceChatMessage, fetchWorkspaceChat, previewWorkspaceChatRewind,
  regenerateWorkspaceChatResponse, undoWorkspaceChatRestore,
  type BackendConfig, type WorkspaceChatMessage, type WorkspaceChatRewindPreview, type WorkspaceChatSession, type WorkspaceChatSnapshot,
} from '@core/api/client'
import type { ChatMessageRewind } from './ChatMessage'
import type { RewindMode } from './RewindDialog'

const MAESTRO_PROJECT = '__orchestrator__'

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const textValue = (value: unknown) => typeof value === 'string' ? value : ''

/** The model, effort and agent a normal send would pass, for an edit to re-run with. */
export type RewindSendPreferences = {
  requested_model?: string; requested_reasoning_effort?: string
  agent_id?: string; agent_scope?: string; agent_content_hash?: string; agent_format?: string
}

/** Plain words for a failed rewind or undo; never the generic "delivery may be uncertain". */
export function rewindErrorText(err: unknown): string {
  const failure = record(err)
  const name = textValue(failure.name)
  const message = err instanceof Error ? err.message : textValue(failure.message) || String(err)
  if (name === 'AbortError' || name === 'TimeoutError') return 'The request timed out. Check the conversation before retrying; the server may still finish.'
  switch (textValue(failure.code)) {
    case 'chat_busy': return 'A turn is running here or another conversation is using this folder. Try again when it finishes.'
    case 'checkpoint_unavailable': return 'There is no file checkpoint for that message. Choose Conversation only.'
    case 'restore_partial': return `${message} Nothing in the conversation was changed.`
    default: return message
  }
}

type RewindRequest = { kind: RewindMode; sessionId: string; message?: WorkspaceChatMessage; text?: string; branchId?: string }
type PreviewState = { request: RewindRequest; data: WorkspaceChatRewindPreview | null; loading: boolean; error: string | null }
type UndoOffer = { sessionId: string; message?: string }

type RewindOptions = {
  config: BackendConfig
  projectId: string
  sessionId: string
  working: boolean
  /** The conversation on screen; a late result never replaces another conversation. */
  selectedSession: RefObject<string>
  mounted: RefObject<boolean>
  /** The chat's single mutation lock, shared with send, stop and rename. */
  mutationPending: RefObject<boolean>
  setPending: (value: boolean) => void
  setSnapshot: Dispatch<SetStateAction<WorkspaceChatSnapshot | null>>
  setSessions: Dispatch<SetStateAction<WorkspaceChatSession[]>>
  sendPreferences: () => RewindSendPreferences
}

/**
 * Edit, regenerate and version switching for one chat: the confirmation dialog's
 * state, the calls, the full refetch afterwards, and the Undo restore offer.
 */
export function useRewind(options: RewindOptions) {
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const { sessionId, working, projectId } = options
  const filesHidden = projectId === MAESTRO_PROJECT

  const [request, setRequest] = useState<RewindRequest | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [rewinding, setRewinding] = useState(false)
  const [rewindError, setRewindError] = useState<string | null>(null)
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  // Another conversation opened: its dialog and offer do not follow.
  if (request && request.sessionId !== sessionId) setRequest(null)
  if (undoOffer && undoOffer.sessionId !== sessionId) { setUndoOffer(null); setUndoError(null) }
  const activeRequest = request?.sessionId === sessionId ? request : null
  const activeOffer = undoOffer?.sessionId === sessionId ? undoOffer : null
  const activePreview = preview && preview.request === activeRequest ? preview : null

  // The offer ends when a later turn starts (sending clears it directly too). A
  // rewind that started a turn keeps its offer through that turn.
  const turnPhase = useRef<'waiting' | 'running' | 'finished'>('finished')
  const offerUndo = (targetId: string, startedTurn: boolean, message?: string) => {
    turnPhase.current = startedTurn ? 'waiting' : 'finished'
    setUndoOffer({ sessionId: targetId, message })
    setUndoError(null)
  }
  useEffect(() => {
    if (!undoOffer) return
    if (turnPhase.current === 'waiting' && working) turnPhase.current = 'running'
    else if (turnPhase.current === 'running' && !working) turnPhase.current = 'finished'
    else if (turnPhase.current === 'finished' && working) setUndoOffer(null)
  }, [working, undoOffer])

  const open = useCallback((next: Omit<RewindRequest, 'sessionId'>) => {
    const { config, projectId: project, sessionId: target } = latest.current
    if (!target) return
    const opened: RewindRequest = { ...next, sessionId: target }
    setRequest(opened)
    setRewindError(null)
    const needsPreview = opened.kind !== 'switch' && project !== MAESTRO_PROJECT && !!opened.message
    setPreview({ request: opened, data: null, loading: needsPreview, error: null })
    if (!needsPreview || !opened.message) return
    // Results land only on the request that asked; a changed request ignores them.
    previewWorkspaceChatRewind(config, project, target, opened.message.id).then(
      data => { if (latest.current.mounted.current) setPreview(previous => previous?.request === opened ? { ...previous, data, loading: false } : previous) },
      err => { if (latest.current.mounted.current) setPreview(previous => previous?.request === opened ? { ...previous, loading: false, error: rewindErrorText(err) } : previous) },
    )
  }, [])

  const handlers = useMemo(() => ({
    onEdit: (message: WorkspaceChatMessage, text: string) => open({ kind: 'edit', message, text }),
    onRegenerate: (message: WorkspaceChatMessage) => open({ kind: 'regenerate', message }),
    onSwitchVersion: (branchId: string) => open({ kind: 'switch', branchId }),
  }), [open])

  /** A branch change replaces messages, events and requests wholesale: refetch, never patch. */
  const refresh = async (targetId: string) => {
    const { config, projectId: project, selectedSession, setSnapshot, setSessions, mounted } = latest.current
    try {
      const result = await fetchWorkspaceChat(config, project, targetId)
      if (!mounted.current) return
      if (result.session.id !== targetId || result.session.project_id !== project || (config.workspaceId && result.session.workspace_id !== config.workspaceId)) return
      if (selectedSession.current === targetId) setSnapshot(previous => previous && previous.session.id !== targetId ? previous : result)
      setSessions(previous => previous.map(s => s.id === targetId ? result.session : s))
    } catch { /* The regular poll catches up. */ }
  }

  const confirm = async (restoreFiles: boolean) => {
    const { config, projectId: project, sessionId: target, working: busyTurn, mutationPending, setPending, mounted, sendPreferences } = latest.current
    const current = activeRequest
    if (!current || rewinding || mutationPending.current) return
    if (busyTurn) { setRewindError('Wait for the current turn to finish.'); return }
    const files = restoreFiles && project !== MAESTRO_PROJECT
    mutationPending.current = true
    setPending(true)
    setRewinding(true)
    setRewindError(null)
    try {
      if (current.kind === 'edit' && current.message) {
        await editWorkspaceChatMessage(config, project, target, { message_id: current.message.id, text: current.text ?? '', client_message_id: crypto.randomUUID(), restore_files: files, ...sendPreferences() })
      } else if (current.kind === 'regenerate' && current.message) {
        await regenerateWorkspaceChatResponse(config, project, target, { message_id: current.message.id, client_message_id: crypto.randomUUID(), restore_files: files })
      } else if (current.kind === 'switch' && current.branchId) {
        await activateWorkspaceChatBranch(config, project, target, current.branchId, files)
      } else return
      if (!mounted.current) return
      setRequest(null)
      await refresh(target)
      if (files && mounted.current) offerUndo(target, current.kind !== 'switch')
    } catch (err) {
      if (!mounted.current) return
      const code = textValue(record(err).code)
      if (code === 'files_restored') {
        // The files did go back; the message did not. Undo restore recovers them.
        setRequest(null)
        offerUndo(target, false, err instanceof Error ? err.message : undefined)
        await refresh(target)
      } else {
        setRewindError(rewindErrorText(err))
        if (code === 'restore_partial' && files) offerUndo(target, false, 'Some files were changed before the restore stopped.')
      }
    } finally {
      mutationPending.current = false
      if (mounted.current) { setPending(false); setRewinding(false) }
    }
  }

  const cancel = () => { if (!rewinding) setRequest(null) }

  const undo = async () => {
    const { config, projectId: project, mutationPending, setPending, mounted } = latest.current
    const offer = activeOffer
    if (!offer || undoBusy || mutationPending.current) return
    mutationPending.current = true
    setPending(true)
    setUndoBusy(true)
    setUndoError(null)
    try {
      await undoWorkspaceChatRestore(config, project, offer.sessionId)
      if (!mounted.current) return
      setUndoOffer(previous => previous === offer ? null : previous)
      await refresh(offer.sessionId)
    } catch (err) {
      if (mounted.current) setUndoError(rewindErrorText(err))
    } finally {
      mutationPending.current = false
      if (mounted.current) { setPending(false); setUndoBusy(false) }
    }
  }

  const clearUndoOffer = useCallback(() => { setUndoOffer(null); setUndoError(null) }, [])

  return {
    handlers: handlers satisfies Omit<ChatMessageRewind, 'disabledReason'>,
    rewinding,
    clearUndoOffer,
    dialog: {
      open: !!activeRequest,
      mode: activeRequest?.kind ?? 'edit',
      preview: activePreview?.data ?? null,
      previewLoading: activePreview?.loading ?? false,
      previewError: activePreview?.error ?? null,
      busy: rewinding,
      error: rewindError,
      filesHidden,
      onConfirm: (restoreFiles: boolean) => { void confirm(restoreFiles) },
      onCancel: cancel,
    },
    banner: activeOffer ? {
      message: activeOffer.message,
      busy: undoBusy || working,
      error: undoError,
      onUndo: () => { void undo() },
      onDismiss: clearUndoOffer,
    } : null,
  }
}
