import { useCallback, useState } from 'react'
import type { StudioDraft } from '@core/api/client'

export interface UseDraftResult {
  draft: StudioDraft | null
  applyServerSnapshot: (snap: StudioDraft) => void
  setLocal: (patch: Partial<StudioDraft>) => void
}

export function useDraft(sessionId: string): UseDraftResult {
  const [storedDraft, setDraft] = useState<StudioDraft | null>(null)
  const draft = storedDraft?.session_id === sessionId ? storedDraft : null

  const applyServerSnapshot = useCallback((snap: StudioDraft) => {
    if (snap.session_id === sessionId) setDraft(snap)
  }, [sessionId])

  const setLocal = useCallback((patch: Partial<StudioDraft>) => {
    setDraft((d) => (d?.session_id === sessionId ? { ...d, ...patch, session_id: sessionId } : d))
  }, [sessionId])

  return { draft, applyServerSnapshot, setLocal }
}
