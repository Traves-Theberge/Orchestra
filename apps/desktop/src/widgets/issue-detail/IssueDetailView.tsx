import type { BackendConfig, IssueUpdatePayload } from '@/lib/orchestra-client'
import type { SnapshotPayload } from '@/lib/orchestra-types'
import type { TimelineItem } from '@/components/app-shell/types'

import { HookOutputDialog, PRReviewDialog } from './IssueDetailDialogs'
import { OverviewTab } from './IssueDetailOverviewTab'
import { IssueDetailTabBar } from './IssueDetailTabBar'
import { ActivityTab, ArtifactsTab, ChangesTab, LogsTab } from './IssueDetailTabs'
import { getEventIcon, getFileIcon, ISSUE_HOOKS } from './IssueDetailUtils'
import { useIssueDetailState } from './useIssueDetailState'
import type { IssueDetailResult, ToolSummary } from './types'

export function IssueDetailView({
  result,
  onUpdate,
  onStopSession,
  onJumpToTerminal,
  onNavigate,
  config,
  snapshot,
  timeline = [],
  availableAgents = [],
  allTools = [],
  theme,
}: {
  result: IssueDetailResult | null
  onUpdate?: (updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  onJumpToTerminal?: (identifier: string) => void
  onNavigate?: (section: string) => void
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  timeline?: TimelineItem[]
  availableAgents?: string[]
  allTools?: ToolSummary[]
  theme?: 'light' | 'dark'
}) {
  void onJumpToTerminal

  const state = useIssueDetailState({
    result,
    onUpdate,
    config,
    snapshot,
    timeline,
    availableAgents,
  })

  if (!state.isValid) {
    return <div className="p-8 text-center text-muted-foreground italic">Invalid issue data provided.</div>
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <IssueDetailTabBar
        reportContent={state.reportContent}
        activeTab={state.activeTab}
        setActiveTab={state.setActiveTab}
        localState={state.localState}
      />

      {state.activeTab === 'overview' ? (
        <OverviewTab
          activeSessions={state.activeSessions}
          localProvider={state.localProvider}
          setLocalProvider={state.setLocalProvider}
          identifier={state.identifier}
          issueId={state.issueId}
          title={state.title}
          localState={state.localState}
          handleStateChange={state.handleStateChange}
          localAssignee={state.localAssignee}
          availableAgents={availableAgents}
          handleAssigneeChange={state.handleAssigneeChange}
          prResult={state.prResult}
          handleCreatePR={state.handleCreatePR}
          prPending={state.prPending}
          onStopSession={onStopSession}
          onNavigate={onNavigate}
          description={state.description}
          reportContent={state.reportContent}
          setActiveTab={state.setActiveTab}
          timeline={timeline}
          allTools={allTools}
          disabledTools={state.disabledTools}
          handleToggleTool={state.handleToggleTool}
          issueHistory={state.issueHistory}
          getEventIcon={getEventIcon}
          priority={state.priority}
          branchName={state.branchName}
          updatedAt={state.updatedAt}
          issueUrl={state.issueUrl}
          hooks={ISSUE_HOOKS}
          getHookStatus={state.getHookStatusForType}
          hookOutputs={state.hookOutputs}
          setSelectedHookLog={state.setSelectedHookLog}
        />
      ) : state.activeTab === 'changes' ? (
        <ChangesTab
          diffLoading={state.diffLoading}
          diffFiles={state.diffFiles}
          activeDiffFile={state.activeDiffFile}
          setActiveDiffFile={state.setActiveDiffFile}
        />
      ) : state.activeTab === 'logs' ? (
        <LogsTab
          localProvider={state.localProvider}
          localState={state.localState}
          logFilter={state.logFilter}
          setLogFilter={state.setLogFilter}
          followLogs={state.followLogs}
          setFollowLogs={state.setFollowLogs}
          logsLoading={state.logsLoading}
          config={config}
          identifier={state.identifier}
          projectId={state.projectId}
          theme={theme}
          logContainerRef={state.logContainerRef}
          handleLogScroll={state.handleLogScroll}
          logs={state.logs}
          filteredLogs={state.filteredLogs}
        />
      ) : state.activeTab === 'artifacts' ? (
        <ArtifactsTab
          artifacts={state.artifacts}
          artifactsLoading={state.artifactsLoading}
          selectedArtifact={state.selectedArtifact}
          setSelectedArtifact={state.setSelectedArtifact}
          getFileIcon={getFileIcon}
          contentLoading={state.contentLoading}
          artifactContent={state.artifactContent}
        />
      ) : (
        <ActivityTab historyLoading={state.historyLoading} issueHistory={state.issueHistory} getEventIcon={getEventIcon} />
      )}

      <PRReviewDialog
        open={state.prDialogOpen}
        onOpenChange={state.setPrDialogOpen}
        prPending={state.prPending}
        prTitle={state.prTitle}
        setPrTitle={state.setPrTitle}
        prBody={state.prBody}
        setPrBody={state.setPrBody}
        prHead={state.prHead}
        onFinalize={state.handleFinalizePR}
      />

      <HookOutputDialog selectedHookLog={state.selectedHookLog} setSelectedHookLog={state.setSelectedHookLog} />
    </div>
  )
}
