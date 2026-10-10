const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { tmpdir } = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  CHANNELS, buildFallbackTemplate, buildMenuPayload, createSettingsStore, normalizeWord, resolveLanguages, setupSpellcheck,
} = require('./spellcheck.cjs')

const AVAILABLE = ['de-DE', 'en-AU', 'en-GB', 'en-US', 'fr', 'pt-BR']

test('resolveLanguages prefers a saved choice, then the OS locale, then en-US', () => {
  assert.deepEqual(resolveLanguages({ saved: ['fr', 'de-DE'], systemLanguages: ['en-GB'], available: AVAILABLE }), ['fr', 'de-DE'])
  assert.deepEqual(resolveLanguages({ saved: ['xx-YY'], systemLanguages: ['en-GB'], available: AVAILABLE }), ['en-GB'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['fr-CA'], available: AVAILABLE }), ['fr'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['en-CA'], available: AVAILABLE }), ['en-US'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['pt_br'], available: AVAILABLE }), ['pt-BR'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['de-AT'], available: AVAILABLE }), ['de-DE'])
  assert.deepEqual(resolveLanguages({ saved: [], systemLanguages: ['ja-JP'], available: AVAILABLE }), ['en-US'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['ja-JP'], available: ['nl', 'sv'] }), ['nl'])
  assert.deepEqual(resolveLanguages({ saved: null, systemLanguages: ['en-US'], available: [] }), [])
})

test('buildMenuPayload ignores non-editable targets and caps suggestions', () => {
  assert.equal(buildMenuPayload({ isEditable: false, x: 1, y: 2 }), null)
  const payload = buildMenuPayload({
    isEditable: true, x: 10.6, y: 20.2, misspelledWord: 'teh', selectionText: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea', 'tech', 'tee', 'tel', ''],
    editFlags: { canCut: true, canCopy: 1, canPaste: false, canSelectAll: true },
  })
  assert.deepEqual(payload, {
    x: 11, y: 20, misspelledWord: 'teh', selectionText: 'teh',
    dictionarySuggestions: ['the', 'ten', 'tea', 'tech', 'tee'],
    editFlags: { canCut: true, canCopy: true, canPaste: false, canSelectAll: true, canUndo: false, canRedo: false },
  })
})

test('normalizeWord rejects blanks, phrases and oversized input', () => {
  assert.equal(normalizeWord(' Orchestra '), 'Orchestra')
  assert.equal(normalizeWord('two words'), '')
  assert.equal(normalizeWord(''), '')
  assert.equal(normalizeWord(42), '')
  assert.equal(normalizeWord('a'.repeat(101)), '')
})

test('fallback template offers suggestions only for a misspelling', () => {
  const replaced = []
  const base = { dictionarySuggestions: ['the'], editFlags: { canCut: false, canCopy: true, canPaste: true, canSelectAll: true } }
  const withWord = buildFallbackTemplate({ ...base, misspelledWord: 'teh' }, { onReplace: w => replaced.push(w), onAddWord: () => {} })
  assert.equal(withWord[0].label, 'the')
  withWord[0].click()
  assert.deepEqual(replaced, ['the'])
  assert.equal(withWord.find(item => item.role === 'cut').enabled, false)
  const plain = buildFallbackTemplate({ ...base, misspelledWord: '' }, { onReplace: () => {}, onAddWord: () => {} })
  assert.equal(plain[0].role, 'cut')
})

test('settings store round-trips and tolerates a missing or corrupt file', async () => {
  const file = path.join(tmpdir(), `orchestra-spell-${crypto.randomUUID()}`, 'spellcheck.json')
  const store = createSettingsStore(file)
  assert.deepEqual(await store.read(), { languages: null, ignoredWords: [] })
  await store.write({ languages: ['en-GB'], ignoredWords: ['foo'] })
  assert.deepEqual(await store.read(), { languages: ['en-GB'], ignoredWords: ['foo'] })
  const corrupt = createSettingsStore(file, { readFile: async () => '{not json' })
  assert.deepEqual(await corrupt.read(), { languages: null, ignoredWords: [] })
})

function fakeEnvironment({ stored = { languages: null, ignoredWords: [] }, platform = 'win32' } = {}) {
  const words = new Set()
  const session = {
    enabled: false, languages: ['en-US'], availableSpellCheckerLanguages: AVAILABLE,
    setSpellCheckerEnabled(v) { this.enabled = v },
    setSpellCheckerLanguages(l) { this.languages = [...l] },
    getSpellCheckerLanguages() { return [...this.languages] },
    addWordToSpellCheckerDictionary(w) { words.add(w); return true },
    removeWordFromSpellCheckerDictionary(w) { return words.delete(w) },
  }
  const handlers = new Map()
  const listeners = new Map()
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
  }
  const popups = []
  const Menu = { buildFromTemplate: (template) => ({ template, popup: () => popups.push(template) }) }
  const writes = []
  const store = { read: async () => stored, write: async (state) => { writes.push(state) } }
  const app = { getPreferredSystemLanguages: () => ['en-GB'], getLocale: () => 'en-US' }
  return { session, handlers, listeners, ipcMain, Menu, popups, writes, store, app, words, platform }
}

function fakeWebContents(id = 1) {
  const wc = new EventEmitter()
  Object.assign(wc, { id, sent: [], replaced: [], edits: [] })
  wc.send = (channel, payload) => wc.sent.push({ channel, payload })
  wc.replaceMisspelling = (word) => wc.replaced.push(word)
  for (const action of ['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']) wc[action] = () => wc.edits.push(action)
  return wc
}

test('setup enables spellcheck, applies the OS language and clears stale ignored words', async () => {
  const env = fakeEnvironment({ stored: { languages: null, ignoredWords: ['stale'] } })
  env.words.add('stale')
  await setupSpellcheck(env)
  assert.equal(env.session.enabled, true)
  assert.deepEqual(env.session.languages, ['en-GB'])
  assert.equal(env.words.has('stale'), false)
  assert.deepEqual(env.writes.at(-1), { languages: null, ignoredWords: [] })
})

test('editable context menu goes to a subscribed renderer, otherwise to a native popup', async () => {
  const env = fakeEnvironment()
  const spell = await setupSpellcheck(env)
  const wc = fakeWebContents(7)
  spell.attach(wc)
  const params = { isEditable: true, x: 5, y: 6, misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: {} }

  wc.emit('context-menu', {}, params)
  assert.equal(env.popups.length, 1)
  assert.equal(wc.sent.length, 0)

  env.listeners.get(CHANNELS.subscribe)({ sender: wc }, true)
  wc.emit('context-menu', {}, params)
  assert.equal(env.popups.length, 1)
  assert.equal(wc.sent[0].channel, CHANNELS.menu)
  assert.deepEqual(wc.sent[0].payload.dictionarySuggestions, ['the'])

  wc.emit('context-menu', {}, { isEditable: false })
  assert.equal(env.popups.length, 1)
  assert.equal(wc.sent.length, 1)

  env.listeners.get(CHANNELS.subscribe)({ sender: wc }, false)
  wc.emit('context-menu', {}, params)
  assert.equal(env.popups.length, 2)

  // A reload drops the renderer handler without an unsubscribe message.
  env.listeners.get(CHANNELS.subscribe)({ sender: wc }, true)
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  wc.emit('context-menu', {}, params)
  assert.equal(env.popups.length, 2)
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  wc.emit('context-menu', {}, params)
  assert.equal(env.popups.length, 3)
})

test('ipc handlers replace, add, ignore, edit and validate languages', async () => {
  const env = fakeEnvironment()
  const spell = await setupSpellcheck(env)
  const wc = fakeWebContents()
  const event = { sender: wc }
  await env.handlers.get(CHANNELS.replace)(event, 'the')
  assert.deepEqual(wc.replaced, ['the'])
  assert.equal(await env.handlers.get(CHANNELS.addWord)(event, 'Orchestra'), true)
  assert.equal(await env.handlers.get(CHANNELS.addWord)(event, 'not a word'), false)
  await env.handlers.get(CHANNELS.ignoreWord)(event, 'zzyzx')
  assert.ok(env.words.has('zzyzx'))
  assert.deepEqual(env.writes.at(-1).ignoredWords, ['zzyzx'])
  await env.handlers.get(CHANNELS.edit)(event, 'paste')
  assert.deepEqual(wc.edits, ['paste'])
  assert.throws(() => env.handlers.get(CHANNELS.edit)(event, 'close'))

  const next = await env.handlers.get(CHANNELS.setLanguages)(event, ['fr', 'xx', 'fr'])
  assert.deepEqual(next.languages, ['fr'])
  assert.deepEqual(env.writes.at(-1).languages, ['fr'])
  assert.throws(() => env.handlers.get(CHANNELS.setLanguages)(event, ['xx']))

  await spell.shutdown()
  assert.equal(env.words.has('zzyzx'), false)
  assert.ok(env.words.has('Orchestra'))
  assert.deepEqual(env.writes.at(-1).ignoredWords, [])
})

test('macOS reports no language control and leaves languages to the OS', async () => {
  const env = fakeEnvironment({ platform: 'darwin' })
  const spell = await setupSpellcheck(env)
  assert.deepEqual(spell.settings(), { supportsLanguages: false, languages: [], availableLanguages: [] })
  assert.deepEqual(env.session.languages, ['en-US'])
})
