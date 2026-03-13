import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

let smokeLogStream = null
let backendLogStream = null

function nowISO() {
  return new Date().toISOString()
}

function toPreview(value, max = 700) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= max) return text
  return `${text.slice(0, max)}...<truncated>`
}

function logTrace(message) {
  if (!smokeLogStream) return
  smokeLogStream.write(`[${nowISO()}] ${message}\n`)
}

function parseArgs(argv) {
  const spawnBackend = argv.includes('--spawn-backend')
  const requireAuth = argv.includes('--require-auth')
  const verbose = argv.includes('--verbose')
  const baseArg = argv.find((value) => value.startsWith('--base-url='))
  const baseUrl = baseArg ? baseArg.slice('--base-url='.length) : process.env.ORCHESTRA_BASE_URL || 'http://127.0.0.1:4010'
  const tokenArg = argv.find((value) => value.startsWith('--token='))
  const token = tokenArg ? tokenArg.slice('--token='.length) : process.env.ORCHESTRA_API_TOKEN || ''
  const logDirArg = argv.find((value) => value.startsWith('--log-dir='))
  const logDir = logDirArg ? logDirArg.slice('--log-dir='.length) : ''
  return { spawnBackend, requireAuth, baseUrl, token, verbose, logDir }
}

async function requestJSON(baseUrl, token, path, init, expectedStatus) {
  const method = init?.method || 'GET'
  const headers = {
    Accept: 'application/json',
    ...(init?.headers || {}),
  }
  if (token.trim() !== '') {
    headers.Authorization = `Bearer ${token.trim()}`
  }

  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers,
  })

  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }

  if (response.status !== expectedStatus) {
    logTrace(`${method} ${path} -> ${response.status} payload=${toPreview(parsed)}`)
    throw new Error(`${init?.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(parsed)}`)
  }

  logTrace(`${method} ${path} -> ${response.status} payload=${toPreview(parsed)}`)

  return parsed
}

async function requestText(baseUrl, token, path, expectedStatus) {
  const headers = {
    Accept: 'text/event-stream',
  }
  if (token.trim() !== '') {
    headers.Authorization = `Bearer ${token.trim()}`
  }

  const response = await fetch(new URL(path, baseUrl), {
    method: 'GET',
    headers,
  })

  const text = await response.text()
  if (response.status !== expectedStatus) {
    logTrace(`GET ${path} -> ${response.status} body=${toPreview(text)}`)
    throw new Error(`GET ${path} expected ${expectedStatus}, got ${response.status}: ${text}`)
  }

  logTrace(`GET ${path} -> ${response.status} body=${toPreview(text)}`)

  return text
}

function parseSSE(text) {
  const frames = text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)

  return frames.map((frame) => {
    const lines = frame.split('\n')
    const eventLine = lines.find((line) => line.startsWith('event:')) || ''
    const dataLine = lines.find((line) => line.startsWith('data:')) || ''
    const event = eventLine.slice('event:'.length).trim()
    const dataText = dataLine.slice('data:'.length).trim()
    let data = null
    try {
      data = JSON.parse(dataText)
    } catch {
      data = dataText
    }
    return { event, data }
  })
}

async function verifySSESnapshot(baseUrl, token, label) {
  const streamText = await requestText(baseUrl, token, '/api/v1/events?once=1', 200)
  const frames = parseSSE(streamText)
  const snapshotFrame = frames.find((frame) => frame.event === 'snapshot')
  if (!snapshotFrame) {
    throw new Error(`${label}: snapshot event missing from SSE payload`)
  }
  if (!snapshotFrame.data || typeof snapshotFrame.data !== 'object' || !('counts' in snapshotFrame.data)) {
    throw new Error(`${label}: snapshot event missing expected fields`)
  }
}

async function waitForBackend(baseUrl, token, timeoutMs = 20000) {
  const start = Date.now()
  let lastError = null

  while (Date.now() - start < timeoutMs) {
    try {
      await requestJSON(baseUrl, token, '/api/v1/state', undefined, 200)
      return
    } catch (error) {
      lastError = error
      await delay(300)
    }
  }

  throw new Error(`backend did not become ready within ${timeoutMs}ms: ${String(lastError)}`)
}

function startGoBackend(baseUrl, requireAuth, token) {
  const parsed = new URL(baseUrl)
  const host = requireAuth ? '0.0.0.0' : parsed.hostname
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')

  const workspaceRoot = `/tmp/orchestra_smoke_${Date.now()}`
  const child = spawn('go', ['run', './cmd/orchestrad'], {
    cwd: '../backend',
    detached: true,
    env: {
      ...process.env,
      ORCHESTRA_SERVER_HOST: host,
      ORCHESTRA_SERVER_PORT: port,
      ORCHESTRA_WORKSPACE_ROOT: workspaceRoot,
      ORCHESTRA_API_TOKEN: requireAuth ? token : '',
    },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk}`)
    if (backendLogStream) backendLogStream.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[backend] ${chunk}`)
    if (backendLogStream) backendLogStream.write(chunk)
  })

  return child
}

async function stopProcess(child) {
  if (!child || child.killed) {
    return
  }

  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }

    child.once('exit', finish)

    if (typeof child.pid === 'number') {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    } else {
      child.kill('SIGTERM')
    }

    setTimeout(() => {
      if (!settled) {
        if (typeof child.pid === 'number') {
          try {
            process.kill(-child.pid, 'SIGKILL')
            return
          } catch {
            child.kill('SIGKILL')
            return
          }
        }
        child.kill('SIGKILL')
      }
    }, 1500)

    setTimeout(finish, 2500)
  })
}

async function expectUnauthorized(baseUrl, path, init) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (response.status !== 401) {
    const text = await response.text()
    throw new Error(`${init?.method || 'GET'} ${path} expected 401 unauthorized, got ${response.status}: ${text}`)
  }
}

async function expectJSONError(baseUrl, token, path, init, expectedStatus, expectedCode) {
  const headers = {
    Accept: 'application/json',
    ...(init?.headers || {}),
  }
  if (token.trim() !== '') {
    headers.Authorization = `Bearer ${token.trim()}`
  }

  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers,
  })

  const payload = await response.json().catch(() => null)
  if (response.status !== expectedStatus) {
    throw new Error(`${init?.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}`)
  }

  const code = payload?.error?.code
  if (code !== expectedCode) {
    throw new Error(`${init?.method || 'GET'} ${path} expected error code ${expectedCode}, got ${String(code)}`)
  }
}

async function expectAPIErrorCode(baseUrl, token, path, expectedStatus, expectedCode) {
  const headers = {
    Accept: 'application/json',
  }
  if (token.trim() !== '') {
    headers.Authorization = `Bearer ${token.trim()}`
  }

  const response = await fetch(new URL(path, baseUrl), {
    method: 'GET',
    headers,
  })

  const payload = await response.json().catch(() => null)
  if (response.status !== expectedStatus) {
    throw new Error(`GET ${path} expected ${expectedStatus}, got ${response.status}`)
  }
  const code = payload?.error?.code
  if (code !== expectedCode) {
    throw new Error(`GET ${path} expected error code ${expectedCode}, got ${String(code)}`)
  }
}

async function runFlow(baseUrl, token, requireAuth) {
  await verifySSESnapshot(baseUrl, token, 'initial sse check')

  const state = await requestJSON(baseUrl, token, '/api/v1/state', undefined, 200)
  if (!state || typeof state !== 'object' || !('counts' in state)) {
    throw new Error('state payload missing required fields')
  }

  await expectAPIErrorCode(baseUrl, token, '/api/v1/issues/OPS-SMOKE-MISSING', 404, 'issue_not_found')
  console.log('DEGRADED_ASSERTION:issue_not_found')
  await expectAPIErrorCode(baseUrl, token, '/api/v9/ROUTE-SMOKE-MISSING', 404, 'not_found')
  console.log('DEGRADED_ASSERTION:route_not_found')
  await expectJSONError(baseUrl, token, '/api/v1/state', { method: 'POST' }, 405, 'method_not_allowed')
  console.log('DEGRADED_ASSERTION:method_not_allowed')
  await expectJSONError(
    baseUrl,
    token,
    '/api/v1/refresh',
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json',
    },
    415,
    'unsupported_media_type',
  )
  console.log('DEGRADED_ASSERTION:unsupported_media_type')

  if (requireAuth) {
    await expectJSONError(baseUrl, '', '/api/v1/refresh', { method: 'POST' }, 401, 'unauthorized')
    console.log('DEGRADED_ASSERTION:unauthorized_refresh')
    await expectJSONError(baseUrl, '', '/api/v1/workspace/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    }, 401, 'unauthorized')
    console.log('DEGRADED_ASSERTION:unauthorized_migrate')
  }

  await requestJSON(baseUrl, token, '/api/v1/refresh', { method: 'POST' }, 202)
  await requestJSON(baseUrl, token, '/api/v1/workspace/migration/plan', undefined, 200)

  await requestJSON(
    baseUrl,
    token,
    '/api/v1/workspace/migrate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    },
    202,
  )

  await verifySSESnapshot(baseUrl, token, 'reconnect sse check')
}

async function main() {
  const { spawnBackend, requireAuth, baseUrl, token, verbose, logDir } = parseArgs(process.argv.slice(2))
  let backendProcess = null

  const resolvedLogDir = logDir || path.join('/tmp', `orchestra-smoke-${Date.now()}`)
  await mkdir(resolvedLogDir, { recursive: true })
  smokeLogStream = createWriteStream(path.join(resolvedLogDir, 'smoke-flow.log'), { flags: 'a' })
  backendLogStream = createWriteStream(path.join(resolvedLogDir, 'backend.log'), { flags: 'a' })
  logTrace(`Smoke run started baseUrl=${baseUrl} requireAuth=${requireAuth} spawnBackend=${spawnBackend}`)
  if (verbose) {
    console.log(`Smoke logs: ${resolvedLogDir}`)
  }

  if (requireAuth && token.trim() === '') {
    throw new Error('require-auth mode needs a non-empty token; pass --token=... or ORCHESTRA_API_TOKEN')
  }

  try {
    if (spawnBackend) {
      console.log(`Starting Go backend at ${baseUrl} ...`)
      backendProcess = startGoBackend(baseUrl, requireAuth, token)
    }

    await waitForBackend(baseUrl, token)
    await runFlow(baseUrl, token, requireAuth)
    console.log(`Smoke flow passed against ${baseUrl}`)
    console.log(`Smoke logs saved at ${resolvedLogDir}`)
  } finally {
    await stopProcess(backendProcess)
    logTrace('Smoke run ended')
    if (smokeLogStream) {
      await new Promise((resolve) => smokeLogStream.end(resolve))
      smokeLogStream = null
    }
    if (backendLogStream) {
      await new Promise((resolve) => backendLogStream.end(resolve))
      backendLogStream = null
    }
  }
}

main().catch((error) => {
  console.error(`Smoke flow failed: ${error instanceof Error ? error.message : String(error)}`)
  logTrace(`Smoke run failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  process.exit(1)
})
