import { useEffect, useMemo, useReducer, useState } from 'react'

import type { TimelineItem } from '@layout/types'
import type { BackendConfig, IssueUpdatePayload } from '@core/api/client'
import type { SnapshotPayload } from '@core/api/types'

import { extractHookOutputs, getHookStatus } from '../IssueDetailUtils'
import { useIssueDetailData } from './use-issue-detail-data'
import { useIssueDetailLogView } from './use-issue-detail-log-view'
import { useIssueDetailPR } from './use-issue-detail-pr'
import type { IssueDetailResult } from '../types'

type LocalEditState = {
  state: string
  assignee: string
  provider: string
  disabledTools: string[]
}

type LocalEditAction =
  | { type: 'sync'; state: string; assignee: string; provider: string; disabledTools: string[] }
  | { type: 'setState'; state: string }
  | { type: 'setAssigneeAndProvider'; assignee: string; provider: string }
  | { type: 'setAssignee'; assignee: string }
  | { type: 'setProvider'; provider: string }
  | { type: 'setDisabledTools'; disabledTools: string[] }

function localEditReducer(prev: LocalEditState, action: LocalEditAction): LocalEditState {
  switch (action.type) {
    case 'sync':
      return {
        state: action.state,
        assignee: action.assignee,
        provider: action.provider,
        disabledTools: action.disabledTools,
      }
    case 'setState':
      return { ...prev, state: action.state }
    case 'setAssigneeAndProvider':
      return { ...prev, assignee: action.assignee, provider: action.provider }
    case 'setAssignee':
      return { ...prev, assignee: action.assignee }
    case 'setProvider':
      return { ...prev, provider: action.provider }
    case 'setDisabledTools':
      return { ...prev, disabledTools: action.disabledTools }
    default:
      return prev
  }
}

const INITIAL_LOCAL_EDIT: LocalEditState = {
  state: 'Todo',
  assignee: 'Unassigned',
  provider: '',
  disabledTools: [],
}

export function useIssueDetailState({
  result,
  onUpdate,
  config,
  snapshot,
  timeline,
  availableAgents,
}: {
  result: IssueDetailResult | null
  onUpdate?: (updates: IssueUpdatePayload) => Promise<void>
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  timeline: TimelineItem[]
  availableAgents: string[]
}) {
  const [edit, dispatch] = useReducer(localEditReducer, INITIAL_LOCAL_EDIT)
  const { state: localState, assignee: localAssignee, provider: localProvider, disabledTools } = edit
  const [activeTab, setActiveTab] = useState<'overview' | 'changes' | 'logs' | 'artifacts' | 'activity'>('overview')
  const [hookOutputs, setHookOutputs] = useState<Record<string, string>>({})
  const [selectedHookLog, setSelectedHookLog] = useState<{ id: string; label: string; output: string } | null>(null)

  const isValid = !!result && typeof result === 'object'
  const typed = (result ?? {})

  const identifier = (typed.identifier as string) || (typed.issue_identifier as string) || (typed.id as string) || ''
  const issueId = (typed.id as string) || (typed.issue_id as string) || ''
  const title = (typed.title as string) || 'No Title'
  const description = (typed.description as string) || ''
  const state = (typed.state as string) || 'Todo'
  const assigneeId = (typed.assignee_id as string) || 'Unassigned'
  const projectId = (typed.project_id as string) || ''
  const branchName = (typed.branch_name as string) || ''
  const issueUrl = (typed.url as string) || ''
  const provider = (typed.provider as string) || ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const disabledToolsFromResult = (typed.disabled_tools as string[]) || []
  const updatedAt = (typed.updated_at as string) || ''

  const data = useIssueDetailData({
    activeTab,
    identifier,
    config,
    localProvider,
  })

  const logView = useIssueDetailLogView({ logs: data.logs })

  const pr = useIssueDetailPR({
    config,
    identifier,
    title,
    description,
    projectId,
  })

  // Sync local state from issue result props
  useEffect(() => {
    dispatch({ type: 'sync', state, assignee: assigneeId, provider, disabledTools: disabledToolsFromResult })
  }, [state, assigneeId, provider, disabledToolsFromResult])

  useEffect(() => {
    const outputs = extractHookOutputs(timeline, issueId, identifier)
    setHookOutputs((prev) => ({ ...prev, ...outputs }))
  }, [timeline, issueId, identifier])

  const activeSessions = useMemo(() => {
    if (!snapshot) return []
    return snapshot.running.filter((entry) => entry.issue_id === issueId || entry.issue_identifier === identifier)
  }, [snapshot, issueId, identifier])

  const handleStateChange = async (newState: string) => {
    dispatch({ type: 'setState', state: newState })
    if (onUpdate) {
      await onUpdate({ state: newState })
    }
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    const normalized = newAssignee === 'Unassigned' ? '' : newAssignee
    const agentName = normalized.replace('agent-', '')
    if (availableAgents.includes(agentName)) {
      dispatch({ type: 'setAssigneeAndProvider', assignee: newAssignee, provider: agentName })
      if (onUpdate) {
        await onUpdate({ assignee_id: normalized, provider: agentName })
      }
    } else {
      dispatch({ type: 'setAssignee', assignee: newAssignee })
      if (onUpdate) {
        await onUpdate({ assignee_id: normalized })
      }
    }
  }

  const handleToggleTool = async (toolName: string) => {
    const next = disabledTools.includes(toolName) ? disabledTools.filter((tool) => tool !== toolName) : [...disabledTools, toolName]
    dispatch({ type: 'setDisabledTools', disabledTools: next })
    if (onUpdate) {
      await onUpdate({ disabled_tools: next })
    }
  }

  const getHookStatusForType = (type: string) => getHookStatus(timeline, issueId, identifier, type)

  const setLocalProvider = (next: string) => dispatch({ type: 'setProvider', provider: next })

  return {
    isValid,
    identifier,
    issueId,
    title,
    description,
    projectId,
    branchName,
    issueUrl,
    updatedAt,
    localState,
    setLocalProvider,
    localProvider,
    localAssignee,
    activeTab,
    setActiveTab,
    ...data,
    ...logView,
    ...pr,
    disabledTools,
    hookOutputs,
    selectedHookLog,
    setSelectedHookLog,
    activeSessions,
    handleStateChange,
    handleAssigneeChange,
    handleToggleTool,
    getHookStatusForType,
  }
}
