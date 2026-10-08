// Real backend + built renderer verification, isolated from signed-in provider accounts.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { fixtureEnvironment } from './fixture-environment.mjs'
import { DatabaseSync } from 'node:sqlite'

const exec = promisify(execFile)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const desktop = path.join(repo, 'apps/desktop')
const fixture = await mkdtemp(path.join(tmpdir(), 'orchestra-diagnostics-'))
const evidence = path.join(repo, '.superpowers/sdd/2026-10-07-local-diagnostics/evidence')
await mkdir(evidence, { recursive: true })
for (const directory of ['home', 'appdata', 'localappdata', 'tmp', 'project', 'state']) await mkdir(path.join(fixture, directory), { recursive: true })
await writeFile(path.join(fixture, 'WORKFLOW.md'), 'Isolated diagnostics fixture.\n')
const binary = path.join(fixture, process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad')
const suppliedBinary = process.argv.find(arg => arg.startsWith('--backend='))?.slice('--backend='.length)
const suppliedCLI = process.argv.find(arg => arg.startsWith('--cli='))?.slice('--cli='.length)
if (!suppliedBinary) await exec('go', ['build', '-o', binary, './cmd/orchestrad'], { cwd: path.join(repo, 'apps/backend'), windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
await stat(path.join(desktop, 'dist/index.html'))
const reserve = net.createServer()
await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve) })
const port = reserve.address().port
await new Promise(resolve => reserve.close(resolve))
const baseUrl = `http://127.0.0.1:${port}`
const token = 'diagnostics-local-fixture'
const env = fixtureEnvironment(fixture)
Object.assign(env, {
  ORCHESTRA_SERVER_HOST: '127.0.0.1', ORCHESTRA_SERVER_PORT: String(port), ORCHESTRA_API_TOKEN: token,
  ORCHESTRA_WORKSPACE_ROOT: path.join(fixture, 'state'), ORCHESTRA_PROJECT_ROOTS: path.join(fixture, 'project'),
  ORCHESTRA_WORKFLOW_FILE: path.join(fixture, 'WORKFLOW.md'), ORCHESTRA_TRACKER_TYPE: 'sqlite', ORCHESTRA_TELEMETRY_PROVIDERS: 'none',
  ORCHESTRA_AGENT_COMMAND_CODEX: `"${process.execPath}" "${path.join(repo, 'packages/test-fixtures/ade/diagnostics-appserver.cjs')}"`,
  ORCHESTRA_NATIVE_COMMAND_CODEX: `"${process.execPath}" "${path.join(repo, 'packages/test-fixtures/ade/diagnostics-appserver.cjs')}"`,
})
let child, browser, web
let backendOutput = ''
const checks = []
const mark = (name, details = {}) => { checks.push({ name, ...details }); console.log('PASS', name) }
function startBackend() {
  child = spawn(suppliedBinary ? path.resolve(suppliedBinary) : binary, [], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { backendOutput = (backendOutput + data).slice(-250_000) })
}
async function stopBackend() {
  if (!child || child.exitCode !== null) return
  const owned = child
  const exited = new Promise(resolve => owned.once('exit', resolve))
  owned.kill()
  await Promise.race([exited, delay(5000)])
  if (owned.exitCode === null) { owned.kill('SIGKILL'); await Promise.race([exited, delay(5000)]) }
}
async function request(endpoint, { method = 'GET', body, expected = 200, authenticated = true } = {}) {
  const response = await fetch(baseUrl + endpoint, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${endpoint}: ${text.slice(0, 1200)}`)
  return text ? JSON.parse(text) : null
}
async function cliObserve(action, args = [], json = true) {
  const result = await exec(path.resolve(suppliedCLI), ['diagnostics', action, ...args, ...(json ? ['--json'] : [])], { env: { ...env, ORCHESTRA_BASE_URL: baseUrl }, windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.stderr, '')
  assert.ok(!result.stdout.includes(token), 'CLI must not reveal its API credential')
  return json ? JSON.parse(result.stdout) : result.stdout
}
async function until(check, label, timeout = 20_000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result } catch (error) { last = error }
    await delay(150)
  }
  throw new Error(`${label} timed out${last ? ': ' + last.message : ''}`)
}
function seedLargeHistory(taskId, projectId) {
  // Synthetic performance evidence is deliberately distinct from provider executions.
  // The recorder is stopped before the fixture writes its dedicated database.
  const db = new DatabaseSync(path.join(fixture, 'state/.orchestra/diagnostics.db'))
  const insert = db.prepare('INSERT INTO spans VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const traceId = index => index.toString(16).padStart(32, '0')
  const spanId = index => index.toString(16).padStart(16, '0')
  const start = Date.now() - 10000
  const write = (trace, span, parent, name, task, project = 'scale-project') => {
    const payload = { trace_id: trace, span_id: span, parent_span_id: parent, name, status: 'ok', start_time: new Date(start).toISOString(), end_time: new Date(start + 5000).toISOString(), duration_ms: 5000, project_id: project, task_id: task, run_id: '', session_id: '', provider: 'fixture', model: '', attempt: 1 }
    insert.run(span, trace, parent, name, BigInt(start) * 1000000n, BigInt(start + 5000) * 1000000n, 'ok', project, task, 'fixture', JSON.stringify(payload))
  }
  db.exec('BEGIN')
  try {
    for (let index = 1; index <= 10000; index++) write(traceId(index), spanId(index), '', 'synthetic.task', '')
    const trace = traceId(10001), root = spanId(10001)
    write(trace, root, '', 'synthetic.waterfall', taskId, projectId)
    for (let index = 10002; index <= 11000; index++) write(trace, spanId(index), root, 'synthetic.operation', taskId, projectId)
    db.exec('COMMIT')
    return trace
  } catch (error) { db.exec('ROLLBACK'); throw error } finally { db.close() }
}
try {
  await exec('git', ['init', path.join(fixture, 'project')], { env, windowsHide: true })
  startBackend()
  await until(async () => { if (child.exitCode !== null) throw new Error('Backend exited: ' + backendOutput.slice(-3000)); return request('/healthz') }, 'backend startup')
  await request('/api/v1/diagnostics/settings', { authenticated: false, expected: 401 })
  const defaults = await request('/api/v1/diagnostics/settings')
  assert.equal(defaults.retention_days, 7)
  assert.equal(defaults.metrics_retention_days, 30)
  assert.equal(defaults.enabled, true)
  await request('/api/v1/diagnostics/traces?limit=-1', { expected: 400 })
  mark('authenticated local APIs and settings defaults')

  const project = await request('/api/v1/projects', { method: 'POST', body: { root_path: path.join(fixture, 'project') }, expected: 201 })
  const task = await request('/api/v1/issues', { method: 'POST', body: { project_id: project.id, title: 'Diagnostics Timeline fixture', description: 'Local fixture with no assigned worker.', state: 'Backlog', runtime_target: 'LOCAL' }, expected: 201 })
  const session = await request(`/api/v1/projects/${project.id}/chat/sessions`, { method: 'POST', body: { provider: 'CODEX', title: 'Diagnostics fixture' }, expected: 201 })
  const sessionRoute = `/api/v1/projects/${project.id}/chat/sessions/${session.id}`
  const send = async text => request(sessionRoute + '/messages', { method: 'POST', body: { client_message_id: crypto.randomUUID(), text }, expected: 202 })
  await send('waterfall PRIVATE_PROMPT_SENTINEL')
  await until(async () => { const detail = await request(sessionRoute); return detail.session.status === 'idle' && detail }, 'first native turn')
  await send('waterfall second turn')
  await until(async () => { const detail = await request(sessionRoute); return detail.session.status === 'idle' && detail.messages.length >= 4 && detail }, 'reused native turn')
  const traces = await until(async () => {
    const page = await request(`/api/v1/diagnostics/traces?project_id=${project.id}&limit=100`)
    return page.items.filter(trace => trace.session_id === session.id && trace.status !== 'running').length >= 2 && page
  }, 'persisted native traces')
  const details = await Promise.all(traces.items.filter(trace => trace.session_id === session.id).map(trace => request('/api/v1/diagnostics/traces/' + trace.trace_id)))
  const toolTrace = details.find(detail => detail.spans.filter(span => /tool|item/i.test(span.name)).length >= 2)
  assert.ok(toolTrace, 'native tool lifetimes must produce waterfall spans')
  assert.ok(toolTrace.spans.some(span => span.parent_span_id), 'waterfall contains child spans')
  const toolSpans = toolTrace.spans.filter(span => /tool|item/i.test(span.name) && span.end_time)
  assert.ok(toolSpans.some((first, index) => toolSpans.some((second, other) => index !== other && Date.parse(first.start_time) < Date.parse(second.end_time) && Date.parse(second.start_time) < Date.parse(first.end_time))), 'observed tool spans overlap')
  assert.ok(details.every(detail => detail.logs.length > 0), 'linked logs available for both turns')
  mark('native startup, reused turns, nested concurrent waterfall spans and linked logs', { trace_count: details.length, span_count: toolTrace.spans.length })
  await request('/api/v1/state')
  const httpLog = await until(async () => (await request('/api/v1/diagnostics/logs?q=%2Fapi%2Fv1%2Fstate')).items.find(log => log.http_method === 'GET' && log.http_route === '/api/v1/state' && log.http_status_code === 200 && Number.isFinite(log.duration_ms) && log.label && log.description), 'descriptive HTTP event')
  assert.ok(!httpLog.http_route.includes('?'))
  mark('descriptive request method, route template, status, duration and shared API labels')
  if (suppliedCLI) {
    const health = await cliObserve('check')
    assert.equal(health.data.available, true)
    assert.equal(health.data.execution_verified, false)
    assert.equal(health.data.collection_state, 'collecting')
    const page = await cliObserve('traces', ['--project', project.id, '--limit', '10'])
    assert.ok(page.data.items.some(trace => trace.trace_id === toolTrace.trace.trace_id))
    const detail = await cliObserve('trace', [toolTrace.trace.trace_id])
    assert.equal(detail.data.trace.trace_id, toolTrace.trace.trace_id)
    assert.ok(detail.data.spans.every(span => span.label && span.description))
    const logs = await cliObserve('logs', ['--search', '/api/v1/state'])
    assert.ok(logs.data.items.some(log => log.http_route === '/api/v1/state'))
    const readable = await cliObserve('logs', ['--search', '/api/v1/state'], false)
    assert.ok(readable.includes('GET /api/v1/state') && readable.includes('HTTP 200') && readable.includes('API activity'))
    await cliObserve('overview')
    await cliObserve('settings')
    assert.equal((await cliObserve('export')).data.schema_version, 1)
    mark('real Orchestra CLI authenticated overview, traces, exact trace, descriptive logs, settings, export and collection check')
  }

  await send('approval PRIVATE_PROMPT_SENTINEL')
  const approval = await until(async () => { const detail = await request(sessionRoute); return detail.requests.find(item => item.status === 'pending') }, 'approval request')
  await request(sessionRoute + '/requests/' + encodeURIComponent(approval.id) + '/reply', { method: 'POST', body: { client_response_id: crypto.randomUUID(), answer: { decision: 'accept' } } })
  await until(async () => (await request(sessionRoute)).session.status === 'idle', 'approval completion')
  await send('interrupt fixture')
  await until(async () => (await request(sessionRoute)).session.status === 'running', 'interruptible turn')
  await request(sessionRoute + '/stop', { method: 'POST' })
  await until(async () => (await request(sessionRoute)).session.status === 'interrupted', 'cancellation')
  mark('approval and cancellation lifecycle')
  await send('failure fixture')
  await until(async () => (await request(sessionRoute)).session.status === 'failed', 'controlled provider failure')
  await until(async () => (await request(`/api/v1/diagnostics/traces?project_id=${project.id}&status=error`)).items.some(trace => trace.session_id === session.id), 'failed turn diagnostics')
  mark('provider failure is reported as an error beneath an accepted HTTP request')

  const overview = await until(async () => { const value = await request('/api/v1/diagnostics/overview'); return value.usage.some(row => row.provider.toUpperCase() === 'CODEX' && row.known_runs >= 3) && value }, 'usage aggregation')
  const known = overview.usage.find(row => row.provider.toUpperCase() === 'CODEX')
  assert.equal(known.input_tokens, 30)
  assert.equal(known.output_tokens, 36)
  const bundle = await request('/api/v1/diagnostics/export')
  assert.equal(bundle.schema_version, 1)
  const exported = JSON.stringify(bundle)
  for (const sentinel of ['PRIVATE_PROMPT_SENTINEL', 'PRIVATE_TOOL_ARGUMENT_SENTINEL', 'PRIVATE_TOOL_RESULT_SENTINEL', token, path.join(fixture, 'project')]) assert.ok(!exported.includes(sentinel), 'export must exclude ' + sentinel)
  mark('exact known token aggregation and sanitized diagnostic export')

  await request('/api/v1/diagnostics/settings', { method: 'PUT', body: { ...defaults, enabled: false } })
  const beforeDisabled = (await request('/api/v1/diagnostics/traces?limit=1')).total
  await request('/api/v1/state')
  await delay(200)
  assert.equal((await request('/api/v1/diagnostics/traces?limit=1')).total, beforeDisabled)
  await stopBackend()
  startBackend()
  await until(() => request('/healthz'), 'restarted backend')
  assert.equal((await request('/api/v1/diagnostics/settings')).enabled, false)
  assert.equal((await request('/api/v1/diagnostics/traces?limit=1')).total, beforeDisabled)
  if (suppliedCLI) assert.equal((await cliObserve('check')).data.collection_state, 'disabled')
  await request('/api/v1/diagnostics/settings', { method: 'PUT', body: defaults })
  mark('disabled collection and persistent history/settings across process restart')

  const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
  const dist = path.join(desktop, 'dist')
  web = createServer(async (req, res) => {
    // Same-origin fixture transport avoids depending on a fixed, possibly occupied dev port.
    // The real backend still handles authentication and every API operation.
    if (req.url.startsWith('/api/') || req.url.startsWith('/healthz')) {
      const forwarded = httpRequest(new URL(req.url, baseUrl), { method: req.method, headers: req.headers }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers)
        upstream.pipe(res)
      })
      forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
      res.on('close', () => forwarded.destroy())
      req.pipe(forwarded)
      return
    }
    try {
      let candidate = path.resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname))
      if (!candidate.startsWith(dist + path.sep) && candidate !== dist) { res.writeHead(403).end(); return }
      if (candidate === dist || !(await stat(candidate).catch(() => null))?.isFile()) candidate = path.join(dist, 'index.html')
      const data = await readFile(candidate)
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(candidate)] || 'application/octet-stream' }).end(data)
    } catch { res.writeHead(500).end('Fixture asset read failed') }
  })
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve))
  const uiUrl = `http://127.0.0.1:${web.address().port}`
  const browserChannel = process.argv.find(arg => arg.startsWith('--browser-channel='))?.slice('--browser-channel='.length)
  const bundledBrowser = await stat(chromium.executablePath()).catch(() => null)
  browser = await chromium.launch({ headless: true, ...(browserChannel || (!bundledBrowser && process.platform === 'win32') ? { channel: browserChannel || 'msedge' } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true })
  const externalRequests = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { externalRequests.push(url.origin); return route.abort() }
    return route.continue()
  })
  await context.addInitScript(({ baseUrl, apiToken }) => sessionStorage.setItem('orchestra:browser-backend:v1', JSON.stringify({ baseUrl, apiToken })), { baseUrl: uiUrl, apiToken: token })
  const page = await context.newPage()
  const uiErrors = []
  const chartWarnings = []
  page.on('pageerror', error => uiErrors.push(error.message))
  page.on('console', message => { if (/width\(-1\)|height\(-1\)/.test(message.text())) chartWarnings.push(message.text()) })
  await page.goto(uiUrl)
  await page.getByRole('button', { name: 'Orchestra main navigation', exact: true }).click()
  await page.getByTestId('sidebar-nav-DIAGNOSTICS').click()
  await page.getByRole('heading', { name: 'Diagnostics', exact: true }).waitFor()
  assert.equal(await page.getByText('Chart attribution and license', { exact: true }).count(), 0)
  const operationTile = page.locator('rect[fill="var(--color-operations)"]').first()
  await operationTile.waitFor()
  const tileColor = await operationTile.evaluate(element => getComputedStyle(element).fill)
  assert.ok(tileColor !== 'rgb(0, 0, 0)' && tileColor !== 'none', `Operations must have a valid themed color: ${tileColor}`)
  await operationTile.hover()
  await page.locator('.recharts-tooltip-wrapper').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(evidence, 'diagnostics-overview.png'), fullPage: true })
  const lightPage = await context.newPage()
  await lightPage.addInitScript(() => localStorage.setItem('orchestra.themes.mode', 'light'))
  await lightPage.goto(uiUrl)
  await lightPage.getByRole('button', { name: 'Orchestra main navigation', exact: true }).click()
  await lightPage.getByTestId('sidebar-nav-DIAGNOSTICS').click()
  await lightPage.locator('rect[fill="var(--color-operations)"]').first().hover()
  assert.equal(await lightPage.evaluate(() => document.documentElement.classList.contains('dark')), false)
  await lightPage.screenshot({ path: path.join(evidence, 'diagnostics-overview-light.png'), fullPage: true })
  await lightPage.close()
  assert.deepEqual(chartWarnings, [])
  await page.getByRole('button', { name: 'Runs', exact: true }).click()
  await page.getByLabel('Project filter', { exact: true }).fill(project.id)
  // Select the exact retained trace rather than guessing by timing or list order.
  const traceRow = page.getByRole('button', { name: `Inspect run ${toolTrace.trace.name} ${toolTrace.trace.trace_id}`, exact: true })
  await traceRow.click()
  await page.getByRole('button', { name: /Select .* span/ }).first().click()
  await page.getByTestId('span-details').waitFor()
  await page.getByLabel('Timeline zoom', { exact: true }).selectOption('2')
  await page.screenshot({ path: path.join(evidence, 'diagnostics-waterfall.png'), fullPage: true })
  await page.getByRole('button', { name: 'Pause live updates', exact: true }).click()
  const refreshedDetail = page.waitForResponse(response => response.url().includes('/api/v1/diagnostics/traces/' + toolTrace.trace.trace_id) && response.status() === 200)
  await page.getByRole('button', { name: 'Refresh diagnostics', exact: true }).click()
  await refreshedDetail
  await page.getByTestId('sidebar-nav-ISSUES').click()
  await page.getByTestId('sidebar-nav-DIAGNOSTICS').click()
  assert.equal(await page.getByLabel('Project filter', { exact: true }).inputValue(), project.id)
  await page.getByTestId('span-details').waitFor()
  assert.equal(await page.getByLabel('Timeline zoom', { exact: true }).inputValue(), '2')
  mark('paused refresh updates selected detail and navigation retains the inspector')
  await page.getByRole('button', { name: 'Logs', exact: true }).click()
  const severityResponse = page.waitForResponse(response => response.url().includes('/api/v1/diagnostics/logs?') && new URL(response.url()).searchParams.get('severity') === 'error' && response.status() === 200)
  await page.getByLabel('Log severity filter', { exact: true }).selectOption('error')
  await severityResponse
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.getByRole('navigation', { name: 'Diagnostic views', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Save diagnostics settings', exact: true }).waitFor()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(path.join(evidence, 'ui-export.json'))
  assert.equal(JSON.parse(await readFile(path.join(evidence, 'ui-export.json'), 'utf8')).schema_version, 1)
  assert.deepEqual(uiErrors, [])
  assert.deepEqual(externalRequests, [])
  mark('built renderer menu, waterfall, linked views and local export with external requests blocked')

  await request('/api/v1/diagnostics/settings', { method: 'PUT', body: { ...defaults, enabled: false } })
  await stopBackend()
  const scaleTrace = seedLargeHistory(task.id, project.id)
  startBackend()
  await until(() => request('/healthz'), 'scale fixture backend')
  const measuredStart = performance.now()
  const scalePage = await request('/api/v1/diagnostics/traces?project_id=scale-project&limit=100')
  const queryMs = performance.now() - measuredStart
  assert.equal(scalePage.total, 10000)
  assert.equal(scalePage.items.length, 100)
  const renderStart = performance.now()
  await page.getByRole('button', { name: 'Runs', exact: true }).click()
  await page.getByLabel('Project filter', { exact: true }).fill(project.id)
  await page.getByLabel('Task filter', { exact: true }).fill(task.id)
  await page.getByRole('button', { name: `Inspect run synthetic.waterfall ${scaleTrace}`, exact: true }).click()
  const firstSpan = page.getByRole('button', { name: /Select synthetic.waterfall span/ })
  await firstSpan.waitFor()
  await firstSpan.focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('span-details').waitFor()
  const renderMs = performance.now() - renderStart
  const renderedRows = await page.locator('[data-testid^="span-row-"]').count()
  assert.ok(renderedRows > 0 && renderedRows < 150, `1,000-span trace must virtualize rows: ${renderedRows}`)
  assert.equal((await request('/api/v1/diagnostics/traces/' + scaleTrace)).spans.length, 1000)
  await page.screenshot({ path: path.join(evidence, 'diagnostics-large-waterfall.png'), fullPage: true })
  mark('synthetic 10,000-trace paging and 1,000-span virtualized keyboard-accessible waterfall', { synthetic: true, query_ms: queryMs, render_ms: renderMs, rendered_rows: renderedRows, reduced_motion: 'reduce' })
  await page.getByTestId('sidebar-nav-ISSUES').click()
  await page.getByTestId('kanban-task-' + task.id).click()
  const timelineResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/diagnostics/traces' && url.searchParams.get('task_id') === task.id && url.searchParams.get('project_id') === project.id && response.status() === 200
  })
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await timelineResponse
  await page.getByRole('button', { name: `Inspect run synthetic.waterfall ${scaleTrace}`, exact: true }).click()
  await page.getByRole('heading', { name: 'Run timeline', exact: true }).waitFor()
  await page.screenshot({ path: path.join(evidence, 'diagnostics-task-timeline.png'), fullPage: true })
  mark('task detail Timeline uses the same waterfall with exact project/task correlation', { task_id: task.id, project_id: project.id, synthetic_trace: true })
  await request('/api/v1/diagnostics/history', { method: 'DELETE', expected: 204 })
  assert.equal((await request('/api/v1/diagnostics/traces')).total, 0)
  assert.ok((await request(sessionRoute)).messages.length >= 4, 'clear diagnostics preserves conversation history')
  mark('diagnostics clear preserves application records')
  await writeFile(path.join(evidence, 'smoke.json'), JSON.stringify({ passed: true, fixture: true, signed_in_provider_used: false, fixture_root: fixture, checks, external_requests: externalRequests, ui_errors: uiErrors }, null, 2))
  console.log('DIAGNOSTICS_SMOKE_PASSED', evidence)
} catch (error) {
  await writeFile(path.join(evidence, 'smoke.json'), JSON.stringify({ passed: false, fixture: true, checks, error: error.message, fixture_root: fixture }, null, 2))
  await writeFile(path.join(evidence, 'backend.log'), backendOutput)
  console.error('DIAGNOSTICS_SMOKE_FAILED', error.message, 'Evidence:', evidence)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (web) await new Promise(resolve => web.close(resolve))
  await stopBackend()
}
