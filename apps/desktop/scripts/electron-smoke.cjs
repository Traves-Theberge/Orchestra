// Exercise the production renderer, preload bridge and managed backend in Electron.
// Launch with electron scripts/electron-smoke.cjs after building both applications.
const { app, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const hostOrcaRuntimeEnvironment = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA }

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-electron-smoke-'))
app.setPath('userData', path.join(fixture, 'desktop'))
process.env.ORCHESTRA_MANAGED_BACKEND = '1'
process.env.ORCHESTRA_SERVER_PORT = '4110'
// This run is intentionally incapable of dispatching its Backlog fixture: the
// only recognized worker identity is a synthetic allowlist entry, while the
// audit task uses a distinct person-smoke-* assignee.
process.env.ORCHESTRA_TRACKER_WORKER_ASSIGNEE_IDS = 'agent-fixture-codex'
delete process.env.VITE_DEV_SERVER_URL
const errors = []
fs.mkdirSync(path.join(fixture, 'home'), { recursive: true })
process.env.HOME = path.join(fixture, 'home')
process.env.USERPROFILE = path.join(fixture, 'home')
for (const [key, directory] of Object.entries({ APPDATA: 'appdata', LOCALAPPDATA: 'localappdata', TEMP: 'tmp', TMP: 'tmp', CODEX_HOME: 'home/.codex', CLAUDE_CONFIG_DIR: 'home/.claude', XDG_CONFIG_HOME: 'home/.config', XDG_DATA_HOME: 'home/.local', XDG_CACHE_HOME: 'home/.cache' })) {
  process.env[key] = path.join(fixture, directory)
  fs.mkdirSync(process.env[key], { recursive: true })
}
const workspaceAudit = process.argv.includes('--workspace-controls')
const backlogOnlyAudit = process.argv.includes('--backlog-only')
const prVisualAudit = process.argv.includes('--pr-visual-fixture')
if (workspaceAudit) {
  const projectsRoot = path.join(fixture, 'projects')
  fs.mkdirSync(projectsRoot, { recursive: true })
  process.env.ORCHESTRA_PROJECT_ROOTS = [projectsRoot, path.join(fixture, 'desktop', 'workspaces')].join(',')
  const gitConfig = path.join(fixture, 'empty-gitconfig')
  fs.writeFileSync(gitConfig, '')
  process.env.GIT_CONFIG_GLOBAL = gitConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.ORCHESTRA_TELEMETRY_PROVIDERS = 'none'
}
let complete = false
const timeout = setTimeout(() => finish(new Error('Electron smoke timed out')), workspaceAudit ? 180_000 : 45_000)

// Production startup errors normally use a modal dialog. Preserve that error
// as a failed smoke instead of blocking a hidden run or exiting successfully.
dialog.showErrorBox = (title, message) => finish(new Error(`${title}: ${message}`))
app.on('will-quit', () => {
  if (!complete) {
    complete = true
    console.error('ELECTRON_SMOKE_FAILED', 'Electron quit before smoke assertions completed', fixture)
    process.exitCode = 1
    app.exit(1)
  }
})

function finish(error) {
  if (complete) return
  complete = true
  clearTimeout(timeout)
  if (error) {
    console.error('ELECTRON_SMOKE_FAILED', error.message, JSON.stringify(errors))
    process.exitCode = 1
  } else console.log('ELECTRON_SMOKE_PASSED', fixture)
  app.once('will-quit', () => app.exit(error ? 1 : 0))
  app.quit()
}

app.on('browser-window-created', (_, win) => {
  win.hide()
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('render-process-gone', (_, details) => finish(new Error(details.reason)))
  win.webContents.on('did-fail-load', (_, code, description) => finish(new Error(`${code}: ${description}`)))
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 15000
        while (!document.querySelector('[data-testid="sidebar-nav-ISSUES"], [data-testid="sidebar-back"], [aria-label="Back to navigation"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
        // Fresh profiles open the Console workspace drilldown. Exercise its back
        // action before requiring primary navigation; neither view is a boot failure.
        document.querySelector('[data-testid="sidebar-back"], [aria-label="Back to navigation"]')?.click()
        while (!document.querySelector('[data-testid="sidebar-nav-ISSUES"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
        if (!document.querySelector('[data-testid="sidebar-nav-ISSUES"]')) throw new Error('Renderer did not mount')
        const config = await window.orchestraDesktop.getBackendConfig()
        const response = await fetch(config.baseUrl + '/api/v1/state', { headers: { Authorization: 'Bearer ' + config.apiToken } })
        if (!response.ok) throw new Error('Backend state returned ' + response.status)
        const state = await response.json()
        const brokenImages = Array.from(document.images).filter(image => image.complete && image.naturalWidth === 0).map(image => image.getAttribute('src'))
        if (brokenImages.length) throw new Error('Broken local images: ' + brokenImages.join(', '))
        return { bridge: true, state: Boolean(state.counts), title: document.title }
      })()`)
      if (!result.bridge || !result.state) throw new Error('Missing bridge or state')
      if (prVisualAudit) await require('./pr-visual-audit.cjs').installPRVisualFixture(win)
      if (workspaceAudit && !backlogOnlyAudit) {
        const workspaceResult = await win.webContents.executeJavaScript(`(async () => {
          const wait = async (predicate, name) => {
            const deadline = Date.now() + 15000
            while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75))
            if (!predicate()) throw new Error('Workspace audit timed out waiting for ' + name)
          }
          const button = name => [...document.querySelectorAll('button, [role="button"]')].find(element => element.getAttribute('aria-label') === name || element.textContent.trim() === name)
          document.querySelector('[data-testid="sidebar-nav-PROJECTS"]').click()
          await wait(() => button('Add project'), 'Add project control')
          button('Add project').click()
          await wait(() => document.querySelector('[role="option"]'), 'project source list')
          const source = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.includes('New project'))
          if (!source) throw new Error('New project source missing')
          source.click()
          await wait(() => [...document.querySelectorAll('label')].some(element => element.textContent === 'Project name'), 'new project form')
          const setInput = (label, value) => {
            const controlLabel = [...document.querySelectorAll('label')].find(element => element.textContent === label)
            const input = controlLabel && document.getElementById(controlLabel.htmlFor)
            if (!input) throw new Error('Missing ' + label)
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
          setInput('Project name', 'Workspace audit')
          setInput('Parent folder', ${JSON.stringify(path.join(fixture, 'projects'))})
          await wait(() => button('Create project') && !button('Create project').disabled, 'enabled Create project control')
          button('Create project').click()
          await wait(() => {
            const failure = document.querySelector('[role="dialog"] [role="alert"]')
            if (failure) throw new Error('Project creation: ' + failure.textContent)
            return document.querySelector('[role="tab"][aria-selected="true"]') && !document.querySelector('[role="dialog"]')
          }, 'project workspace to open')
          const chat = document.querySelector('[aria-label="Workspace chat pane"]')
          if (!chat || chat.getBoundingClientRect().width <= 0) throw new Error('Project did not open its workspace')
          button('Expand Workspace audit')?.click()
          await wait(() => button('Open Workspace audit workspace main'), 'primary workspace card')
          button('Files & terminals').click()
          const filesToggle = button('Toggle workspace files')
          if (filesToggle?.getAttribute('aria-pressed') !== 'true') filesToggle.click()
          await wait(() => document.querySelector('[aria-label="Workspace file sidebar"], [aria-label="Workspace files view"]'), 'initial file viewer')
          if (!document.querySelector('[aria-label="Workspace files view"] [role="tree"]')) throw new Error('Full-pane file viewer did not expose the workspace tree')
          button('Close workspace file sidebar').click()
          await wait(() => button('Maximize workspace tools'), 'maximize workspace tools control')
          const tools = document.querySelector('[aria-label="Workspace tools"]')
          const originalChat = chat
          button('Maximize workspace tools').click()
          await wait(() => tools.dataset.maximized === 'true', 'maximized workspace tools')
          const containerWidth = tools.parentElement.getBoundingClientRect().width
          if (tools.getBoundingClientRect().width < containerWidth - 2 || getComputedStyle(chat).display !== 'none') throw new Error('Workspace tools did not expand across the workspace')
          button('Restore workspace tools').click()
          await wait(() => tools.dataset.maximized === 'false', 'restored workspace tools')
          if (document.querySelector('[aria-label="Workspace chat pane"]') !== originalChat) throw new Error('Maximize remounted chat')
          button('Git & pull requests').click()
          await wait(() => document.querySelector('[role="tabpanel"][aria-label="Git & pull requests"]'), 'Git review panel')
          if (chat.getBoundingClientRect().width <= 0) throw new Error('Git review hides workspace chat')
          if (button('Create with AI')) throw new Error('Legacy AI creation journey remains')
          return { projectSource: 'new', workspaceOpened: true, primaryWorktreeObserved: true, fullPaneFilesOpened: true, maximized: true, chatRetained: true, gitAlongsideChat: true }
        })()`)
        console.log('WORKSPACE_CONTROLS_SMOKE_RESULT', JSON.stringify(workspaceResult))
        if (!backlogOnlyAudit) console.log('MULTI_WORKTREE_SMOKE_RESULT', JSON.stringify(await require('./multi-worktree-audit.cjs').auditMultiWorktree(win, fixture)))
      }
      if (workspaceAudit && backlogOnlyAudit) {
        await win.webContents.executeJavaScript(`(async () => {
          const wait = async (predicate, name) => {
            const deadline = Date.now() + 15000
            while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75))
            if (!predicate()) throw new Error('Backlog setup timed out waiting for ' + name)
          }
          const button = name => [...document.querySelectorAll('button, [role="button"]')].find(element => element.getAttribute('aria-label') === name || element.textContent.trim() === name)
          document.querySelector('[data-testid="sidebar-nav-PROJECTS"]').click()
          await wait(() => button('Add project'), 'Add project control')
          button('Add project').click()
          await wait(() => document.querySelector('[role="option"]'), 'project source list')
          const source = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.includes('New project'))
          if (!source) throw new Error('New project source missing')
          source.click()
          await wait(() => [...document.querySelectorAll('label')].some(element => element.textContent === 'Project name'), 'new project form')
          const setInput = (label, value) => {
            const controlLabel = [...document.querySelectorAll('label')].find(element => element.textContent === label)
            const input = controlLabel && document.getElementById(controlLabel.htmlFor)
            if (!input) throw new Error('Missing ' + label)
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
          setInput('Project name', 'Workspace audit')
          setInput('Parent folder', ${JSON.stringify(path.join(fixture, 'projects'))})
          await wait(() => button('Create project') && !button('Create project').disabled, 'enabled Create project control')
          button('Create project').click()
          await wait(() => document.querySelector('[role="tab"][aria-selected="true"]') && !document.querySelector('[role="dialog"]'), 'project workspace')
          const back = document.querySelector('[data-testid="sidebar-back"]')
          if (!back) throw new Error('Backlog setup could not return from the new workspace')
          back.click()
          await wait(() => document.querySelector('[data-testid="sidebar-nav-ISSUES"]'), 'Tasks navigation')
        })()`)
      }
      if (prVisualAudit) console.log('PR_VISUAL_FIXTURE_RESULT', JSON.stringify(await require('./pr-visual-audit.cjs').auditPRVisual(win, path.join(__dirname, '..', 'reports'))))
      if (workspaceAudit) {
        const tasksView = await win.webContents.executeJavaScript(`(async () => {
          const wait = async (predicate, name) => {
            const deadline = Date.now() + 10000
            while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75))
            if (!predicate()) throw new Error('Tasks header capture timed out: ' + name)
          }
          const back = document.querySelector('[data-testid="sidebar-back"]')
          if (back) back.click()
          await wait(() => document.querySelector('[data-testid="sidebar-nav-ISSUES"]'), 'Tasks navigation')
          const tasks = document.querySelector('[data-testid="sidebar-nav-ISSUES"]')
          tasks.click()
          await wait(() => document.querySelector('[data-testid="sidebar-nav-ISSUES"]')?.getAttribute('aria-current') === 'page', 'Tasks section active')
          const createTask = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Create Task')
          const boardTab = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Board')
          const workItemsTab = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Work Items')
          if (!createTask || !boardTab || !workItemsTab) throw new Error('Tasks unified toolbar is incomplete')
          const headerBounds = createTask.parentElement.getBoundingClientRect()
          return { section: 'Tasks', unifiedToolbarVisible: true, boardTab: true, workItemsTab: true, createTask: true, headerBounds: { top: headerBounds.top, bottom: headerBounds.bottom } }
        })()`)
        const tasksScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        if (tasksScreenshot.isEmpty()) throw new Error('Electron returned an empty Tasks header screenshot')
        const reportDir = path.join(__dirname, '..', 'reports')
        fs.mkdirSync(reportDir, { recursive: true })
        fs.writeFileSync(path.join(fixture, 'tasks-header.png'), tasksScreenshot.toPNG())
        fs.writeFileSync(path.join(reportDir, 'electron-smoke-tasks-header.png'), tasksScreenshot.toPNG())
        console.log('TASKS_HEADER_SCREENSHOT_RESULT', JSON.stringify(tasksView))
        if (hostOrcaRuntimeEnvironment.APPDATA) process.env.ORCHESTRA_SMOKE_HOST_APPDATA = hostOrcaRuntimeEnvironment.APPDATA
        if (hostOrcaRuntimeEnvironment.LOCALAPPDATA) process.env.ORCHESTRA_SMOKE_HOST_LOCALAPPDATA = hostOrcaRuntimeEnvironment.LOCALAPPDATA
        console.log('BACKLOG_KANBAN_AUDIT_RESULT', JSON.stringify(await require('./backlog-kanban-audit.cjs').auditBacklogKanban(win, fixture)))
      }
      console.log('ELECTRON_SMOKE_RESULT', JSON.stringify(result))
      const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (screenshot.isEmpty()) throw new Error('Electron returned an empty launch screenshot')
      fs.writeFileSync(path.join(fixture, 'launch.png'), screenshot.toPNG())
      const reports = path.join(__dirname, '..', 'reports')
      fs.mkdirSync(reports, { recursive: true })
      fs.writeFileSync(path.join(reports, 'electron-smoke-launch.png'), screenshot.toPNG())
      if (errors.length) throw new Error('Renderer logged errors')
      finish()
    } catch (error) {
      try {
        console.error('ELECTRON_SMOKE_RENDERER_DIAGNOSTIC', JSON.stringify(await win.webContents.executeJavaScript(`({ testIds: [...document.querySelectorAll('[data-testid]')].map(element => element.dataset.testid).slice(0, 30), controls: [...document.querySelectorAll('button')].map(element => element.getAttribute('aria-label') || element.textContent.trim()).slice(0, 25) })`)))
        const failureScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        fs.writeFileSync(path.join(fixture, 'failure.png'), failureScreenshot.toPNG())
      } catch { /* Preserve the original failure when the renderer is unavailable. */ }
      finish(error)
    }
  })
})

if (process.argv.includes('--fail-before-checks')) app.whenReady().then(() => app.quit())
else require('../electron/main.cjs')
