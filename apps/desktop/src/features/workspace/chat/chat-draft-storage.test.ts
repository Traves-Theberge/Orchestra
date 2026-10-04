import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { chatDraftStorageKey, readChatDraftReceipt, writeChatDraftReceipt, type ChatDraftReceipt } from './chat-draft-storage'

const config = { baseUrl: 'http://localhost:4014', apiToken: 'secret-configured-token' }
const receipt: ChatDraftReceipt = {
  version: 1, sessionId: 'pending-chat', provider: 'codex', drafts: { 'pending-chat': 'Retain my draft' },
  creation: { sessionId: 'pending-chat', provider: 'codex' }, submission: null,
  reply: null, blockedRequests: {}, uncertainSession: 'pending-chat',
}
const desktop = () => vi.stubGlobal('orchestraDesktop', {})
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('chat draft storage boundary', () => {
  it('retains desktop drafts and pending identities after tab storage is cleared for an app restart', async () => {
    desktop()
    const key = await chatDraftStorageKey(config, 'project-a')
    expect(writeChatDraftReceipt(key, receipt)).toBe(true)
    expect(sessionStorage.getItem(key)).toBeNull()
    sessionStorage.clear()
    expect(readChatDraftReceipt(key)).toEqual(receipt)
    expect(localStorage.getItem(key)).not.toContain(config.apiToken)
    expect(key).not.toContain(config.apiToken)
    expect(key).not.toContain(config.baseUrl)
    for (const [nextConfig, project] of [[{ ...config, apiToken: 'other' }, 'project-a'], [{ ...config, baseUrl: 'http://localhost:4999' }, 'project-a'], [config, 'project-b']] as const) {
      expect(readChatDraftReceipt(await chatDraftStorageKey(nextConfig, project))).toBeNull()
    }
  })
  it('migrates the current tab receipt to the desktop profile before discarding its old copy', async () => {
    const key = await chatDraftStorageKey(config, 'project-a')
    expect(writeChatDraftReceipt(key, receipt)).toBe(true)
    expect(localStorage.getItem(key)).toBeNull()
    desktop()
    expect(readChatDraftReceipt(key)).toEqual(receipt)
    expect(localStorage.getItem(key)).toContain('Retain my draft')
    expect(sessionStorage.getItem(key)).toBeNull()
    const newer = { ...receipt, drafts: { 'pending-chat': 'Newer correction' } }
    expect(writeChatDraftReceipt(key, newer)).toBe(true)
    expect(readChatDraftReceipt(key)).toEqual(newer)
  })
  it('keeps browser drafts tab scoped', async () => {
    const key = await chatDraftStorageKey(config, 'project-a')
    writeChatDraftReceipt(key, receipt)
    expect(localStorage.getItem(key)).toBeNull()
    sessionStorage.clear()
    expect(readChatDraftReceipt(key)).toBeNull()
  })
  it('retains the old tab receipt when desktop migration fails and reports failed writes', async () => {
    const key = await chatDraftStorageKey(config, 'project-a')
    writeChatDraftReceipt(key, receipt)
    desktop()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
      if (this === localStorage) throw new Error('Profile storage unavailable')
      original.call(this, name, value)
    })
    expect(readChatDraftReceipt(key)).toEqual(receipt)
    expect(sessionStorage.getItem(key)).toContain('Retain my draft')
    expect(writeChatDraftReceipt(key, receipt)).toBe(false)
  })
})
