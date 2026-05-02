import {
  Box,
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListTodo,
  Settings2,
  Tag,
  Terminal,
} from 'lucide-react'
import type { SidebarItem } from '@layout/types'

export function SandboxIcon({ className, size }: { className?: string; size?: number }) {
  const s = size || 24
  return (
    <svg className={className} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* bucket */}
      <path d="M5 10h14l-1.5 9a1 1 0 0 1-1 .85H7.5a1 1 0 0 1-1-.85L5 10z" />
      <path d="M6 10l-.5-2.5A1 1 0 0 1 6.5 6h11a1 1 0 0 1 1 1.5L18 10" />
      {/* shovel handle */}
      <line x1="17" y1="2" x2="20" y2="8" />
      {/* shovel head */}
      <path d="M19 7l2 1-1.5 2.5-2-1z" />
    </svg>
  )
}

/** Sidebar navigation items displayed in the app shell, in display order. */
export const sidebarItems: SidebarItem[] = [
  {
    id: 'ISSUES',
    label: 'Tasks',
    description: 'Task board and inspector',
    icon: ListTodo,
  },
  {
    id: 'PROJECTS',
    label: 'Projects',
    description: 'Local workspace grouping',
    icon: FolderTree,
  },
  {
    id: 'CONSOLE',
    label: 'Development',
    description: 'Editor, terminals, and browser preview',
    icon: Terminal,
  },
  {
    id: 'AGENTS',
    label: 'Agents',
    description: 'Global agent configurations',
    icon: Cpu,
  },
  {
    id: 'WAREHOUSE',
    label: 'Usage',
    description: 'Per-agent tokens, cost, and sessions',
    icon: Database,
  },
  {
    id: 'SANDBOX',
    label: 'Remote',
    description: 'Remote code execution',
    icon: SandboxIcon,
  },
  {
    id: 'TRACKER',
    label: 'Tracker',
    description: 'Browse Linear, Jira, and GitHub work items',
    icon: Tag,
  },
  {
    id: 'SETTINGS',
    label: 'Settings',
    description: 'Backend profiles, integrations, notifications, and shortcuts',
    icon: Settings2,
  },
  {
    id: 'DOCS',
    label: 'Documentation',
    description: 'User & engineering guides',
    icon: FileText,
  },
]

/** Union type of all navigable section identifiers in the desktop app. */
export type SectionID =
  | 'ISSUES'
  | 'PROJECTS'
  | 'AGENTS'
  | 'WAREHOUSE'
  | 'SANDBOX'
  | 'TRACKER'
  | 'SETTINGS'
  | 'DOCS'
  | 'CONSOLE'

/** Ordered list of all valid section IDs, used for validation. */
const SECTION_IDS: readonly SectionID[] = [
  'ISSUES',
  'PROJECTS',
  'AGENTS',
  'WAREHOUSE',
  'SANDBOX',
  'TRACKER',
  'SETTINGS',
  'DOCS',
  'CONSOLE',
]

/**
 * Type guard that checks whether a string is a valid {@link SectionID}.
 * @param value - The string to test.
 * @returns `true` if the value is a recognized section ID.
 */
export function isSectionID(value: string): value is SectionID {
  return (SECTION_IDS as readonly string[]).includes(value)
}

/** Boolean flags indicating which section panels are currently visible. */
export type SectionVisibility = {
  showIssueBoard: boolean
  showProjects: boolean
  showAgents: boolean
  showWarehouse: boolean
  showSandbox: boolean
  showTracker: boolean
  showSettings: boolean
  showDocs: boolean
  showConsole: boolean
}

/** Display metadata (breadcrumb label and page title) for each section. */
const sectionMeta: Record<SectionID, { label: string; title: string }> = {
  ISSUES: { label: 'Tracker', title: 'Tasks' },
  PROJECTS: { label: 'Workspace', title: 'Projects' },
  AGENTS: { label: 'Compute', title: 'Agents' },
  WAREHOUSE: { label: 'Usage', title: 'Usage' },
  SANDBOX: { label: 'Compute', title: 'Remote Execution' },
  TRACKER: { label: 'Tracker', title: 'Work Items' },
  SETTINGS: { label: 'System', title: 'Settings' },
  DOCS: { label: 'Knowledge', title: 'Documentation' },
  CONSOLE: { label: 'Workspace', title: 'Development' },
}

/**
 * Derives visibility flags from the active section, setting exactly one to true.
 * @param activeSection - The currently active section ID.
 * @returns An object with boolean flags for each section's visibility.
 */
export function getSectionVisibility(activeSection: SectionID): SectionVisibility {
  return {
    showIssueBoard: activeSection === 'ISSUES',
    showProjects: activeSection === 'PROJECTS',
    showAgents: activeSection === 'AGENTS',
    showWarehouse: activeSection === 'WAREHOUSE',
    showSandbox: activeSection === 'SANDBOX',
    showTracker: activeSection === 'TRACKER',
    showSettings: activeSection === 'SETTINGS',
    showDocs: activeSection === 'DOCS',
    showConsole: activeSection === 'CONSOLE',
  }
}

/**
 * Returns the display label and title for the given section.
 * Falls back to the ISSUES section metadata if the section is not found.
 * @param activeSection - The currently active section ID.
 * @returns Object with `label` (breadcrumb category) and `title` (page heading).
 */
export function getCurrentSectionMeta(activeSection: SectionID): { label: string; title: string } {
  return sectionMeta[activeSection] ?? sectionMeta.ISSUES
}
