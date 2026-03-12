import {
  ListTodo,
  Cpu,
  Database,
  FileText,
  FolderTree,
  History,
  LayoutDashboard,
  Settings2,
  Terminal,
  Ticket,
} from 'lucide-react'
import type { SidebarItem } from '@/components/app-shell/types'

export const sidebarItems: SidebarItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Live runtime overview',
    icon: LayoutDashboard,
  },
  {
    id: 'issues',
    label: 'Tasks',
    description: 'Task board and inspector',
    icon: Ticket,
  },
  {
    id: 'running',
    label: 'Running',
    description: 'Active execution queue',
    icon: ListTodo,
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Local workspace grouping',
    icon: FolderTree,
  },
  {
    id: 'timeline',
    label: 'Activity Feed',
    description: 'Real-time lifecycle events',
    icon: History,
  },
  {
    id: 'console',
    label: 'Live Console',
    description: 'Multi-agent terminal dock',
    icon: Terminal,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Global agent configurations',
    icon: Cpu,
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    description: 'Token analytics and archives',
    icon: Database,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Backend and migration controls',
    icon: Settings2,
  },
  {
    id: 'docs',
    label: 'Documentation',
    description: 'User & engineering guides',
    icon: FileText,
  },
]

export type SectionID =
  | 'dashboard'
  | 'running'
  | 'timeline'
  | 'issues'
  | 'projects'
  | 'agents'
  | 'warehouse'
  | 'settings'
  | 'docs'
  | 'console'

const SECTION_IDS: readonly SectionID[] = [
  'dashboard',
  'running',
  'timeline',
  'issues',
  'projects',
  'agents',
  'warehouse',
  'settings',
  'docs',
  'console',
]

export function isSectionID(value: string): value is SectionID {
  return (SECTION_IDS as readonly string[]).includes(value)
}

export type SectionVisibility = {
  showDashboard: boolean
  showRunning: boolean
  showTimeline: boolean
  showIssueBoard: boolean
  showProjects: boolean
  showAgents: boolean
  showWarehouse: boolean
  showSettings: boolean
  showDocs: boolean
  showConsole: boolean
}

const sectionMeta: Record<SectionID, { label: string; title: string }> = {
  dashboard: { label: 'Operations', title: 'Dashboard' },
  running: { label: 'Operations', title: 'Running' },
  timeline: { label: 'Diagnostics', title: 'Activity Feed' },
  issues: { label: 'Tracker', title: 'Tasks' },
  projects: { label: 'Workspace', title: 'Projects' },
  agents: { label: 'Compute', title: 'Agents' },
  warehouse: { label: 'Analytics', title: 'Warehouse' },
  settings: { label: 'System', title: 'Settings' },
  docs: { label: 'Knowledge', title: 'Documentation' },
  console: { label: 'Runtime', title: 'Live Console' },
}

export function getSectionVisibility(activeSection: SectionID): SectionVisibility {
  return {
    showDashboard: activeSection === 'dashboard',
    showRunning: activeSection === 'running',
    showTimeline: activeSection === 'timeline',
    showIssueBoard: activeSection === 'issues',
    showProjects: activeSection === 'projects',
    showAgents: activeSection === 'agents',
    showWarehouse: activeSection === 'warehouse',
    showSettings: activeSection === 'settings',
    showDocs: activeSection === 'docs',
    showConsole: activeSection === 'console',
  }
}

export function getCurrentSectionMeta(activeSection: SectionID): { label: string; title: string } {
  return sectionMeta[activeSection] ?? sectionMeta.dashboard
}
