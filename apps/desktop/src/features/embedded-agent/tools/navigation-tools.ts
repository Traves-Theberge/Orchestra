import { tool } from 'ai'
import { z } from 'zod'

const SECTIONS = [
  'ISSUES',
  'PROJECTS',
  'CONSOLE',
  'AGENTS',
  'WAREHOUSE',
  'SANDBOX',
  'SETTINGS',
  'DOCS',
] as const

const SETTINGS_TABS = [
  'backend',
  'agents',
  'integrations',
  'shortcuts',
  'notifications',
] as const

/**
 * Creates navigation tools that allow the embedded agent to switch
 * the desktop app to different sections and settings tabs.
 */
export function createNavigationTools(
  onNavigate: (section: string, id?: string) => void,
) {
  return {
    navigate_to: tool({
      description:
        'Navigate the app to a specific section. ' +
        'Section mapping: ISSUES=Tasks/Issues, PROJECTS=Projects, CONSOLE=Live Console/Terminal, ' +
        'AGENTS=Agent config, WAREHOUSE=Analytics/Token usage, SANDBOX=Code execution, ' +
        'SETTINGS=Settings, DOCS=Documentation. ' +
        'Use when the user asks to go to, open, or show a section.',
      inputSchema: z.object({
        section: z.enum(SECTIONS).describe('Section ID: ISSUES, PROJECTS, CONSOLE, AGENTS, WAREHOUSE (analytics), SANDBOX, SETTINGS, DOCS'),
      }),
      execute: async (params) => {
        onNavigate(params.section)
        return { navigated: params.section }
      },
    }),

    open_settings_tab: tool({
      description:
        'Open a specific tab within Settings (backend, agents, integrations, shortcuts, notifications). ' +
        'Use when the user asks to open a specific settings tab.',
      inputSchema: z.object({
        tab: z.enum(SETTINGS_TABS).describe('The settings tab to open'),
      }),
      execute: async (params) => {
        onNavigate('SETTINGS', params.tab)
        return { navigated: 'SETTINGS', tab: params.tab }
      },
    }),
  }
}
