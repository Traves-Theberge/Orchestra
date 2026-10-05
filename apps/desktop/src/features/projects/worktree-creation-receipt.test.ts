import { beforeEach, describe, expect, it } from 'vitest'
import { readCreationReceipt, receiptStorageKey, saveCreationReceipt, type WorktreeCreationReceipt } from './worktree-creation-receipt'
const receipt: WorktreeCreationReceipt = { baseUrl: 'http://localhost:4010', projectId: 'project', requestId: 'a88690b1-2396-49b1-9559-53022868003f', sessionId: 'c5062ee9-6af3-4b83-a9a0-6ea1c5a7905f', provider: 'codex', model: 'observed', createMore: false, agentAttempted: true }
beforeEach(() => localStorage.clear())
describe('durable creation receipt', () => {
  it('preserves retry identity but never saves API credentials', () => {
    const key = receiptStorageKey(receipt.baseUrl, receipt.projectId, 'worktree')
    saveCreationReceipt(key, { ...receipt, config: { apiToken: 'secret' }, apiToken: 'secret' } as WorktreeCreationReceipt)
    expect(localStorage.getItem(key)).not.toContain('secret')
    expect(readCreationReceipt(key, receipt.baseUrl, receipt.projectId)).toMatchObject(receipt)
  })
  it('rejects cross-backend, cross-project and malformed restored receipts', () => {
    const key = receiptStorageKey(receipt.baseUrl, receipt.projectId, 'worktree')
    saveCreationReceipt(key, receipt)
    expect(readCreationReceipt(key, 'http://other', receipt.projectId)).toBeNull()
    expect(readCreationReceipt(key, receipt.baseUrl, 'other')).toBeNull()
    localStorage.setItem(key, JSON.stringify({ ...receipt, requestId: 'invalid' }))
    expect(readCreationReceipt(key, receipt.baseUrl, receipt.projectId)).toBeNull()
  })
})
