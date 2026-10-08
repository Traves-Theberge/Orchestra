// Dev companion for `npm run dev`: rebuilds orchestrad from source and runs it
// on 127.0.0.1:4010 (the port the desktop falls back to in dev), so the UI and
// backend always start together on current code. Set ORCHESTRA_DEV_BACKEND=0
// to skip it when running the backend yourself.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend')
const exe = process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad'
const binary = path.join(backendDir, exe)
const host = process.env.ORCHESTRA_DEV_BACKEND_HOST || '127.0.0.1:4010'
const [hostname, port] = host.split(':')
const log = (message) => console.log(`[dev-backend] ${message}`)

if (process.env.ORCHESTRA_DEV_BACKEND === '0') {
  log('skipped (ORCHESTRA_DEV_BACKEND=0)')
  // Stay alive so `concurrently -k` doesn't tear down the UI.
  setInterval(() => {}, 1 << 30)
} else {
  start()
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port: Number(port) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

// Frees the dev port when a previous orchestrad still holds it, so a stale
// binary never keeps serving old code. Other programs on the port are left alone.
function stopStaleBackend() {
  try {
    if (process.platform === 'win32') {
      const rows = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split(/\r?\n/)
      const pids = new Set(rows.filter(r => r.includes(`${hostname}:${port} `) && r.includes('LISTENING')).map(r => r.trim().split(/\s+/).pop()))
      for (const pid of pids) {
        const name = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
        if (/orchestrad/i.test(name)) { execFileSync('taskkill', ['/PID', pid, '/F']); log(`stopped previous orchestrad (pid ${pid})`) }
      }
    } else {
      const pids = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
      for (const pid of pids) {
        const name = execFileSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8' })
        if (/orchestrad/.test(name)) { process.kill(Number(pid)); log(`stopped previous orchestrad (pid ${pid})`) }
      }
    }
  } catch { /* nothing listening, or the lookup tool is unavailable */ }
}

async function start() {
  log('building orchestrad…')
  // Build beside the binary, then swap: Windows locks a running .exe.
  const next = `${binary}.next`
  execFileSync('go', ['build', '-o', next, './cmd/orchestrad/'], { cwd: backendDir, stdio: 'inherit' })
  stopStaleBackend()
  for (let i = 0; i < 20 && await portInUse(); i += 1) await new Promise(r => setTimeout(r, 250))
  if (await portInUse()) {
    fs.rmSync(next, { force: true })
    log(`${host} is held by another program; using it as the backend`)
    setInterval(() => {}, 1 << 30)
    return
  }
  fs.renameSync(next, binary)

  // Global bun bin hosts harness CLIs installed with `bun add -g` (e.g. 8gent).
  let extraPath = ''
  try { extraPath = path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim(), 'bun', 'bin') } catch { /* optional */ }
  const env = {
    ...process.env,
    PATH: extraPath ? `${process.env.PATH}${path.delimiter}${extraPath}` : process.env.PATH,
    ORCHESTRA_SERVER_HOST: hostname,
    ORCHESTRA_SERVER_PORT: port,
    ORCHESTRA_WORKSPACE_ROOT: process.env.ORCHESTRA_WORKSPACE_ROOT || path.join(os.homedir(), '.orchestra', 'workspaces'),
  }
  // The desktop dev build sends no token; a token here would 401 every request.
  delete env.ORCHESTRA_API_TOKEN

  log(`starting on http://${host}`)
  const child = spawn(binary, [], { cwd: backendDir, env, stdio: 'inherit' })
  const stop = () => { if (!child.killed) child.kill() }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', stop)
  child.on('exit', code => { log(`orchestrad exited (${code})`); process.exit(code ?? 1) })
}
