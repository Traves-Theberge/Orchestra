import { describe, it, expect } from 'vitest'
import { isSectionID, getSectionVisibility, sidebarItems } from './sections'

describe('sections', () => {
  it('places Orchestrator above Projects while restoring legacy Development navigation to its workspace', () => {
    expect(sidebarItems.slice(0, 2).map(item => item.id)).toEqual(['ORCHESTRATOR', 'PROJECTS'])
    expect(sidebarItems.some(item => item.id === 'CONSOLE')).toBe(false)
    expect(getSectionVisibility('PROJECTS').showConsole).toBe(true)
    expect(getSectionVisibility('CONSOLE').showConsole).toBe(true)
    expect(getSectionVisibility('ORCHESTRATOR').showOrchestrator).toBe(true)
  })
  it('STUDIO is not a valid SectionID', () => {
    expect(isSectionID('STUDIO')).toBe(false)
  })

  it('opens the API reference as an internal section', () => {
    expect(isSectionID('API_DOCS')).toBe(true)
    expect(getSectionVisibility('API_DOCS').showApiDocs).toBe(true)
    expect(getSectionVisibility('API_DOCS').showDocs).toBe(false)
  })

  it('sidebarItems does not contain STUDIO', () => {
    expect(sidebarItems.find(i => i.id === 'STUDIO')).toBeUndefined()
  })

  it('getSectionVisibility does not have showStudio', () => {
    const vis = getSectionVisibility('CONSOLE')
    expect('showStudio' in vis).toBe(false)
  })

  it('sidebarItems does not contain WAREHOUSE', () => {
    expect(sidebarItems.find(i => i.id === 'WAREHOUSE')).toBeUndefined()
  })
})
