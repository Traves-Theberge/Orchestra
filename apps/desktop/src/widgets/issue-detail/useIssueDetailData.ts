import { useEffect, useMemo, useState } from 'react'

import {
  fetchArtifactContent,
  fetchArtifacts,
  fetchIssueDiff,
  fetchIssueHistory,
  fetchIssueLogs,
  type BackendConfig,
} from '@/lib/orchestra-client'
import type { IssueHistoryEntry } from './types'

import { parseDiff } from './IssueDetailUtils'

export function useIssueDetailData({
  activeTab,
  identifier,
  config,
  localProvider,
}: {
  activeTab: 'overview' | 'changes' | 'logs' | 'artifacts' | 'activity'
  identifier: string
  config: BackendConfig | null
  localProvider: string
}) {
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)

  const [issueHistory, setIssueHistory] = useState<IssueHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null)

  const [artifacts, setArtifacts] = useState<string[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null)
  const [artifactContent, setArtifactContent] = useState<string | null>(null)
  const [reportContent, setReportContent] = useState<string | null>(null)
  const [contentLoading, setArtifactContentLoading] = useState(false)

  const diffFiles = useMemo(() => parseDiff(diff), [diff])

  useEffect(() => {
    if (diffFiles.length > 0 && !activeDiffFile) {
      setActiveDiffFile(diffFiles[0].path)
    }
  }, [diffFiles, activeDiffFile])

  useEffect(() => {
    if (activeTab === 'logs' && identifier && config) {
      setLogsLoading(true)
      fetchIssueLogs(config, identifier, localProvider)
        .then(setLogs)
        .catch(() => {
          setLogs((prev) => prev || 'No logs available yet. Start the task to see real-time output.')
        })
        .finally(() => setLogsLoading(false))
    }

    if (activeTab === 'changes' && identifier && config) {
      setDiffLoading(true)
      fetchIssueDiff(config, identifier, localProvider)
        .then(setDiff)
        .catch(() => {
          setDiff((prev) => prev || 'No workspace changes currently detected.')
        })
        .finally(() => setDiffLoading(false))
    }
  }, [activeTab, identifier, config, localProvider])

  useEffect(() => {
    if (activeTab === 'artifacts' && identifier && config) {
      setArtifactsLoading(true)
      fetchArtifacts(config, identifier, localProvider)
        .then(setArtifacts)
        .catch(() => setArtifacts((prev) => (prev.length === 0 ? [] : prev)))
        .finally(() => setArtifactsLoading(false))
    }

    if (activeTab === 'activity' && identifier && config) {
      setHistoryLoading(true)
      fetchIssueHistory(config, identifier)
        .then(setIssueHistory)
        .catch(() => setIssueHistory([]))
        .finally(() => setHistoryLoading(false))
    }
  }, [activeTab, identifier, config, localProvider])

  useEffect(() => {
    const reportPath = artifacts.find((path) => path.toLowerCase().includes('report.md') || path.toLowerCase().includes('summary.md'))
    if (reportPath && config && identifier) {
      fetchArtifactContent(config, identifier, reportPath, localProvider)
        .then(setReportContent)
        .catch(console.error)
    } else {
      setReportContent(null)
    }
  }, [artifacts, config, identifier, localProvider])

  useEffect(() => {
    if (selectedArtifact && identifier && config) {
      setArtifactContentLoading(true)
      fetchArtifactContent(config, identifier, selectedArtifact, localProvider)
        .then(setArtifactContent)
        .catch(() => setArtifactContent('Failed to load artifact content.'))
        .finally(() => setArtifactContentLoading(false))
    } else {
      setArtifactContent(null)
    }
  }, [selectedArtifact, identifier, config, localProvider])

  return {
    logs,
    logsLoading,
    issueHistory,
    historyLoading,
    diffLoading,
    activeDiffFile,
    setActiveDiffFile,
    diffFiles,
    artifacts,
    artifactsLoading,
    selectedArtifact,
    setSelectedArtifact,
    artifactContent,
    reportContent,
    contentLoading,
  }
}
