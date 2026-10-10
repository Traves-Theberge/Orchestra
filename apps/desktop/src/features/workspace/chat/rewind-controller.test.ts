import { expect, it } from 'vitest'
import { restoredFilesText, rewindErrorText } from './rewind-controller'

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })

it('says the conversation did not change only for a rewind, not for Undo restore', () => {
  const partial = failure('restore_partial', 'Files could not be restored: a.ts (locked).')
  expect(rewindErrorText(partial)).toBe('Files could not be restored: a.ts (locked). Nothing in the conversation was changed.')
  expect(rewindErrorText(partial, 'undo')).toBe('Files could not be restored: a.ts (locked).')
})

it('treats an abort or a gateway timeout as a timeout', () => {
  const text = 'The request timed out. Check the conversation before retrying; the server may still finish.'
  expect(rewindErrorText(new DOMException('aborted', 'AbortError'))).toBe(text)
  expect(rewindErrorText(failure('request_failed', '504 Gateway Timeout'))).toBe(text)
  expect(rewindErrorText(failure('request_failed', '500 boom'))).toBe('500 boom')
})

it('shows the backend text when there is nothing to undo, and the dialog advice for a rewind', () => {
  const empty = failure('checkpoint_unavailable', 'There is nothing to undo.')
  expect(rewindErrorText(empty, 'undo')).toBe('There is nothing to undo.')
  expect(rewindErrorText(empty)).toBe('There is no file checkpoint for that message. Choose Conversation only.')
})

it('words the Undo banner per kind of rewind', () => {
  expect(restoredFilesText('edit')).toBe('Files were restored to before that message.')
  expect(restoredFilesText('regenerate')).toBe('Files were restored to before that message.')
  expect(restoredFilesText('switch')).toBe('Files were restored to that version.')
})
