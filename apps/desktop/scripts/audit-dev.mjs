// Start a persistent, isolated native audit without reusing another dev server.
import { spawn } from 'node:child_process'
import { access, mkdir, stat } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = new Set()
let stopping = false
let shutdownPromise

function options() {
  const result = { port: 5174, backendPort: 4014, smoke: false, currentProviderContext: false }
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') {
      console.log('npm run audit:dev -- [--port 5173|5174] [--backend-port PORT] [--smoke] [--current-provider-context]\nORCHESTRA_AUDIT_ROOT: absolute persistent audit profile; default local Orchestra/audit-dev.')
      return null
    }
    if (arg === '--current-provider-context') { result.currentProviderContext = true; continue }
    if (arg === '--smoke') { result.smoke = true; continue }
    const [name, inline] = arg.split('=')
    if (!['--port', '--backend-port'].includes(name)) throw new Error(`Unknown argument: ${arg}`)
    const value = inline ?? args[++index]
    if (!value || !/^\d+$/.test(value)) throw new Error(`${name} requires an integer port`)
    result[name === '--port' ? 'port' : 'backendPort'] = Number(value)
  }
  if (![5173, 5174].includes(result.port)) throw new Error('Audit Vite port must be 5173 or 5174 (backend CORS)')
  if (result.backendPort < 1024 || result.backendPort > 65535 || result.backendPort === result.port) throw new Error('Backend port must be distinct and between 1024 and 65535')
  if (result.smoke && result.currentProviderContext) throw new Error('Automated smoke runs require isolated provider context')
  return result
}

async function assertFree(port, label) {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(`${label} port ${port} unavailable: ${error.code}; refusing to reuse another server`)))
    server.listen({ host: '127.0.0.1', port }, () => server.close(resolve))
  })
}

async function backendBinary() {
  if (process.env.ORCHESTRA_BACKEND_BIN) {
    if (!path.isAbsolute(process.env.ORCHESTRA_BACKEND_BIN)) throw new Error('ORCHESTRA_BACKEND_BIN must be absolute')
    if (!(await stat(process.env.ORCHESTRA_BACKEND_BIN)).isFile()) throw new Error('ORCHESTRA_BACKEND_BIN is not a file')
    return process.env.ORCHESTRA_BACKEND_BIN
  }
  const binary = process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad'
  const candidates = [path.join(desktop, '..', 'backend', binary), path.join(desktop, '..', 'backend', 'dist', 'orchestra', binary), path.join(desktop, 'resources', 'backend', `${process.platform}-${process.arch}`, binary)]
  const found = []
  for (const candidate of candidates) {
    try { const info = await stat(candidate); if (info.isFile()) found.push({ candidate, modified: info.mtimeMs }) } catch { /* Try the next supported location. */ }
  }
  found.sort((left, right) => right.modified - left.modified)
  if (!found.length) throw new Error('Native backend binary missing. Build apps/backend/cmd/orchestrad first; audit will not fall back to an unrelated backend.')
  return found[0].candidate
}

function isolatedEnvironment(root) {
  const env = { ...process.env }
  delete env.ORCHESTRA_AUDIT_CURRENT_PROVIDER_CONTEXT
  for (const key of Object.keys(env)) {
    if (/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY)$/.test(key) || ['GH_TOKEN', 'GITHUB_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'AWS_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'ELECTRON_RUN_AS_NODE', 'ORCHESTRA_TOKEN_KEY', 'ORCHESTRA_BASE_URL', 'ORCHESTRA_API_TOKEN'].includes(key)) delete env[key]
  }
  Object.assign(env, {
    ORCHESTRA_AUDIT_ROOT: root,
    HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'),
    XDG_CONFIG_HOME: path.join(root, 'home', '.config'), XDG_DATA_HOME: path.join(root, 'home', '.local', 'share'),
    XDG_CACHE_HOME: path.join(root, 'home', '.cache'), TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
  })
  return env
}

function launch(args, env, capture = false) {
  const child = spawn(process.execPath, args, { cwd: desktop, env, shell: false, detached: process.platform !== 'win32', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true })
  children.add(child)
  child.once('exit', () => children.delete(child))
  // Observe errors from the instant spawn returns.
  child.failure = null
  child.on('error', error => { child.failure = error })
  return child
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // Only the process tree created by this launcher is targeted.
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
      killer.once('error', reject)
      killer.once('exit', code => code === 0 || child.exitCode !== null ? resolve() : reject(new Error(`Unable to stop owned process ${child.pid}: taskkill ${code}`)))
    })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)])
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
    else throw new Error(`Owned process ${child.pid} did not settle after taskkill`)
  }
}

function shutdown() {
  stopping = true
  shutdownPromise ??= (async () => {
    // Electron is launched last; stop it before Vite, retaining profile data.
    for (const child of [...children].reverse()) await stopChild(child)
  })()
  return shutdownPromise
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  process.exitCode = signal === 'SIGINT' ? 130 : 143
  void shutdown().catch(error => { console.error('AUDIT_STOP_FAILED', error.message); process.exitCode = 1 })
})

async function main() {
  const opts = options()
  if (!opts) return
  await assertFree(opts.port, 'Vite')
  await assertFree(opts.backendPort, 'Backend')
  const binary = await backendBinary()
  const defaultLocal = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share')
  const root = process.env.ORCHESTRA_AUDIT_ROOT || path.join(defaultLocal, 'Orchestra', 'audit-dev')
  if (!path.isAbsolute(root) || path.resolve(root) === path.resolve(os.homedir()) || path.resolve(root) === path.parse(path.resolve(root)).root) throw new Error('ORCHESTRA_AUDIT_ROOT must be a separate absolute audit directory')
  const auditRoot = path.resolve(root)
  const env = opts.currentProviderContext
    ? { ...process.env, ORCHESTRA_AUDIT_ROOT: auditRoot, ORCHESTRA_AUDIT_CURRENT_PROVIDER_CONTEXT: '1' }
    : isolatedEnvironment(auditRoot)
  if (opts.currentProviderContext) console.log('LOCAL_PROVIDER_CONTEXT current user CLI account/configuration; automated smoke disabled')
  // Project authorization is independent of provider settings isolation. Retain
  // explicit restrictions; otherwise permit the real user's development folders
  // and audit fixtures, matching normal local desktop home-directory access.
  env.ORCHESTRA_PROJECT_ROOTS = process.env.ORCHESTRA_PROJECT_ROOTS?.trim() || [os.homedir(), path.join(auditRoot, 'home')].join(',')
  // Windows shell dialogs resolve known folders beneath the isolated USERPROFILE.
  // Provision empty folders rather than pointing them at the account profile.
  for (const directory of ['desktop', 'home', 'roaming', 'local', 'tmp', ...['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos'].map(name => path.join('home', name))]) await mkdir(path.join(auditRoot, directory), { recursive: true })
  const viteEntry = path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js')
  await access(viteEntry)
  console.log(`AUDIT_PROFILE ${auditRoot}\nAUDIT_BACKEND ${binary}\nAUDIT_PORTS Vite=${opts.port} backend=${opts.backendPort}`)
  const vite = launch([viteEntry, '--host', '127.0.0.1', '--port', String(opts.port), '--strictPort'], env, true)
  let viteReady = false
  let output = ''
  const observe = chunk => {
    process.stdout.write(chunk)
    output = (output + chunk.toString().replace(/\u001b\[[0-9;]*m/g, '')).slice(-8192)
    if (output.includes(`http://127.0.0.1:${opts.port}/`)) viteReady = true
  }
  vite.stdout.on('data', observe)
  vite.stderr.on('data', observe)
  const deadline = Date.now() + 30_000
  while (!viteReady && !stopping) {
    if (vite.failure) throw vite.failure
    if (vite.exitCode !== null || vite.signalCode !== null) throw new Error(`Owned Vite exited before readiness (${vite.exitCode ?? vite.signalCode})`)
    if (Date.now() > deadline) throw new Error('Owned Vite did not announce readiness in 30 seconds')
    await delay(100)
  }
  if (stopping) return
  const response = await fetch(`http://127.0.0.1:${opts.port}/`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok || vite.exitCode !== null) throw new Error('Owned Vite readiness HTTP check failed')
  // Keep browsing user-selected repositories separate from provider HOME/config.
  Object.assign(env, { ORCHESTRA_AUDIT_BROWSE_ROOT: os.homedir(), VITE_DEV_SERVER_URL: `http://127.0.0.1:${opts.port}`, ORCHESTRA_BACKEND_BIN: binary, ORCHESTRA_SERVER_PORT: String(opts.backendPort), ORCHESTRA_AUDIT_SMOKE: opts.smoke ? '1' : '0' })
  const electron = launch([path.join(desktop, 'scripts', 'launch-electron.mjs'), path.join(desktop, 'scripts', 'audit-electron.cjs')], env)
  vite.once('exit', () => {
    if (stopping) return
    console.error('AUDIT_LAUNCH_FAILED', 'Owned Vite exited while the audit was running')
    process.exitCode = 1
    void shutdown().catch(error => console.error('AUDIT_STOP_FAILED', error.message))
  })
  const result = await new Promise((resolve, reject) => { electron.once('error', reject); electron.once('exit', (code, signal) => resolve({ code, signal })) })
  if (!stopping) process.exitCode = result.code ?? 1
}

try { await main() } catch (error) { console.error('AUDIT_LAUNCH_FAILED', error.message); process.exitCode = 1 }
finally { try { await shutdown() } catch (error) { console.error('AUDIT_STOP_FAILED', error.message); process.exitCode = 1 } }
