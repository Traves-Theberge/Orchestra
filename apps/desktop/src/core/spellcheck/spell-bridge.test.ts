import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampMenuPosition, getSpellBridge, languageLabel, sortLanguages } from './spell-bridge'

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 300 }

describe('clampMenuPosition', () => {
  it('opens at the click point when it fits', () => {
    expect(clampMenuPosition({ x: 100, y: 120 }, size, viewport)).toEqual({ left: 100, top: 120 })
  })

  it('flips left and up near the right and bottom edges', () => {
    expect(clampMenuPosition({ x: 950, y: 700 }, size, viewport)).toEqual({ left: 750, top: 400 })
  })

  it('stays inside the margin when the panel cannot fit either side', () => {
    expect(clampMenuPosition({ x: 150, y: 150 }, { width: 200, height: 790 }, viewport)).toEqual({ left: 150, top: 8 })
    expect(clampMenuPosition({ x: -20, y: -5 }, size, viewport)).toEqual({ left: 8, top: 8 })
  })

  it('pins to the margin when the viewport is smaller than the panel', () => {
    expect(clampMenuPosition({ x: 50, y: 50 }, { width: 400, height: 400 }, { width: 300, height: 300 })).toEqual({ left: 8, top: 8 })
  })
})

describe('getSpellBridge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null in browser mode', () => {
    vi.stubGlobal('orchestraDesktop', undefined)
    expect(getSpellBridge()).toBeNull()
  })

  it('returns null when the preload predates spellcheck', () => {
    vi.stubGlobal('orchestraDesktop', { onChatZoom: () => () => {} })
    expect(getSpellBridge()).toBeNull()
  })

  it('maps the preload API', async () => {
    const replaceMisspelling = vi.fn(async () => true)
    const fn = vi.fn(async () => true)
    vi.stubGlobal('orchestraDesktop', {
      onSpellContextMenu: () => () => {}, replaceMisspelling, addToDictionary: fn, ignoreWord: fn,
      getSpellSettings: fn, setSpellLanguages: fn, editAction: fn,
    })
    await getSpellBridge()?.replaceMisspelling('the')
    expect(replaceMisspelling).toHaveBeenCalledWith('the')
  })
})

describe('languages', () => {
  it('labels codes and falls back to the raw code', () => {
    expect(languageLabel('en-GB')).toMatch(/English/)
    expect(languageLabel('not a code')).toBe('not a code')
  })

  it('sorts active languages first, then by label', () => {
    expect(sortLanguages(['fr', 'de', 'en-US', 'es'], ['es'])).toEqual(['es', 'en-US', 'fr', 'de']) // Spanish; English, French, German
  })
})
