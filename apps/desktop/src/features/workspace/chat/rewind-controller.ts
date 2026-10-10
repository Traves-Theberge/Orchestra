import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  activateWorkspaceChatBranch, editWorkspaceChatMessage, fetchWorkspaceChat, previewWorkspaceChatRewind,
  regenerateWorkspaceChatResponse, undoWorkspaceChatRestore,
  type BackendConfig, type WorkspaceChatMessage, type WorkspaceChatRewindPreview, type WorkspaceChatSession, type WorkspaceChatSnapshot,
} from '@core/api/client'
import type { ChatMessageRewind } from './ChatMessage'
import type { RewindMode } from './RewindDialog'

const MAESTRO_PROJECT = '__orchestrator__'

export const REWIND_TIMEOUT_NOTICE = 'The request timed out. The conversation was refreshed; check it before trying again.'

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const textValue = (value: unknown) => typeof value === 'string' ? value : ''

/** The model, effort and agent a normal send would pass, for an edit to re-run with. */
export type RewindSendPreferences = {
  requested_model?: string; requested_reasoning_effort?: string
  agent_id?: string; agent_scope?: string; agent_content_hash?: string; agent_format?: string
}

/** The client gave up (90 s abort) or a proxy did (504); the server may still finish. */
function timedOut(err: unknown): boolean {
  const failure = record(err)
  const name = textValue(failure.name)
  const message = err instanceof Error ? err.message : textValue(failure.message)
  return name === 'AbortError' || name === 'TimeoutError' || (textValue(failure.code) === 'request_failed' && message.startsWith('504'))
}

/**
 * Plain words for a failed rewind or undo; never the generic "delivery may be
 * uncertain". The dialog wording (checkpoint advice, "Nothing in the
 * conversation was changed.") applies to a rewind only; Undo restore shows the
 * backend's own text for those (e.g. "There is nothing to undo.").
 */
export function rewindErrorText(err: unknown, action: 'rewind' | 'undo' = 'rewind'): string {
  const failure = record(err)
  const message = err instanceof Error ? err.message : textValue(failure.message) || String(err)
  if (timedOut(err)) return 'The request timed out. Check the conversation before retrying; the server may still finish.'
  switch (textValue(failure.code)) {
    case 'chat_busy': return 'A turn is running here or another conversation is using this folder. Try again when it finishes.'
    case 'checkpoint_unavailable': return action === 'rewind' ? 'There is no file checkpoint for that message. Choose Conversation only.' : message
    case 'restore_partial': return action === 'rewind' ? `${message} Nothing in the conversation was changed.` : message
    default: return message
  }
}

/** The Undo banner's line after a successful files restore. */
export function restoredFilesText(kind: RewindMode): string {
  return kind === 'switch' ? 'Files were restored to that version.' : 'Files were restored to before that message.'
}

/** One opened dialog. Its client message id is reused by every confirm, so a retry is idempotent. */
type RewindRequest = { kind: RewindMode; sessionId: string; clientMessageId: string; message?: WorkspaceChatMessage; text?: string; branchId?: string }
type PreviewState = { request: RewindRequest; data: WorkspaceChatRewindPreview | null; loading: boolean; error: string | null }
/** Belongs to one conversation and shows only there. */
type UndoOffer = { sessionId: string; message?: string; error: string | null }
type Notice = { sessionId: string; text: string }

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
  const [notice, setNotice] = useState<Notice | null>(null)
  // Another conversation opened: an open dialog does not follow it (and does not come back).
  if (request && request.sessionId !== sessionId) setRequest(null)
  const activeRequest = request?.sessionId === sessionId ? request : null
  const activeOffer = undoOffer?.sessionId === sessionId ? undoOffer : null
  const activeNotice = notice?.sessionId === sessionId ? notice : null
  const activePreview = preview && preview.request === activeRequest ? preview : null

  // The offer ends when a later turn starts (an accepted send clears it directly
  // too). A rewind that started a turn keeps its offer through that turn.
  const turnPhase = useRef<'waiting' | 'running' | 'finished'>('finished')
  const offerUndo = (targetId: string, startedTurn: boolean, message?: string) => {
    // A late result for a conversation no longer on screen neither creates an
    // offer nor replaces the one that conversation shows.
    if (latest.current.selectedSession.current !== targetId) return
    turnPhase.current = startedTurn ? 'waiting' : 'finished'
    setUndoOffer({ sessionId: targetId, message, error: null })
  }
  useEffect(() => {
    if (!activeOffer) return
    if (turnPhase.current === 'waiting' && working) turnPhase.current = 'running'
    else if (turnPhase.current === 'running' && !working) turnPhase.current = 'finished'
    else if (turnPhase.current === 'finished' && working) setUndoOffer(previous => previous === activeOffer ? null : previous)
  }, [working, activeOffer])

  const open = useCallback((next: Omit<RewindRequest, 'sessionId' | 'clientMessageId'>) => {
    const { config, projectId: project, sessionId: target } = latest.current
    if (!target) return
    const opened: RewindRequest = { ...next, sessionId: target, clientMessageId: crypto.randomUUID() }
    setRequest(opened)
    setRewindError(null)
    setNotice(null)
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
        await editWorkspaceChatMessage(config, project, target, { message_id: current.message.id, text: current.text ?? '', client_message_id: current.clientMessageId, restore_files: files, ...sendPreferences() })
      } else if (current.kind === 'regenerate' && current.message) {
        await regenerateWorkspaceChatResponse(config, project, target, { message_id: current.message.id, client_message_id: current.clientMessageId, restore_files: files })
      } else if (current.kind === 'switch' && current.branchId) {
        await activateWorkspaceChatBranch(config, project, target, current.branchId, files)
      } else return
      if (!mounted.current) return
      setRequest(previous => previous === current ? null : previous)
      await refresh(target)
      if (files && mounted.current) offerUndo(target, current.kind !== 'switch', restoredFilesText(current.kind))
    } catch (err) {
      if (!mounted.current) return
      const code = textValue(record(err).code)
      if (timedOut(err)) {
        // Never leave a blind retry: show what the server did and say so.
        setRequest(previous => previous === current ? null : previous)
        setNotice({ sessionId: target, text: REWIND_TIMEOUT_NOTICE })
        await refresh(target)
      } else if (code === 'files_restored') {
        // The files did go back; the message did not. Undo restore recovers them.
        setRequest(previous => previous === current ? null : previous)
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
    setUndoOffer(previous => previous === offer ? { ...offer, error: null } : previous)
    try {
      await undoWorkspaceChatRestore(config, project, offer.sessionId)
      if (!mounted.current) return
      setUndoOffer(previous => previous?.sessionId === offer.sessionId ? null : previous)
      await refresh(offer.sessionId)
    } catch (err) {
      if (mounted.current) setUndoOffer(previous => previous?.sessionId === offer.sessionId ? { ...previous, error: rewindErrorText(err, 'undo') } : previous)
    } finally {
      mutationPending.current = false
      if (mounted.current) { setPending(false); setUndoBusy(false) }
    }
  }

  /** A message to `targetId` was accepted: its offer and notice are over. */
  const messageAccepted = useCallback((targetId: string) => {
    setUndoOffer(previous => previous?.sessionId === targetId ? null : previous)
    setNotice(previous => previous?.sessionId === targetId ? null : previous)
  }, [])

  return {
    handlers: handlers satisfies Omit<ChatMessageRewind, 'disabledReason'>,
    rewinding,
    messageAccepted,
    notice: activeNotice ? { text: activeNotice.text, onDismiss: () => setNotice(null) } : null,
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
      error: activeOffer.error,
      onUndo: () => { void undo() },
      onDismiss: () => setUndoOffer(previous => previous === activeOffer ? null : previous),
    } : null,
  }
}
