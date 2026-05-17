import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createUISlice } from './ui.slice'
import type { AppState } from '../types'

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
  const slice = createUISlice(set as any, get, api)
  state = { ...state, ...slice }
  return { get: () => state, state: slice }
}

// ---------------------------------------------------------------------------
// Mocks — silence localStorage / matchMedia / document in JSDOM
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset localStorage
  localStorage.clear()
  // Reset document dark class
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UISlice — default initialization', () => {
  it('initializes activeSection to CONSOLE', () => {
    const { state } = createTestSlice()
    expect(state.activeSection).toBe('CONSOLE')
  })

  it('initializes sidebarCollapsed to false', () => {
    const { state } = createTestSlice()
    expect(state.sidebarCollapsed).toBe(false)
  })

  it('initializes paletteOpen to false', () => {
    const { state } = createTestSlice()
    expect(state.paletteOpen).toBe(false)
  })

  it('initializes all dialog booleans to false', () => {
    const { state } = createTestSlice()
    expect(state.inspectDialogOpen).toBe(false)
    expect(state.sessionInspectDialogOpen).toBe(false)
    expect(state.createTaskDialogOpen).toBe(false)
    expect(state.createProjectDialogOpen).toBe(false)
  })

  it('initializes createTaskInitialState to null', () => {
    const { state } = createTestSlice()
    expect(state.createTaskInitialState).toBeNull()
  })

  it('initializes settingsInitialTab to undefined', () => {
    const { state } = createTestSlice()
    expect(state.settingsInitialTab).toBeUndefined()
  })

  it('initializes activePeriod to Week', () => {
    const { state } = createTestSlice()
    expect(state.activePeriod).toBe('Week')
  })

  it('falls back to dark theme when no localStorage value', () => {
    const { state } = createTestSlice()
    expect(state.theme).toBe('dark')
  })

  it('reads theme from localStorage when set to light', () => {
    localStorage.setItem('orchestra-theme', 'light')
    const { state } = createTestSlice()
    expect(state.theme).toBe('light')
  })

  it('reads theme from localStorage when set to dark', () => {
    localStorage.setItem('orchestra-theme', 'dark')
    const { state } = createTestSlice()
    expect(state.theme).toBe('dark')
  })
})

describe('UISlice — setActiveSection', () => {
  it('changes active section', () => {
    const { get, state } = createTestSlice()
    state.setActiveSection('AGENTS')
    expect(get().activeSection).toBe('AGENTS')
  })

  it('changes to SETTINGS', () => {
    const { get, state } = createTestSlice()
    state.setActiveSection('SETTINGS')
    expect(get().activeSection).toBe('SETTINGS')
  })
})

describe('UISlice — toggleSidebar', () => {
  it('flips sidebarCollapsed from false to true', () => {
    const { get, state } = createTestSlice()
    expect(get().sidebarCollapsed).toBe(false)
    state.toggleSidebar()
    expect(get().sidebarCollapsed).toBe(true)
  })

  it('flips sidebarCollapsed back to false', () => {
    const { get, state } = createTestSlice()
    state.toggleSidebar()
    state.toggleSidebar()
    expect(get().sidebarCollapsed).toBe(false)
  })
})

describe('UISlice — togglePalette', () => {
  it('flips paletteOpen from false to true', () => {
    const { get, state } = createTestSlice()
    expect(get().paletteOpen).toBe(false)
    state.togglePalette()
    expect(get().paletteOpen).toBe(true)
  })

  it('flips paletteOpen back to false', () => {
    const { get, state } = createTestSlice()
    state.togglePalette()
    state.togglePalette()
    expect(get().paletteOpen).toBe(false)
  })
})

describe('UISlice — openCreateTaskDialog', () => {
  it('sets createTaskDialogOpen to true', () => {
    const { get, state } = createTestSlice()
    state.openCreateTaskDialog()
    expect(get().createTaskDialogOpen).toBe(true)
  })

  it('sets createTaskInitialState to null when called without argument', () => {
    const { get, state } = createTestSlice()
    state.openCreateTaskDialog()
    expect(get().createTaskInitialState).toBeNull()
  })

  it('sets createTaskInitialState to the provided object', () => {
    const { get, state } = createTestSlice()
    const init = { state: 'Todo' }
    state.openCreateTaskDialog(init)
    expect(get().createTaskInitialState).toEqual(init)
  })
})

describe('UISlice — closeCreateTaskDialog', () => {
  it('resets createTaskDialogOpen to false', () => {
    const { get, state } = createTestSlice()
    state.openCreateTaskDialog({ state: 'Todo' })
    state.closeCreateTaskDialog()
    expect(get().createTaskDialogOpen).toBe(false)
  })

  it('resets createTaskInitialState to null', () => {
    const { get, state } = createTestSlice()
    state.openCreateTaskDialog({ state: 'Todo' })
    state.closeCreateTaskDialog()
    expect(get().createTaskInitialState).toBeNull()
  })
})

describe('UISlice — setTheme', () => {
  it('updates theme to light', () => {
    const { get, state } = createTestSlice()
    state.setTheme('light')
    expect(get().theme).toBe('light')
  })

  it('updates theme to dark', () => {
    const { get, state } = createTestSlice()
    state.setTheme('light')
    state.setTheme('dark')
    expect(get().theme).toBe('dark')
  })

  it('persists theme to localStorage', () => {
    const { state } = createTestSlice()
    state.setTheme('light')
    expect(localStorage.getItem('orchestra-theme')).toBe('light')
  })

  it('adds dark class when theme is dark', () => {
    const { state } = createTestSlice()
    state.setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes dark class when theme is light', () => {
    const { state } = createTestSlice()
    state.setTheme('dark')
    state.setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
