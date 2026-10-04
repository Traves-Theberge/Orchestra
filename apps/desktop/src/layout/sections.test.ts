import { describe, it, expect } from 'vitest'
import { isSectionID, getSectionVisibility, sidebarItems } from './sections'

describe('sections', () => {
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
