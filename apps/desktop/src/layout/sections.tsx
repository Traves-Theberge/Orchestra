import {
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListTodo,
  Network,
  Settings2,
} from 'lucide-react'
import type { SidebarItem } from '@layout/types'

function SandboxIcon({ className, size }: { className?: string; size?: number }) {
  const s = size || 24
  return (
    <svg className={className} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 10h14l-1.5 9a1 1 0 0 1-1 .85H7.5a1 1 0 0 1-1-.85L5 10z" />
      <path d="M6 10l-.5-2.5A1 1 0 0 1 6.5 6h11a1 1 0 0 1 1 1.5L18 10" />
      <line x1="17" y1="2" x2="20" y2="8" />
      <path d="M19 7l2 1-1.5 2.5-2-1z" />
    </svg>
  )
}

export const sidebarItems: SidebarItem[] = [
  { id: 'ORCHESTRATOR', label: 'Orchestrator', description: 'Coordinate agents across projects and worktrees', icon: Network },
  { id: 'PROJECTS', label: 'Projects', description: 'Chat, files, terminals, Git and tasks', icon: FolderTree },
  { id: 'ISSUES', label: 'Tasks', description: 'Task board and inspector', icon: ListTodo },
  { id: 'AGENTS', label: 'Agents', description: 'Global agent configurations', icon: Cpu },
  { id: 'WAREHOUSE', label: 'Usage', description: 'Per-agent tokens, cost, and sessions', icon: Database },
  { id: 'SANDBOX', label: 'Remote', description: 'Remote code execution', icon: SandboxIcon },
  { id: 'DOCS', label: 'Documentation', description: 'User & engineering guides', icon: FileText },
  { id: 'SETTINGS', label: 'Settings', description: 'Backend profiles, integrations, notifications, and shortcuts', icon: Settings2 },
]

export type SectionID =
  | 'ORCHESTRATOR'
  | 'ISSUES'
  | 'PROJECTS'
  | 'AGENTS'
  | 'WAREHOUSE'
  | 'SANDBOX'
  | 'SETTINGS'
  | 'DOCS'
  | 'CONSOLE'

const SECTION_IDS: readonly SectionID[] = [
  'ORCHESTRATOR',
  'ISSUES',
  'PROJECTS',
  'AGENTS',
  'WAREHOUSE',
  'SANDBOX',
  'SETTINGS',
  'DOCS',
  'CONSOLE',
]

export function isSectionID(value: string): value is SectionID {
  return (SECTION_IDS as readonly string[]).includes(value)
}

export type SectionVisibility = {
  showOrchestrator: boolean
  showIssueBoard: boolean
  showProjects: boolean
  showAgents: boolean
  showWarehouse: boolean
  showSandbox: boolean
  showSettings: boolean
  showDocs: boolean
  showConsole: boolean
}

const sectionMeta: Record<SectionID, { label: string; title: string }> = {
  ORCHESTRATOR: { label: 'Control', title: 'Orchestrator' },
  ISSUES: { label: 'Tracker', title: 'Tasks' },
  PROJECTS: { label: 'Workspace', title: 'Projects' },
  AGENTS: { label: 'Compute', title: 'Agents' },
  WAREHOUSE: { label: 'Usage', title: 'Usage' },
  SANDBOX: { label: 'Compute', title: 'Remote Execution' },
  SETTINGS: { label: 'System', title: 'Settings' },
  DOCS: { label: 'Knowledge', title: 'Documentation' },
  CONSOLE: { label: 'Workspace', title: 'Development' },
}

export function getSectionVisibility(activeSection: SectionID): SectionVisibility {
  return {
    showOrchestrator: activeSection === 'ORCHESTRATOR',
    showIssueBoard: activeSection === 'ISSUES',
    showProjects: false,
    showAgents: activeSection === 'AGENTS',
    showWarehouse: activeSection === 'WAREHOUSE',
    showSandbox: activeSection === 'SANDBOX',
    showSettings: activeSection === 'SETTINGS',
    showDocs: activeSection === 'DOCS',
    showConsole: activeSection === 'CONSOLE' || activeSection === 'PROJECTS',
  }
}

export function getCurrentSectionMeta(activeSection: SectionID): { label: string; title: string } {
  return sectionMeta[activeSection] ?? sectionMeta.ISSUES
}
