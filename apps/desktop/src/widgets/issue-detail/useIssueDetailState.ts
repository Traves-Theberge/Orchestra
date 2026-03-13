import { useEffect, useMemo, useState } from 'react'

import type { TimelineItem } from '@/components/app-shell/types'
import type { BackendConfig, IssueUpdatePayload } from '@/lib/orchestra-client'
import type { SnapshotPayload } from '@/lib/orchestra-types'

import { extractHookOutputs, getHookStatus } from './IssueDetailUtils'
import { useIssueDetailData } from './useIssueDetailData'
import { useIssueDetailLogView } from './useIssueDetailLogView'
import { useIssueDetailPR } from './useIssueDetailPR'
import type { IssueDetailResult } from './types'

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
  const [localState, setLocalState] = useState('Todo')
  const [localAssignee, setLocalAssignee] = useState('Unassigned')
  const [localProvider, setLocalProvider] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'overview' | 'changes' | 'logs' | 'artifacts' | 'activity'>('overview')
  const [disabledTools, setDisabledTools] = useState<string[]>([])
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
  const priority = (typed.priority as number) || 0
  const projectId = (typed.project_id as string) || ''
  const branchName = (typed.branch_name as string) || ''
  const issueUrl = (typed.url as string) || ''
  const provider = (typed.provider as string) || ''
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
  })

  useEffect(() => {
    setLocalState(state)
    setLocalAssignee(assigneeId)
    setLocalProvider(provider)
    setDisabledTools(disabledToolsFromResult)
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
    setLocalState(newState)
    if (onUpdate) {
      await onUpdate({ state: newState })
    }
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    const normalized = newAssignee === 'Unassigned' ? '' : newAssignee
    setLocalAssignee(newAssignee)

    const agentName = normalized.replace('agent-', '')
    if (availableAgents.includes(agentName)) {
      setLocalProvider(agentName)
      if (onUpdate) {
        await onUpdate({ assignee_id: normalized, provider: agentName })
      }
    } else if (onUpdate) {
      await onUpdate({ assignee_id: normalized })
    }
  }

  const handleToggleTool = async (toolName: string) => {
    const next = disabledTools.includes(toolName) ? disabledTools.filter((tool) => tool !== toolName) : [...disabledTools, toolName]
    setDisabledTools(next)
    if (onUpdate) {
      await onUpdate({ disabled_tools: next })
    }
  }

  const getHookStatusForType = (type: string) => getHookStatus(timeline, issueId, identifier, type)

  return {
    isValid,
    identifier,
    issueId,
    title,
    description,
    priority,
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
