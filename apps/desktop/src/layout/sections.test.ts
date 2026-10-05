import { describe, it, expect } from 'vitest'
import { isSectionID, getSectionVisibility, sidebarItems } from './sections'

describe('sections', () => {
  it('keeps one Projects entry first while restoring legacy Development navigation to its workspace', () => {
    expect(sidebarItems[0].id).toBe('PROJECTS')
    expect(sidebarItems.some(item => item.id === 'CONSOLE')).toBe(false)
    expect(getSectionVisibility('PROJECTS').showConsole).toBe(true)
    expect(getSectionVisibility('CONSOLE').showConsole).toBe(true)
    expect(getSectionVisibility('ORCHESTRATOR').showOrchestrator).toBe(true)
  })
  it('STUDIO is not a valid SectionID', () => {
    expect(isSectionID('STUDIO')).toBe(false)
  })

  it('sidebarItems does not contain STUDIO', () => {
    expect(sidebarItems.find(i => i.id === 'STUDIO')).toBeUndefined()
  })

  it('getSectionVisibility does not have showStudio', () => {
    const vis = getSectionVisibility('CONSOLE')
    expect('showStudio' in vis).toBe(false)
  })
})
