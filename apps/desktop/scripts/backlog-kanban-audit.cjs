// Native Electron search + pointer-drag audit against the smoke's disposable backend.
// The fixture is a human-assigned Backlog item, so promoting it to Todo cannot dispatch a provider run.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function runRendererScript(win, name, source) {
  console.log(`BACKLOG_AUDIT_STEP ${name}`)
  try {
    return await win.webContents.executeJavaScript(source)
  } catch (error) {
    throw new Error(`Backlog audit ${name}: ${error?.message || String(error)}`)
  }
}

async function auditBacklogKanban(win, fixture) {
  const seed = `backlog-smoke-${Date.now()}`
  const created = await runRendererScript(win, 'create disposable human-assigned task', `(async () => {
    const config = await window.orchestraDesktop.getBackendConfig()
    const headers = { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }
    const projectsResponse = await fetch(config.baseUrl + '/api/v1/projects', { headers })
    if (!projectsResponse.ok) throw new Error('Fixture project lookup failed: ' + projectsResponse.status)
    const projects = await projectsResponse.json()
    const project = projects.find((candidate) => candidate.name === 'Workspace audit')
    if (!project) throw new Error('Disposable Workspace audit project was not found')
    const response = await fetch(config.baseUrl + '/api/v1/issues', {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'Backlog pointer fixture ${seed}',
        description: 'Searchable fixture created only in the disposable Electron smoke project.',
        state: 'Backlog',
        assignee_id: 'person-smoke-${seed}',
        project_id: project.id,
        runtime_target: 'LOCAL',
      }),
    })
    if (!response.ok) throw new Error('Disposable Backlog fixture creation failed: ' + response.status + ' ' + (await response.text()))
    const issue = await response.json()
    if (!issue.identifier || !issue.id) throw new Error('Created fixture has no stable task identity')
    return { baseUrl: config.baseUrl, apiToken: config.apiToken, projectID: project.id, projectIssueSourceType: project.issue_source_type || '', projectTrackerConfigID: project.tracker_config_id || '', issueID: issue.id, identifier: issue.identifier, initialState: issue.state, assignedToWorker: issue.assigned_to_worker, assigneeID: issue.assignee_id }
  })()`)

  if (created.projectIssueSourceType || created.projectTrackerConfigID) throw new Error('Native Backlog drag fixture must use the isolated local SQLite project without a hosted task source')
  if (!created.assigneeID?.startsWith('person-smoke-')) throw new Error('Native Backlog drag fixture did not retain its non-provider human assignee marker')
  if (created.assignedToWorker !== false) throw new Error('Backend did not confirm the native smoke assignee is outside the configured worker allowlist')

  // Ask the existing app sync hook to refetch issues without reloading or
  // resetting the active project/task navigation.
  await runRendererScript(win, 'refresh task query and locate Backlog search', `(async () => {
    const deadline = Date.now() + 15_000
    const nav = () => document.querySelector('[data-testid="sidebar-nav-ISSUES"]')
    if (nav()?.getAttribute('aria-current') !== 'page') throw new Error('Tasks section is not active for the Backlog audit')
    window.dispatchEvent(new Event('orchestra-data-changed'))
    const search = () => document.querySelector('input[aria-label="Search Backlog tasks"]')
    while (!search() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 75))
    if (!search()) throw new Error('Backlog search control did not render')
  })()`)

  // Chromium suppresses native HTML drag targets for hidden Electron windows.
  // Show/focus only for the real pointer sequence; the smoke quits immediately
  // afterward and continues to use the disposable userData/profile.
  win.show()
  win.focus()
  win.webContents.focus()
  await wait(300)

  await runRendererScript(win, 'register native drag event observations', `(() => {
    const input = document.querySelector('input[aria-label="Search Backlog tasks"]')
    input.focus()
    window.__backlogSmokeNativeDrag = { starts: 0, overs: 0, drops: 0, enters: 0, downs: 0, ups: 0, moves: 0, lastTarget: '', lastPoint: null, moveButtons: [], dragTargets: [] }
    document.addEventListener('mousedown', (event) => {
      window.__backlogSmokeNativeDrag.downs++
      window.__backlogSmokeNativeDrag.lastTarget = event.target instanceof Element ? event.target.getAttribute('data-testid') || event.target.tagName : 'unknown'
    }, true)
    document.addEventListener('mouseup', (event) => {
      window.__backlogSmokeNativeDrag.ups++
      window.__backlogSmokeNativeDrag.lastTarget = event.target instanceof Element ? event.target.getAttribute('data-testid') || event.target.tagName : 'unknown'
    }, true)
    document.addEventListener('mousemove', (event) => {
      window.__backlogSmokeNativeDrag.moves++
      window.__backlogSmokeNativeDrag.lastPoint = { x: event.clientX, y: event.clientY, buttons: event.buttons }
      if (window.__backlogSmokeNativeDrag.moveButtons.length < 32) window.__backlogSmokeNativeDrag.moveButtons.push(event.buttons)
      window.__backlogSmokeNativeDrag.lastTarget = event.target instanceof Element ? event.target.getAttribute('data-testid') || event.target.tagName : 'unknown'
    }, true)
    document.addEventListener('dragstart', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-testid^="kanban-task-"]')) window.__backlogSmokeNativeDrag.starts++
    }, true)
    document.addEventListener('dragenter', (event) => {
      window.__backlogSmokeNativeDrag.enters++
      if (window.__backlogSmokeNativeDrag.dragTargets.length < 12) window.__backlogSmokeNativeDrag.dragTargets.push({ type: 'enter', target: event.target instanceof Element ? event.target.getAttribute('data-testid') || event.target.tagName : 'unknown' })
    }, true)
    document.addEventListener('dragover', (event) => {
      if (window.__backlogSmokeNativeDrag.dragTargets.length < 12) window.__backlogSmokeNativeDrag.dragTargets.push({ type: 'over', target: event.target instanceof Element ? event.target.getAttribute('data-testid') || event.target.tagName : 'unknown' })
    }, true)
    document.addEventListener('drop', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="kanban-column-todo"]')) window.__backlogSmokeNativeDrag.drops++
    }, true)
    document.addEventListener('dragover', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="kanban-column-todo"]')) window.__backlogSmokeNativeDrag.overs++
    }, true)
  })()`)

  const searchTerm = created.identifier.toLowerCase()
  for (const character of searchTerm) {
    win.webContents.sendInputEvent({ type: 'char', keyCode: character })
    await wait(5)
  }
  await runRendererScript(win, 'search exact Backlog task by ID', `(async () => {
    const deadline = Date.now() + 5000
    const card = () => document.querySelector('[data-testid="kanban-task-${created.issueID}"]')
    while (!card() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    const column = document.querySelector('[data-testid="kanban-column-backlog"]')
    if (!card() || !column) throw new Error('Backlog search did not find the disposable issue by ID')
    if ([...column.querySelectorAll('[data-testid^="kanban-task-"]')].length !== 1) throw new Error('Search did not reduce the Backlog column to the exact fixture')
    if (!document.querySelector('[data-testid="kanban-task-${created.issueID}"]')) throw new Error('Search result disappeared before drag')
  })()`)

  await runRendererScript(win, 'clear Backlog search', `document.querySelector('button[aria-label="Clear Backlog search"]')?.click()`)
  const dragPoints = await runRendererScript(win, 'measure native drag source and target', `(() => {
    const card = document.querySelector('[data-testid="kanban-task-${created.issueID}"]')
    const target = document.querySelector('[data-testid="kanban-column-todo"]')
    if (!card || !target) throw new Error('Backlog drag source or Todo drop target is missing')
    card.scrollIntoView({ block: 'center', inline: 'center' })
    const sourceRect = card.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    if (!sourceRect.width || !sourceRect.height || !targetRect.width || !targetRect.height) throw new Error('Backlog drag source or Todo target is not visible')
    return {
      source: { x: Math.round(sourceRect.left + sourceRect.width / 2), y: Math.round(sourceRect.top + sourceRect.height / 2) },
      target: { x: Math.round(targetRect.left + Math.min(targetRect.width - 8, Math.max(8, targetRect.width / 2))), y: Math.round(targetRect.top + Math.min(targetRect.height - 8, Math.max(40, targetRect.height / 2))) },
      targetRect: { left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height },
    }
  })()`)
  const hitProbe = await runRendererScript(win, 'confirm Todo drop target hit-test', `(() => {
    const hit = document.elementFromPoint(${dragPoints.target.x}, ${dragPoints.target.y})
    return { target: hit instanceof Element ? hit.getAttribute('data-testid') || hit.tagName : 'none', todo: !!hit?.closest('[data-testid="kanban-column-todo"]'), viewport: { width: innerWidth, height: innerHeight } }
  })()`)
  console.log('BACKLOG_DRAG_POINTS', JSON.stringify({ ...dragPoints, hitProbe }))

  let dragMechanism = 'Electron sendInputEvent mouse down/move/up'
  if (process.argv.includes('--backlog-orca-drag')) {
    const orca = process.env.ORCHESTRA_SMOKE_ORCA_COMMAND
    if (!orca) throw new Error('--backlog-orca-drag requires ORCHESTRA_SMOKE_ORCA_COMMAND to name the native-window driver')
    const scale = await runRendererScript(win, 'read native-window coordinate scale', 'window.devicePixelRatio || 1')
    const args = [
      'computer', 'drag', '--app', `pid:${process.pid}`,
      '--from-x', String(Math.round(dragPoints.source.x * scale)),
      '--from-y', String(Math.round(dragPoints.source.y * scale)),
      '--to-x', String(Math.round(dragPoints.target.x * scale)),
      '--to-y', String(Math.round(dragPoints.target.y * scale)), '--json',
    ]
    console.log('BACKLOG_ORCA_DRAG', JSON.stringify({ pid: process.pid, scale, args: args.slice(0, 4).concat(args.slice(4)) }))
    let output
    try {
      const orcaEnv = { ...process.env }
      if (process.env.ORCHESTRA_SMOKE_HOST_APPDATA) orcaEnv.APPDATA = process.env.ORCHESTRA_SMOKE_HOST_APPDATA
      if (process.env.ORCHESTRA_SMOKE_HOST_LOCALAPPDATA) orcaEnv.LOCALAPPDATA = process.env.ORCHESTRA_SMOKE_HOST_LOCALAPPDATA
      const windows = execFileSync(orca, ['computer', 'list-windows', '--app', `pid:${process.pid}`, '--json'], { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: orcaEnv })
      console.log('BACKLOG_ORCA_WINDOWS', windows.trim())
      output = execFileSync(orca, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: orcaEnv })
    } catch (error) {
      throw new Error(`Orca native drag failed (exit=${error?.status ?? 'unknown'}): ${String(error?.stdout || '').trim()} ${String(error?.stderr || '').trim()} ${error?.message || ''}`)
    }
    console.log('BACKLOG_ORCA_DRAG_RESULT', output.trim())
    dragMechanism = 'Orca computer drag against the Electron native window'
  } else {
    // Electron's native input bridge can initiate dragstart, but some Windows
    // environments do not retain MouseEvent.buttons across injected moves.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: dragPoints.source.x, y: dragPoints.source.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: dragPoints.source.x, y: dragPoints.source.y, clickCount: 1 })
    await wait(120)
    for (let step = 1; step <= 24; step++) {
      const ratio = step / 24
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        button: 'left',
        modifiers: ['leftMouseButton'],
        x: Math.round(dragPoints.source.x + (dragPoints.target.x - dragPoints.source.x) * ratio),
        y: Math.round(dragPoints.source.y + (dragPoints.target.y - dragPoints.source.y) * ratio),
      })
      await wait(25)
    }
    await wait(150)
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: dragPoints.target.x, y: dragPoints.target.y, clickCount: 1 })
  }

  const nativeDragEvents = await runRendererScript(win, 'verify native pointer drop', `(async () => {
    const deadline = Date.now() + 5000
    const card = () => document.querySelector('[data-testid="kanban-task-${created.issueID}"]')
    while (card() && card().closest('[data-testid="kanban-column-backlog"]') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    const cardElement = card()
    const observed = { ...window.__backlogSmokeNativeDrag, column: cardElement?.closest('[data-testid^="kanban-column-"]')?.getAttribute('data-testid') || 'missing' }
    if (observed.column === 'kanban-column-backlog') throw new Error('Native pointer drag did not move the card out of Backlog; observations=' + JSON.stringify(observed))
    if (!observed.starts || !observed.drops) throw new Error('Electron pointer sequence did not generate browser dragstart and Todo drop events: ' + JSON.stringify(observed))
    return observed
  })()`)

  const state = await runRendererScript(win, 'verify persisted task state and idle worker snapshot', `(async () => {
    const headers = { Authorization: 'Bearer ' + ${JSON.stringify(created.apiToken)} }
    const response = await fetch(${JSON.stringify(created.baseUrl + '/api/v1/issues?project_id=' + encodeURIComponent(created.projectID))}, { headers })
    if (!response.ok) throw new Error('Could not verify the project issue after native drag: ' + response.status)
    const list = await response.json()
    const issue = (list.issues || []).find((candidate) => candidate.identifier === ${JSON.stringify(created.identifier)})
    if (!issue) throw new Error('Persisted project issue list did not contain the dragged task')
    const stateResponse = await fetch(${JSON.stringify(created.baseUrl + '/api/v1/state')}, { headers })
    if (!stateResponse.ok) throw new Error('Could not verify runtime remains idle after native drag')
    const snapshot = await stateResponse.json()
    const running = snapshot.running || []
    const retrying = snapshot.retrying || []
    return { state: issue.state, assignedToWorker: issue.assigned_to_worker, runningForFixture: running.some((entry) => entry.issue_id === issue.id || entry.issue_identifier === issue.identifier), retryingForFixture: retrying.some((entry) => entry.issue_id === issue.id || entry.issue_identifier === issue.identifier), identifier: issue.identifier }
  })()`)

  if (state.state !== 'Todo') throw new Error(`Native drag persisted ${state.state} instead of Todo`)
  if (state.assignedToWorker !== false || state.runningForFixture || state.retryingForFixture) throw new Error('Disposable Backlog fixture unexpectedly became worker-eligible or entered agent execution')

  fs.writeFileSync(require('node:path').join(fixture, 'backlog-kanban-audit.json'), JSON.stringify({
    kind: 'electron-native-pointer-drag',
    searchTerm,
    exactBacklogSearch: true,
    nativeDragStartCount: nativeDragEvents.starts,
    nativeDropCount: nativeDragEvents.drops,
    persistedState: state.state,
    assignedToWorkerClassification: state.assignedToWorker,
    runningForFixture: state.runningForFixture,
    retryingForFixture: state.retryingForFixture,
  }, null, 2))

  return {
    searchByTaskID: true,
    multiTokenSearchUI: 'exercised in focused Vitest suite',
    dragMechanism,
    nativeDragStartCount: nativeDragEvents.starts,
    nativeDropCount: nativeDragEvents.drops,
    persistedState: state.state,
    noAgentExecution: state.assignedToWorker === false && !state.runningForFixture && !state.retryingForFixture && !created.projectIssueSourceType && !created.projectTrackerConfigID,
    assignedToWorkerClassification: state.assignedToWorker,
    projectIssueSourceType: created.projectIssueSourceType,
    disposableProjectID: created.projectID,
    issueIdentifier: state.identifier,
  }
}

module.exports = { auditBacklogKanban }
