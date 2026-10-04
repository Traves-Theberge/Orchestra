import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkReadiness, validateReport } from './release-readiness.mjs'

const revision = 'test-revision'
const passed = () => ({ overall_status: 'passed', source_revision: revision, generated_at: new Date().toISOString(), summary: { passed: 1, failed: 0, skipped: 0, failed_workflow_gates: 0, marker_failures: 0 } })

test('requires explicit, fresh passing evidence for the current revision', () => {
  assert.doesNotThrow(() => validateReport(passed(), revision))
  for (const patch of [
    { overall_status: 'failed' }, { source_revision: 'old' }, { generated_at: 'invalid' },
    { generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
    { summary: {} }, { summary: { ...passed().summary, skipped: 1 } },
    { summary: { ...passed().summary, passed: 0 } },
  ]) assert.throws(() => validateReport({ ...passed(), ...patch }, revision))
})

test('missing, empty and malformed reports cannot pass', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orchestra-readiness-'))
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(dir, { recursive: true, force: true })
  })
  await assert.rejects(checkReadiness(path.join(dir, 'missing'), revision))
  await assert.rejects(checkReadiness(dir, revision))
  const name = 'parity-2026-10-03T00-00-00.json'
  await writeFile(path.join(dir, name), 'bad json')
  await assert.rejects(checkReadiness(dir, revision))
  await writeFile(path.join(dir, name), JSON.stringify(passed()))
  assert.equal(await checkReadiness(dir, revision), name)
})
