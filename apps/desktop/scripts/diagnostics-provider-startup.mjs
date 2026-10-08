// Exercise the installed local provider protocol without sign-in or model requests.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fixtureEnvironment } from './fixture-environment.mjs'

const executable = process.argv.find(value => value.startsWith('--codex='))?.slice(8)
if (!executable) throw new Error('Supply the installed Codex executable using --codex=...')
const fixture = await mkdtemp(path.join(tmpdir(), 'orchestra-diagnostics-provider-'))
const env = fixtureEnvironment(fixture)
for (const directory of ['home', 'appdata', 'localappdata', 'tmp']) await mkdir(path.join(fixture, directory), { recursive: true })
await mkdir(env.CODEX_HOME, { recursive: true })
const child = spawn(executable, ['app-server'], { cwd: fixture, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = new Map()
let sequence = 0
let stderr = ''
child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000) })
readline.createInterface({ input: child.stdout }).on('line', line => {
  let value
  try { value = JSON.parse(line) } catch { return }
  const waiter = pending.get(value.id)
  if (!waiter) return
  pending.delete(value.id)
  clearTimeout(waiter.timer)
  if (value.error) waiter.reject(new Error(JSON.stringify(value.error)))
  else waiter.resolve(value.result)
})
child.once('error', error => { for (const waiter of pending.values()) waiter.reject(error) })
child.once('exit', code => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Provider exited with code ' + code + ': ' + stderr)) } })
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out: ' + stderr)) }, 20000)
  pending.set(id, { resolve, reject, timer })
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
})
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'orchestra_diagnostics_check', title: 'Orchestra local diagnostics verification', version: '0.1.0' }, capabilities: { experimentalApi: true } })
  assert.ok(initialized.userAgent)
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
  const account = await rpc('account/read', { refreshToken: false })
  assert.equal(account.account, null, 'isolated profile must not use a signed-in account')
  const evidence = { passed: true, protocol: 'initialize/account-read', user_agent: initialized.userAgent, signed_in_account: false, model_request_sent: false }
  await writeFile(path.join(fixture, 'provider-startup.json'), JSON.stringify(evidence, null, 2))
  console.log('DIAGNOSTICS_REAL_PROVIDER_STARTUP_PASSED', fixture, JSON.stringify(evidence))
} finally {
  for (const waiter of pending.values()) clearTimeout(waiter.timer)
  child.stdin.end()
  if (child.exitCode === null) child.kill()
}
