// Spellcheck wiring for the main process: Chromium's built-in spellchecker, a
// renderer-drawn context menu for editable fields, and a native fallback menu.
//
// Custom words: session.addWordToSpellCheckerDictionary persists on its own
// (Chromium writes "Custom Dictionary.txt" under userData; verified on Windows
// with Electron 41), so we do not mirror them. "Ignore" is session-only: those
// words are added to the dictionary for now, recorded in spellcheck.json, and
// removed again on quit or, after a crash, on the next start.

const path = require('node:path')
const fs = require('node:fs/promises')

const FALLBACK_LANGUAGE = 'en-US'
const MAX_SUGGESTIONS = 5
const MAX_WORD_LENGTH = 100
const SETTINGS_FILE = 'spellcheck.json'

const CHANNELS = Object.freeze({
  menu: 'orchestra:spell:context-menu',
  subscribe: 'orchestra:spell:subscribe',
  replace: 'orchestra:spell:replace',
  addWord: 'orchestra:spell:add-word',
  ignoreWord: 'orchestra:spell:ignore-word',
  getSettings: 'orchestra:spell:get-settings',
  setLanguages: 'orchestra:spell:set-languages',
  edit: 'orchestra:spell:edit',
})

const EDIT_ACTIONS = ['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']

function normalizeWord(value) {
  if (typeof value !== 'string') return ''
  const word = value.trim()
  if (!word || word.length > MAX_WORD_LENGTH || /\s/.test(word)) return ''
  return word
}

/** Pick spellchecker languages: the saved choice if still valid, else the OS locale, else en-US. */
function resolveLanguages({ saved, systemLanguages, available }) {
  const list = Array.isArray(available) ? available : []
  if (list.length === 0) return []
  const byLower = new Map(list.map(code => [code.toLowerCase(), code]))
  const match = (code) => {
    if (typeof code !== 'string' || !code) return null
    const lower = code.replace('_', '-').toLowerCase()
    if (byLower.has(lower)) return byLower.get(lower)
    const base = lower.split('-')[0]
    if (byLower.has(base)) return byLower.get(base)
    // Same language, other region: prefer the canonical variant (en-US, fr-FR, de-DE).
    const canonical = FALLBACK_LANGUAGE.toLowerCase().startsWith(`${base}-`) ? FALLBACK_LANGUAGE.toLowerCase() : `${base}-${base}`
    if (byLower.has(canonical)) return byLower.get(canonical)
    return list.find(candidate => candidate.toLowerCase().split('-')[0] === base) ?? null
  }

  if (Array.isArray(saved)) {
    const kept = [...new Set(saved.map(code => byLower.get(String(code).toLowerCase())).filter(Boolean))]
    if (kept.length > 0) return kept
  }
  for (const code of Array.isArray(systemLanguages) ? systemLanguages : []) {
    const found = match(code)
    if (found) return [found]
  }
  const fallback = match(FALLBACK_LANGUAGE)
  return fallback ? [fallback] : [list[0]]
}

/** The typed payload the renderer receives; null when the target is not editable. */
function buildMenuPayload(params) {
  if (!params || !params.isEditable) return null
  const flags = params.editFlags ?? {}
  return {
    x: Math.round(Number(params.x) || 0),
    y: Math.round(Number(params.y) || 0),
    misspelledWord: typeof params.misspelledWord === 'string' ? params.misspelledWord : '',
    dictionarySuggestions: Array.isArray(params.dictionarySuggestions)
      ? params.dictionarySuggestions.filter(s => typeof s === 'string' && s).slice(0, MAX_SUGGESTIONS)
      : [],
    selectionText: typeof params.selectionText === 'string' ? params.selectionText : '',
    editFlags: {
      canCut: Boolean(flags.canCut),
      canCopy: Boolean(flags.canCopy),
      canPaste: Boolean(flags.canPaste),
      canSelectAll: Boolean(flags.canSelectAll),
      canUndo: Boolean(flags.canUndo),
      canRedo: Boolean(flags.canRedo),
    },
  }
}

/** Native menu template used when no renderer handler is subscribed. */
function buildFallbackTemplate(payload, { onReplace, onAddWord }) {
  const template = []
  if (payload.misspelledWord) {
    for (const suggestion of payload.dictionarySuggestions) {
      template.push({ label: suggestion, click: () => onReplace(suggestion) })
    }
    if (payload.dictionarySuggestions.length === 0) template.push({ label: 'No suggestions', enabled: false })
    template.push({ label: 'Add to dictionary', click: () => onAddWord(payload.misspelledWord) })
    template.push({ type: 'separator' })
  }
  template.push(
    { role: 'cut', enabled: payload.editFlags.canCut },
    { role: 'copy', enabled: payload.editFlags.canCopy },
    { role: 'paste', enabled: payload.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: payload.editFlags.canSelectAll },
  )
  return template
}

function createSettingsStore(filePath, fsImpl = fs) {
  return {
    async read() {
      try {
        const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'))
        return {
          languages: Array.isArray(parsed?.languages) ? parsed.languages.filter(l => typeof l === 'string') : null,
          ignoredWords: Array.isArray(parsed?.ignoredWords) ? parsed.ignoredWords.filter(w => typeof w === 'string') : [],
        }
      } catch {
        return { languages: null, ignoredWords: [] }
      }
    },
    async write(state) {
      await fsImpl.mkdir(path.dirname(filePath), { recursive: true })
      await fsImpl.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')
    },
  }
}

/**
 * Wire spellcheck for the app. Call once after app ready, before windows open.
 * Returns { attach(webContents), shutdown() }.
 */
async function setupSpellcheck({ app, session, ipcMain, Menu, store, platform = process.platform }) {
  const supportsLanguages = platform !== 'darwin' // macOS uses the OS checker; language APIs are no-ops
  const subscribers = new Map() // webContents id -> active renderer handlers
  const state = await store.read()
  let savedLanguages = state.languages
  const ignored = new Set()

  // Clear words a previous session ignored but never got to remove (crash, kill).
  for (const word of state.ignoredWords) session.removeWordFromSpellCheckerDictionary(word)

  session.setSpellCheckerEnabled(true)
  const available = () => (supportsLanguages ? [...session.availableSpellCheckerLanguages] : [])
  if (supportsLanguages) {
    const languages = resolveLanguages({ saved: savedLanguages, systemLanguages: app.getPreferredSystemLanguages?.() ?? [app.getLocale()], available: available() })
    if (languages.length > 0) {
      try { session.setSpellCheckerLanguages(languages) } catch (error) { console.error('spellcheck: setSpellCheckerLanguages failed', error) }
    }
  }

  const persist = () => store.write({ languages: savedLanguages, ignoredWords: [...ignored] }).catch(error => {
    console.error('spellcheck: failed to save settings', error)
  })
  if (state.ignoredWords.length > 0) void persist()

  const settings = () => ({
    supportsLanguages,
    languages: supportsLanguages ? session.getSpellCheckerLanguages() : [],
    availableLanguages: available(),
  })
  const addWord = (word) => {
    const clean = normalizeWord(word)
    if (!clean) return false
    if (ignored.delete(clean)) void persist()
    return session.addWordToSpellCheckerDictionary(clean)
  }
  const ignoreWord = (word) => {
    const clean = normalizeWord(word)
    if (!clean || ignored.has(clean)) return Boolean(clean)
    ignored.add(clean)
    void persist()
    return session.addWordToSpellCheckerDictionary(clean)
  }

  ipcMain.on(CHANNELS.subscribe, (event, active) => {
    const id = event.sender.id
    const next = Math.max(0, (subscribers.get(id) ?? 0) + (active ? 1 : -1))
    if (next === 0) subscribers.delete(id)
    else subscribers.set(id, next)
  })
  ipcMain.handle(CHANNELS.replace, (event, word) => {
    if (typeof word !== 'string' || !word) return false
    event.sender.replaceMisspelling(word)
    return true
  })
  ipcMain.handle(CHANNELS.addWord, (_event, word) => addWord(word))
  ipcMain.handle(CHANNELS.ignoreWord, (_event, word) => ignoreWord(word))
  ipcMain.handle(CHANNELS.getSettings, () => settings())
  ipcMain.handle(CHANNELS.setLanguages, (_event, languages) => {
    if (!supportsLanguages) return settings()
    const list = available()
    const valid = Array.isArray(languages) ? [...new Set(languages.filter(code => list.includes(code)))] : []
    if (valid.length === 0) throw new Error('choose at least one available language')
    session.setSpellCheckerLanguages(valid)
    savedLanguages = valid
    void persist()
    return settings()
  })
  ipcMain.handle(CHANNELS.edit, (event, action) => {
    if (!EDIT_ACTIONS.includes(action)) throw new Error(`unknown edit action: ${action}`)
    event.sender[action]()
    return true
  })

  function attach(webContents, getWindow) {
    const id = webContents.id
    webContents.on('destroyed', () => subscribers.delete(id))
    // A reload or crash drops renderer handlers without unsubscribing.
    webContents.on('render-process-gone', () => subscribers.delete(id))
    webContents.on('did-start-navigation', (details) => {
      if (details?.isMainFrame && !details.isSameDocument) subscribers.delete(id)
    })
    // Electron only emits this when the page did not preventDefault the DOM
    // contextmenu event, so Radix context menus keep working untouched.
    webContents.on('context-menu', (_event, params) => {
      const payload = buildMenuPayload(params)
      if (!payload) return // non-editable: keep the default (no native menu)
      if ((subscribers.get(id) ?? 0) > 0) {
        webContents.send(CHANNELS.menu, payload)
        return
      }
      const menu = Menu.buildFromTemplate(buildFallbackTemplate(payload, {
        onReplace: (word) => webContents.replaceMisspelling(word),
        onAddWord: addWord,
      }))
      menu.popup({ window: getWindow?.() ?? undefined })
    })
  }

  function shutdown() {
    for (const word of ignored) session.removeWordFromSpellCheckerDictionary(word)
    ignored.clear()
    return persist()
  }

  return { attach, shutdown, settings }
}

function createSpellcheckStore(userDataDir) {
  return createSettingsStore(path.join(userDataDir, SETTINGS_FILE))
}

module.exports = {
  CHANNELS,
  EDIT_ACTIONS,
  MAX_SUGGESTIONS,
  buildFallbackTemplate,
  buildMenuPayload,
  createSettingsStore,
  createSpellcheckStore,
  normalizeWord,
  resolveLanguages,
  setupSpellcheck,
}
