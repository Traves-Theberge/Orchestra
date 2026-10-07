import { describe, it, expect } from 'vitest'
import { createWorkspaceSlice } from './workspace.slice'
import type { AppState, TreeNode } from '../types'

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function createTestSlice() {
  let state = {} as AppState
  const set = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get = () => state
  const api = { setState: set, getState: get, subscribe: () => () => {}, destroy: () => {} } as any
  const slice = createWorkspaceSlice(set as any, get, api)
  state = { ...state, ...slice }
  return { get: () => state, state: slice }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceSlice — default initialization', () => {
  it('initializes explorerRoot to null', () => {
    const { state } = createTestSlice()
    expect(state.explorerRoot).toBeNull()
  })

  it('initializes activeLeftPanel to explorer', () => {
    const { state } = createTestSlice()
    expect(state.activeLeftPanel).toBe('explorer')
  })

  it('initializes leftSidebarWidth to 280', () => {
    const { state } = createTestSlice()
    expect(state.leftSidebarWidth).toBe(280)
  })

  it('initializes rightSidebarWidth to 320', () => {
    const { state } = createTestSlice()
    expect(state.rightSidebarWidth).toBe(320)
  })

  it('initializes rightSidebarOpen to true', () => {
    const { state } = createTestSlice()
    expect(state.rightSidebarOpen).toBe(true)
  })
})

describe('WorkspaceSlice — setLeftSidebarWidth clamping', () => {
  it('sets valid width within range', () => {
    const { get, state } = createTestSlice()
    state.setLeftSidebarWidth(350)
    expect(get().leftSidebarWidth).toBe(350)
  })

  it('clamps to min 220 when below range', () => {
    const { get, state } = createTestSlice()
    state.setLeftSidebarWidth(100)
    expect(get().leftSidebarWidth).toBe(220)
  })

  it('clamps to max 500 when above range', () => {
    const { get, state } = createTestSlice()
    state.setLeftSidebarWidth(600)
    expect(get().leftSidebarWidth).toBe(500)
  })

  it('accepts exactly 220 (min boundary)', () => {
    const { get, state } = createTestSlice()
    state.setLeftSidebarWidth(220)
    expect(get().leftSidebarWidth).toBe(220)
  })

  it('accepts exactly 500 (max boundary)', () => {
    const { get, state } = createTestSlice()
    state.setLeftSidebarWidth(500)
    expect(get().leftSidebarWidth).toBe(500)
  })
})

describe('WorkspaceSlice — setRightSidebarWidth clamping', () => {
  it('sets valid width within range', () => {
    const { get, state } = createTestSlice()
    state.setRightSidebarWidth(400)
    expect(get().rightSidebarWidth).toBe(400)
  })

  it('clamps to min 280 when below range', () => {
    const { get, state } = createTestSlice()
    state.setRightSidebarWidth(100)
    expect(get().rightSidebarWidth).toBe(280)
  })

  it('clamps to max 500 when above range', () => {
    const { get, state } = createTestSlice()
    state.setRightSidebarWidth(700)
    expect(get().rightSidebarWidth).toBe(500)
  })
})

describe('WorkspaceSlice — toggleRightSidebar', () => {
  it('flips rightSidebarOpen from true to false', () => {
    const { get, state } = createTestSlice()
    expect(get().rightSidebarOpen).toBe(true)
    state.toggleRightSidebar()
    expect(get().rightSidebarOpen).toBe(false)
  })

  it('flips rightSidebarOpen back to true', () => {
    const { get, state } = createTestSlice()
    state.toggleRightSidebar()
    state.toggleRightSidebar()
    expect(get().rightSidebarOpen).toBe(true)
  })
})

describe('WorkspaceSlice — simple setters', () => {
  it('setExplorerRoot updates explorerRoot', () => {
    const { get, state } = createTestSlice()
    state.setExplorerRoot('/home/user/project')
    expect(get().explorerRoot).toBe('/home/user/project')
  })

  it('setActiveLeftPanel switches to search', () => {
    const { get, state } = createTestSlice()
    state.setActiveLeftPanel('search')
    expect(get().activeLeftPanel).toBe('search')
  })

  it('setRightSidebarOpen sets to false', () => {
    const { get, state } = createTestSlice()
    state.setRightSidebarOpen(false)
    expect(get().rightSidebarOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Explorer state tests
// ---------------------------------------------------------------------------

describe('WorkspaceSlice — toggleDir', () => {
  it('adds a directory to expandedDirs', () => {
    const { get, state } = createTestSlice()
    state.toggleDir('/home/user/project/src')
    expect(get().expandedDirs.has('/home/user/project/src')).toBe(true)
  })

  it('removes a directory on second toggle', () => {
    const { get, state } = createTestSlice()
    state.toggleDir('/home/user/project/src')
    state.toggleDir('/home/user/project/src')
    expect(get().expandedDirs.has('/home/user/project/src')).toBe(false)
  })

  it('creates a new Set reference each time', () => {
    const { get, state } = createTestSlice()
    const before = get().expandedDirs
    state.toggleDir('/tmp')
    expect(get().expandedDirs).not.toBe(before)
  })
})

describe('WorkspaceSlice — setDirChildren', () => {
  it('stores children and sets loading to false', () => {
    const { get, state } = createTestSlice()
    const children: TreeNode[] = [
      { name: 'src', path: '/p/src', relativePath: 'src', isDirectory: true, depth: 0 },
      { name: 'README.md', path: '/p/README.md', relativePath: 'README.md', isDirectory: false, depth: 0 },
    ]
    state.setDirChildren('/p', children)
    const cache = get().dirCache['/p']
    expect(cache.children).toEqual(children)
    expect(cache.loading).toBe(false)
  })
})

describe('WorkspaceSlice — setDirLoading', () => {
  it('sets loading on a new entry', () => {
    const { get, state } = createTestSlice()
    state.setDirLoading('/p/src', true)
    expect(get().dirCache['/p/src'].loading).toBe(true)
    expect(get().dirCache['/p/src'].children).toEqual([])
  })

  it('preserves existing children when setting loading', () => {
    const { get, state } = createTestSlice()
    const children: TreeNode[] = [
      { name: 'a.ts', path: '/p/a.ts', relativePath: 'a.ts', isDirectory: false, depth: 1 },
    ]
    state.setDirChildren('/p', children)
    state.setDirLoading('/p', true)
    expect(get().dirCache['/p'].loading).toBe(true)
    expect(get().dirCache['/p'].children).toEqual(children)
  })
})

describe('WorkspaceSlice — setGitStatusMap', () => {
  it('replaces the git status map', () => {
    const { get, state } = createTestSlice()
    state.setGitStatusMap({ 'src/index.ts': 'M', 'new.txt': '??' })
    expect(get().gitStatusMap).toEqual({ 'src/index.ts': 'M', 'new.txt': '??' })
  })
})

describe('WorkspaceSlice — clearExplorerCache', () => {
  it('resets expandedDirs, dirCache, and gitStatusMap', () => {
    const { get, state } = createTestSlice()
    state.toggleDir('/p/src')
    state.setDirChildren('/p', [
      { name: 'src', path: '/p/src', relativePath: 'src', isDirectory: true, depth: 0 },
    ])
    state.setGitStatusMap({ 'src/index.ts': 'M' })
    state.clearExplorerCache()
    expect(get().expandedDirs.size).toBe(0)
    expect(get().dirCache).toEqual({})
    expect(get().gitStatusMap).toEqual({})
  })
})

describe('WorkspaceSlice — center tabs', () => {
  it('routes terminal, browser, editor and conversations refs to the center strip and selects them', () => {
    const { get } = createTestSlice()
    get().addTabToGroup('p', { type: 'terminal', id: 't1' })
    get().addTabToGroup('p', { type: 'browser', id: 'b1' })
    get().addTabToGroup('p', { type: 'editor', id: '/p/a.ts' })
    get().addTabToGroup('p', { type: 'conversations', id: 'conversations' })
    expect(get().projectCenterTabs.p.tabs.map(t => t.id)).toEqual(['t1', 'b1', '/p/a.ts', 'conversations'])
    expect(get().projectCenterTabs.p.selectedId).toBe('conversations')
    expect(get().projectGroups.p).toBeUndefined()
    get().addTabToGroup('p', { type: 'terminal', id: 't1' })
    expect(get().projectCenterTabs.p.tabs).toHaveLength(4)
    expect(get().projectCenterTabs.p.selectedId).toBe('t1')
  })

  it('routes files and git refs to tab groups and bumps the side tool request', () => {
    const { get } = createTestSlice()
    get().addTabToGroup('p', { type: 'git', id: 'git' })
    get().addTabToGroup('p', { type: 'files', id: 'files' })
    expect(Object.values(get().projectGroups.p)[0].tabs.map(t => t.type)).toEqual(['git', 'files'])
    expect(get().sideToolRequests.p).toBe(2)
    expect(get().projectCenterTabs.p).toBeUndefined()
  })

  it('falls back to the previous selection, skipping closed tabs, then Workspace', () => {
    const { get } = createTestSlice()
    get().selectCenterTab('p', '@tasks')
    get().addTabToGroup('p', { type: 'terminal', id: 't1' })
    get().addTabToGroup('p', { type: 'browser', id: 'b1' })
    get().activateTabInGroup('p', 't1')
    get().removeTabFromGroup('p', 'b1')
    expect(get().projectCenterTabs.p.selectedId).toBe('t1')
    get().removeTabFromGroup('p', 't1')
    expect(get().projectCenterTabs.p.selectedId).toBe('@tasks')
    get().selectCenterTab('p', '@workspace')
    get().selectCenterTab('p', 'missing')
    expect(get().projectCenterTabs.p.selectedId).toBe('@workspace')
  })

  it('reorders center tabs', () => {
    const { get } = createTestSlice()
    for (const id of ['a', 'b', 'c']) get().addTabToGroup('p', { type: 'terminal', id })
    get().reorderCenterTabs('p', 0, 3)
    expect(get().projectCenterTabs.p.tabs.map(t => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('migrates legacy groups without losing tabs or leaving ghosts', () => {
    const { get } = createTestSlice()
    get().addTabToGroup('p', { type: 'git', id: 'git' })
    const groupId = Object.keys(get().projectGroups.p)[0]
    const legacy = { ...get(), projectGroups: { p: { [groupId]: { id: groupId, tabs: [{ type: 'terminal' as const, id: 't1' }, { type: 'git' as const, id: 'git' }, { type: 'editor' as const, id: '/x' }], activeTabId: '/x' } } } }
    Object.assign(get(), legacy)
    get().normalizeWorkspaceTabs('p')
    expect(get().projectCenterTabs.p.tabs.map(t => t.id)).toEqual(['t1', '/x'])
    expect(get().projectGroups.p[groupId]).toEqual({ id: groupId, tabs: [{ type: 'git', id: 'git' }], activeTabId: 'git' })
  })
})
