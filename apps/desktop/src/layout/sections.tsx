import {
  CalendarClock,
  Cpu,
  FileText,
  FolderTree,
  ListTodo,
  Network,
  Settings2,
} from 'lucide-react'
import type { SidebarItem } from '@layout/types'

export const sidebarItems: SidebarItem[] = [
  { id: 'ORCHESTRATOR', label: 'Maestro', description: 'Coordinate agents across projects and worktrees', icon: Network },
  { id: 'PROJECTS', label: 'Projects', description: 'Chat, files, terminals, Git and tasks', icon: FolderTree },
  { id: 'ISSUES', label: 'Tasks', description: 'Task board and inspector', icon: ListTodo },
  { id: 'AUTOMATIONS', label: 'Automations', description: 'Scheduled agent runs', icon: CalendarClock },
  { id: 'AGENTS', label: 'Agents', description: 'Global agent configurations', icon: Cpu },
  { id: 'DOCS', label: 'Documentation', description: 'User & engineering guides', icon: FileText },
  { id: 'SETTINGS', label: 'Settings', description: 'Backend profiles, integrations, notifications, and shortcuts', icon: Settings2 },
]

export type SectionID =
  | 'ORCHESTRATOR'
  | 'ISSUES'
  | 'AUTOMATIONS'
  | 'PROJECTS'
  | 'AGENTS'
  | 'WAREHOUSE'
  | 'SETTINGS'
  | 'DOCS'
  | 'API_DOCS'
  | 'CONSOLE'

const SECTION_IDS: readonly SectionID[] = [
  'ORCHESTRATOR',
  'ISSUES',
  'AUTOMATIONS',
  'PROJECTS',
  'AGENTS',
  'WAREHOUSE',
  'SETTINGS',
  'DOCS',
  'API_DOCS',
  'CONSOLE',
]

export function isSectionID(value: string): value is SectionID {
  return (SECTION_IDS as readonly string[]).includes(value)
}

export type SectionVisibility = {
  showOrchestrator: boolean
  showIssueBoard: boolean
  showAutomations: boolean
  showProjects: boolean
  showAgents: boolean
  showWarehouse: boolean
  showSettings: boolean
  showDocs: boolean
  showApiDocs: boolean
  showConsole: boolean
}

const sectionMeta: Record<SectionID, { label: string; title: string }> = {
  ORCHESTRATOR: { label: 'Control', title: 'Orchestrator' },
  ISSUES: { label: 'Tracker', title: 'Tasks' },
  AUTOMATIONS: { label: 'Schedule', title: 'Automations' },
  PROJECTS: { label: 'Workspace', title: 'Projects' },
  AGENTS: { label: 'Compute', title: 'Agents' },
  WAREHOUSE: { label: 'Usage', title: 'Usage' },
  SETTINGS: { label: 'System', title: 'Settings' },
  DOCS: { label: 'Knowledge', title: 'Documentation' },
  API_DOCS: { label: 'API', title: 'API Documentation' },
  CONSOLE: { label: 'Workspace', title: 'Development' },
}

export function getSectionVisibility(activeSection: SectionID): SectionVisibility {
  return {
    showOrchestrator: activeSection === 'ORCHESTRATOR',
    showIssueBoard: activeSection === 'ISSUES',
    showAutomations: activeSection === 'AUTOMATIONS',
    showProjects: false,
    showAgents: activeSection === 'AGENTS',
    showWarehouse: false,
    showSettings: activeSection === 'SETTINGS',
    showDocs: activeSection === 'DOCS',
    showApiDocs: activeSection === 'API_DOCS',
    showConsole: activeSection === 'CONSOLE' || activeSection === 'PROJECTS',
  }
}

export function getCurrentSectionMeta(activeSection: SectionID): { label: string; title: string } {
  return sectionMeta[activeSection] ?? sectionMeta.ISSUES
}
