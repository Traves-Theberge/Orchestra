import { expect, it } from 'vitest'
import { rewindErrorText } from './rewind-controller'

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })

it('says the conversation did not change only for a rewind, not for Undo restore', () => {
  const partial = failure('restore_partial', 'Files could not be restored: a.ts (locked).')
  expect(rewindErrorText(partial)).toBe('Files could not be restored: a.ts (locked). Nothing in the conversation was changed.')
  expect(rewindErrorText(partial, false)).toBe('Files could not be restored: a.ts (locked).')
})

it('treats an abort or a gateway timeout as a timeout', () => {
  const text = 'The request timed out. Check the conversation before retrying; the server may still finish.'
  expect(rewindErrorText(new DOMException('aborted', 'AbortError'))).toBe(text)
  expect(rewindErrorText(failure('request_failed', '504 Gateway Timeout'))).toBe(text)
  expect(rewindErrorText(failure('request_failed', '500 boom'))).toBe('500 boom')
})
