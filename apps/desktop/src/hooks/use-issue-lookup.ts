import { useState } from 'react'
import {
  fetchIssueDetail,
  isUnauthorizedError,
  toDisplayError,
  type BackendConfig,
} from '@core/api/client'
import type { IssueDetailResult } from '@features/issue-detail/types'
import { useAppStore } from '@core/store'

type IssueLookupState = {
  issueLookupId: string
  setIssueLookupId: (id: string) => void
  issueLookupPending: boolean
  setIssueLookupPending: (pending: boolean) => void
  issueLookupResult: IssueDetailResult | null
  setIssueLookupResult: (result: IssueDetailResult | null) => void
  issueLookupError: string
  setIssueLookupError: (error: string) => void
  executeIssueLookup: (identifier: string) => Promise<void>
}

/**
 * Manages issue inspector state — the lookup ID, pending flag, result, and error.
 * Provides an executeIssueLookup function for fetching issue details.
 */
export function useIssueLookup(
  config: BackendConfig | null,
  setStatusMessage: (msg: string) => void,
): IssueLookupState {
  const [issueLookupId, setIssueLookupId] = useState('')
  const [issueLookupPending, setIssueLookupPending] = useState(false)
  const [issueLookupResult, setIssueLookupResult] = useState<IssueDetailResult | null>(null)
  const [issueLookupError, setIssueLookupError] = useState('')

  const executeIssueLookup = async (identifier: string) => {
    if (!config) return

    const normalized = identifier.trim()
    if (normalized === '') {
      setIssueLookupError('Issue identifier is required.')
      setIssueLookupResult(null)
      return
    }

    setIssueLookupPending(true)
    setIssueLookupError('')
    try {
      const result = await fetchIssueDetail(config, normalized)
      setIssueLookupResult(result)
      // Wire the file explorer root to the active issue's workspace path
      const workspacePath = (result as Record<string, unknown>)?.workspace as { path?: string } | undefined
      if (workspacePath?.path) {
        useAppStore.getState().setExplorerRoot(workspacePath.path)
      }
      setStatusMessage(`Issue lookup loaded: ${normalized}`)
    } catch (err) {
      const message = toDisplayError(err)
      setIssueLookupError(message)
      if (isUnauthorizedError(err) || message.startsWith('unauthorized:')) {
        setStatusMessage('Protected host detected. Add bearer token in Settings -> Backend Configuration.')
      }
      const currentResultMatchesLookup = issueLookupResult && [
        issueLookupResult.identifier,
        issueLookupResult.issue_identifier,
        issueLookupResult.id,
        issueLookupResult.issue_id,
      ].includes(normalized)
      if (!currentResultMatchesLookup) setIssueLookupResult(null)
    } finally {
      setIssueLookupPending(false)
    }
  }

  return {
    issueLookupId, setIssueLookupId,
    issueLookupPending, setIssueLookupPending,
    issueLookupResult, setIssueLookupResult,
    issueLookupError, setIssueLookupError,
    executeIssueLookup,
  }
}
