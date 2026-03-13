import { FileText } from 'lucide-react'

import { AppTooltip } from '@/components/ui/tooltip-wrapper'

export function IssueDetailTabBar({
  reportContent,
  activeTab,
  setActiveTab,
  localState,
}: {
  reportContent: string | null
  activeTab: 'overview' | 'changes' | 'logs' | 'artifacts' | 'activity'
  setActiveTab: (tab: 'overview' | 'changes' | 'logs' | 'artifacts' | 'activity') => void
  localState: string
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/20 p-1 shrink-0">
      {reportContent && (
        <AppTooltip content="Executive summary and autonomous verification report">
          <button
            onClick={() => setActiveTab('artifacts')}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 shadow-lg shadow-primary/5"
          >
            <FileText size={12} strokeWidth={3} />
            REPORT
          </button>
        </AppTooltip>
      )}
      <AppTooltip content="Task metadata, agent configuration, and runtime pulse">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'overview' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Overview
        </button>
      </AppTooltip>
      <AppTooltip content="Workspace diff and file-level modifications">
        <button
          onClick={() => setActiveTab('changes')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'changes' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Changes
        </button>
      </AppTooltip>
      <AppTooltip content={localState === 'In Progress' ? 'Connect to live PTY session' : 'View historical agent execution logs'}>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'logs' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {localState === 'In Progress' ? 'Live Logs' : 'Logs'}
        </button>
      </AppTooltip>
      <AppTooltip content="Review generated documentation, code, and session assets">
        <button
          onClick={() => setActiveTab('artifacts')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'artifacts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Artifacts
        </button>
      </AppTooltip>
      <AppTooltip content="Full chronological audit trail of all session events">
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === 'activity' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Activity
        </button>
      </AppTooltip>
    </div>
  )
}
