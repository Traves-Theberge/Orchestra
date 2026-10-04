import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixtureEnvironment } from './fixture-environment.mjs'

test('spawned fixture has no inherited credentials or Git/account config', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orchestra-env-test-'))
  try {
    const inherited = { ...process.env, GH_TOKEN: 'sentinel-secret', GITHUB_TOKEN: 'sentinel-secret',
      UNSANDBOX_SECRET_KEY: 'sentinel-secret', gh_config_dir: '/real/account',
      GIT_CONFIG_GLOBAL: '/real/git', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: 'real-account-helper', NODE_OPTIONS: '--require /real/account',
      CUSTOM_FUTURE_CREDENTIAL: 'sentinel-secret', ORCHESTRA_API_TOKEN: 'sentinel-secret' }
    const env = fixtureEnvironment(root, inherited)
    const child = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env, encoding: 'utf8', windowsHide: true }))
    assert.equal(JSON.stringify(child).includes('sentinel-secret'), false)
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'UNSANDBOX_SECRET_KEY', 'GIT_CONFIG_COUNT', 'NODE_OPTIONS', 'CUSTOM_FUTURE_CREDENTIAL']) assert.equal(child[key], undefined)
    for (const key of ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL']) assert.equal(child[key].startsWith(root + path.sep), true, key)
    assert.equal(child.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(child.GIT_TERMINAL_PROMPT, '0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
