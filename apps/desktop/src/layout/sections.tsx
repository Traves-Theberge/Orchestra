import {
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListTodo,
  Settings2,
  Terminal,
} from 'lucide-react'
import type { SidebarItem } from '@layout/types'

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
  | 'SETTINGS'
  | 'DOCS'
  | 'CONSOLE'

/** Ordered list of all valid section IDs, used for validation. */
const SECTION_IDS: readonly SectionID[] = [
  'ISSUES',
  'PROJECTS',
  'AGENTS',
  'WAREHOUSE',
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
