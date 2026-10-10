/** Spellcheck bridge to the Electron main process (Chromium's built-in checker). */

export type SpellEditFlags = {
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canSelectAll: boolean
  canUndo: boolean
  canRedo: boolean
}

/** Sent by the main process when an editable field is right-clicked. */
export type SpellContextMenuPayload = {
  x: number
  y: number
  misspelledWord: string
  /** At most 5, best first. */
  dictionarySuggestions: string[]
  selectionText: string
  editFlags: SpellEditFlags
}

export type SpellSettings = {
  /** False on macOS, where the OS picks the language. */
  supportsLanguages: boolean
  languages: string[]
  availableLanguages: string[]
}

export type SpellEditAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'

export type SpellBridge = {
  onContextMenu: (callback: (payload: SpellContextMenuPayload) => void) => () => void
  replaceMisspelling: (word: string) => Promise<unknown>
  addToDictionary: (word: string) => Promise<unknown>
  ignoreWord: (word: string) => Promise<unknown>
  getSettings: () => Promise<SpellSettings>
  setLanguages: (languages: string[]) => Promise<SpellSettings>
  edit: (action: SpellEditAction) => Promise<unknown>
}

/** The bridge, or null in browser mode / older preloads. */
export function getSpellBridge(): SpellBridge | null {
  const desktop = typeof window === 'undefined' ? undefined : window.orchestraDesktop
  if (!desktop?.onSpellContextMenu || !desktop.replaceMisspelling || !desktop.addToDictionary || !desktop.ignoreWord
    || !desktop.getSpellSettings || !desktop.setSpellLanguages || !desktop.editAction) return null
  return {
    onContextMenu: desktop.onSpellContextMenu,
    replaceMisspelling: desktop.replaceMisspelling,
    addToDictionary: desktop.addToDictionary,
    ignoreWord: desktop.ignoreWord,
    getSettings: desktop.getSpellSettings,
    setLanguages: desktop.setSpellLanguages,
    edit: desktop.editAction,
  }
}

/** Keep a floating panel of the given size inside the viewport, preferring the click point. */
export function clampMenuPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  // Flip to the other side of the pointer when there is no room, like native menus.
  let left = point.x + size.width + margin > viewport.width ? point.x - size.width : point.x
  let top = point.y + size.height + margin > viewport.height ? point.y - size.height : point.y
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.width - size.width - margin))
  top = Math.min(Math.max(margin, top), Math.max(margin, viewport.height - size.height - margin))
  return { left: Math.round(left), top: Math.round(top) }
}

let displayNames: Intl.DisplayNames | null | undefined

/** "en-GB" -> "English (United Kingdom)"; falls back to the code. */
export function languageLabel(code: string): string {
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(undefined, { type: 'language' }) } catch { displayNames = null }
  }
  try { return displayNames?.of(code) ?? code } catch { return code }
}

/** Active languages first, then alphabetical by label. */
export function sortLanguages(available: string[], active: string[]): string[] {
  const on = new Set(active)
  return [...available].sort((a, b) => Number(on.has(b)) - Number(on.has(a)) || languageLabel(a).localeCompare(languageLabel(b)))
}
