import { describe, it, expect } from 'vitest'
import { isSectionID, getSectionVisibility, sidebarItems } from './sections'
import { useAppStore } from '@core/store'

describe('sections', () => {
  it('registers Diagnostics as a dedicated section', () => {
    expect(isSectionID('DIAGNOSTICS')).toBe(true)
    expect(sidebarItems.find(item => item.id === 'DIAGNOSTICS')?.label).toBe('Diagnostics')
    expect(getSectionVisibility('DIAGNOSTICS').showDiagnostics).toBe(true)
    expect(getSectionVisibility('ISSUES').showDiagnostics).toBe(false)
  })
  it('routes Diagnostics through the existing navigation store and returns to Tasks', () => {
    const previous = useAppStore.getState().activeSection
    try {
      useAppStore.getState().setActiveSection('DIAGNOSTICS')
      expect(getSectionVisibility(useAppStore.getState().activeSection).showDiagnostics).toBe(true)
      useAppStore.getState().setActiveSection('ISSUES')
      expect(getSectionVisibility(useAppStore.getState().activeSection).showIssueBoard).toBe(true)
    } finally { useAppStore.getState().setActiveSection(previous) }
  })
  it('places Orchestrator above Projects while restoring legacy Development navigation to its workspace', () => {
    expect(sidebarItems.slice(0, 2).map(item => item.id)).toEqual(['ORCHESTRATOR', 'PROJECTS'])
    expect(sidebarItems.some(item => item.id === 'CONSOLE')).toBe(false)
    expect(getSectionVisibility('PROJECTS').showConsole).toBe(true)
    expect(getSectionVisibility('CONSOLE').showConsole).toBe(true)
    expect(getSectionVisibility('ORCHESTRATOR').showOrchestrator).toBe(true)
  })
  it('places Automations between Tasks and Agents', () => {
    const ids = sidebarItems.map(item => item.id)
    expect(ids.indexOf('AUTOMATIONS')).toBe(ids.indexOf('ISSUES') + 1)
    expect(ids.indexOf('AGENTS')).toBe(ids.indexOf('AUTOMATIONS') + 1)
    expect(isSectionID('AUTOMATIONS')).toBe(true)
    expect(getSectionVisibility('AUTOMATIONS').showAutomations).toBe(true)
    expect(getSectionVisibility('ISSUES').showAutomations).toBe(false)
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
