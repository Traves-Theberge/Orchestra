/**
 * Integration tests for the composed Zustand store.
 *
 * Verifies that all 9 slices are accessible from `useAppStore` and that
 * actions from different slices interact correctly when composed.
 *
 * NOTE: Zustand stores are module-level singletons. Each test resets store
 * state via `useAppStore.setState` so mutations don't bleed across tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import type { IssueListItem } from '@core/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot of initial store state, captured once at module load. */
const initialState = useAppStore.getState()

/** Helper to reset the store to its initial values before each test. */
function resetStore() {
  useAppStore.setState(initialState, true)
}

const makeIssue = (title: string, id = title): IssueListItem =>
  ({ id, title, status: 'open' }) as unknown as IssueListItem

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore()
})

// ---------------------------------------------------------------------------
// Slice state accessibility
// ---------------------------------------------------------------------------

describe('Composed store — UI slice', () => {
  it('exposes activeSection initialized to CONSOLE', () => {
    const { activeSection } = useAppStore.getState()
    expect(activeSection).toBe('CONSOLE')
  })

  it('exposes setActiveSection as a function', () => {
    const { setActiveSection } = useAppStore.getState()
    expect(typeof setActiveSection).toBe('function')
  })

  it('exposes toggleSidebar as a function', () => {
    const { toggleSidebar } = useAppStore.getState()
    expect(typeof toggleSidebar).toBe('function')
  })

  it('exposes togglePalette as a function', () => {
    const { togglePalette } = useAppStore.getState()
    expect(typeof togglePalette).toBe('function')
  })

  it('exposes studioModalOpen initialized to false', () => {
    const { studioModalOpen } = useAppStore.getState()
    expect(studioModalOpen).toBe(false)
  })

  it('exposes setStudioModalOpen as a function', () => {
    const { setStudioModalOpen } = useAppStore.getState()
    expect(typeof setStudioModalOpen).toBe('function')
  })
})

describe('Composed store — Runtime slice', () => {
  it('exposes snapshot initialized to null', () => {
    const { snapshot } = useAppStore.getState()
    expect(snapshot).toBeNull()
  })

  it('exposes updateSnapshot as a function', () => {
    const { updateSnapshot } = useAppStore.getState()
    expect(typeof updateSnapshot).toBe('function')
  })

  it('exposes addTimelineEvent as a function', () => {
    const { addTimelineEvent } = useAppStore.getState()
    expect(typeof addTimelineEvent).toBe('function')
  })
})

describe('Composed store — Issues slice', () => {
  it('exposes boardIssues initialized to []', () => {
    const { boardIssues } = useAppStore.getState()
    expect(boardIssues).toEqual([])
  })

  it('exposes setBoardIssues as a function', () => {
    const { setBoardIssues } = useAppStore.getState()
    expect(typeof setBoardIssues).toBe('function')
  })
})

describe('Composed store — Projects slice', () => {
  it('exposes projects initialized to []', () => {
    const { projects } = useAppStore.getState()
    expect(projects).toEqual([])
  })

  it('exposes setProjects as a function', () => {
    const { setProjects } = useAppStore.getState()
    expect(typeof setProjects).toBe('function')
  })
})

describe('Composed store — Agents slice', () => {
  it('exposes agentConfig initialized to null', () => {
    const { agentConfig } = useAppStore.getState()
    expect(agentConfig).toBeNull()
  })

  it('exposes setAgentConfig as a function', () => {
    const { setAgentConfig } = useAppStore.getState()
    expect(typeof setAgentConfig).toBe('function')
  })
})

describe('Composed store — Settings slice', () => {
  it('exposes config initialized to null', () => {
    const { config } = useAppStore.getState()
    expect(config).toBeNull()
  })

  it('exposes setConfig as a function', () => {
    const { setConfig } = useAppStore.getState()
    expect(typeof setConfig).toBe('function')
  })
})

describe('Composed store — Terminals slice', () => {
  it('exposes openTerminals initialized to []', () => {
    const { openTerminals } = useAppStore.getState()
    expect(openTerminals).toEqual([])
  })
})

describe('Composed store — Workspace slice', () => {
  it('exposes explorerRoot initialized to null', () => {
    const { explorerRoot } = useAppStore.getState()
    expect(explorerRoot).toBeNull()
  })

  it('exposes setLeftSidebarWidth as a function', () => {
    const { setLeftSidebarWidth } = useAppStore.getState()
    expect(typeof setLeftSidebarWidth).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Cross-slice action tests
// ---------------------------------------------------------------------------

describe('Composed store — cross-slice actions', () => {
  it('setActiveSection updates activeSection', () => {
    useAppStore.getState().setActiveSection('CONSOLE')
    expect(useAppStore.getState().activeSection).toBe('CONSOLE')
  })

  it('setConfig updates config', () => {
    const cfg = { baseUrl: 'http://localhost:4010', apiToken: 'test' }
    useAppStore.getState().setConfig(cfg as any)
    expect(useAppStore.getState().config).toEqual(cfg)
  })

  it('setBoardIssues updates boardIssues and allBoardIssues', () => {
    const issue = makeIssue('Fix login bug', 'issue-1')
    useAppStore.getState().setBoardIssues([issue])

    const { boardIssues, allBoardIssues } = useAppStore.getState()
    expect(boardIssues).toHaveLength(1)
    expect(boardIssues[0].title).toBe('Fix login bug')
    expect(allBoardIssues).toHaveLength(1)
    expect(allBoardIssues[0].title).toBe('Fix login bug')
  })

  it('mutations from one slice do not corrupt another slice', () => {
    useAppStore.getState().setActiveSection('AGENTS')
    useAppStore.getState().setBoardIssues([makeIssue('Task A')])

    const { activeSection, boardIssues, config, snapshot } = useAppStore.getState()
    expect(activeSection).toBe('AGENTS')
    expect(boardIssues).toHaveLength(1)
    expect(config).toBeNull()
    expect(snapshot).toBeNull()
  })
})
