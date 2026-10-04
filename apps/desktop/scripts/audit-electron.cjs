// Configure the audit identity before loading the real production main module.
const { app, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const childProcess = require('node:child_process')
const { stopManagedBackendChild } = require('../electron/managed-backend.cjs')

const root = process.env.ORCHESTRA_AUDIT_ROOT
if (!root || !path.isAbsolute(root)) throw new Error('Absolute ORCHESTRA_AUDIT_ROOT required')
// Direct bootstrap invocation also needs real known-folder targets for dialogs.
for (const directory of ['desktop', 'home', 'roaming', 'local', 'tmp', ...['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos'].map(name => path.join('home', name))]) fs.mkdirSync(path.join(root, directory), { recursive: true })
app.setPath('userData', path.join(root, 'desktop'))
const currentProviderContext = process.env.ORCHESTRA_AUDIT_CURRENT_PROVIDER_CONTEXT === '1'
if (currentProviderContext && process.env.ORCHESTRA_AUDIT_SMOKE === '1') throw new Error('Automated smoke requires isolated provider context')
app.setName(currentProviderContext ? 'Orchestra Local' : 'Orchestra Audit')
// Native pickers should start at the real user's files, while provider processes
// and application storage retain the isolated profile. Preserve explicit paths.
const browseRoot = process.env.ORCHESTRA_AUDIT_BROWSE_ROOT
if (browseRoot) {
  if (!path.isAbsolute(browseRoot) || !fs.statSync(browseRoot).isDirectory()) throw new Error('Audit browse root must be an existing absolute directory')
  const showOpenDialog = dialog.showOpenDialog.bind(dialog)
  dialog.showOpenDialog = (...args) => {
    const index = args.length - 1
    args[index] = { defaultPath: browseRoot, ...args[index] }
    return showOpenDialog(...args)
  }
  console.log('AUDIT_BROWSE_ROOT', browseRoot)
}
if (!currentProviderContext) Object.assign(process.env, { HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), ORCHESTRA_MANAGED_BACKEND: '1' })
process.env.ORCHESTRA_MANAGED_BACKEND = '1'
const smoke = process.env.ORCHESTRA_AUDIT_SMOKE === '1'
let ownedBackend
let quitting = false
let checksComplete = false
let exitCode = 0
let timeout
const spawn = childProcess.spawn
// Script-local observation lets us await owned daemon settlement on window close.
childProcess.spawn = function (command, args, options) {
  const child = spawn.call(this, command, args, options)
  if (command === process.env.ORCHESTRA_BACKEND_BIN && args?.[0] === 'start') ownedBackend = child
  return child
}

function fail(message) {
  console.error('AUDIT_STARTUP_FAILED', message)
  exitCode = 1
  app.quit()
}
dialog.showErrorBox = (title, message) => fail(`${title}: ${message}`)
app.on('before-quit', event => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  if (!checksComplete) { console.error('AUDIT_STARTUP_FAILED', 'Audit quit before readiness checks completed'); exitCode = 1 }
  clearTimeout(timeout)
  // The production main's listener starts its own stop during this same event.
  // Defer until that listener ran, then observe settlement rather than issuing
  // a second concurrent SIGTERM (which Windows can reject after the first).
  queueMicrotask(async () => {
    try {
      if (ownedBackend?.killed && ownedBackend.exitCode === null && ownedBackend.signalCode === null) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Owned backend did not settle during quit')), 4000)
          ownedBackend.once('exit', () => { clearTimeout(timer); resolve() })
        })
      } else await stopManagedBackendChild(ownedBackend)
    } catch (error) { console.error('AUDIT_STOP_FAILED', error.message); exitCode = 1 }
    app.exit(exitCode)
  })
})

app.on('browser-window-created', (_, win) => {
  if (smoke) { win.hide(); win.webContents.setBackgroundThrottling(false) }
  win.webContents.on('did-fail-load', (_, code, reason) => fail(`Renderer load ${code}: ${reason}`))
  win.webContents.on('render-process-gone', (_, details) => fail(`Renderer exited: ${details.reason}`))
  win.webContents.once('did-finish-load', async () => {
    try {
      const expectedPort = Number(process.env.ORCHESTRA_SERVER_PORT)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 20000
        while (!document.querySelector('[data-testid="sidebar-nav-ISSUES"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
        if (!document.querySelector('[data-testid="sidebar-nav-ISSUES"]')) throw new Error('Renderer did not mount')
        const config = await window.orchestraDesktop.getBackendConfig()
        const response = await fetch(config.baseUrl + '/api/v1/state', { headers: { Authorization: 'Bearer ' + config.apiToken } })
        if (!response.ok) throw new Error('Authenticated backend state returned ' + response.status)
        const state = await response.json()
        return { mounted: true, state: Boolean(state.counts), baseUrl: config.baseUrl }
      })()`)
      if (!result.state || new URL(result.baseUrl).port !== String(expectedPort)) throw new Error('Backend identity/port differed from the owned audit launch')
      console.log('AUDIT_READY', JSON.stringify({ ...result, profile: root, providerContext: currentProviderContext ? 'current-user' : 'isolated', providerHome: process.env.USERPROFILE || process.env.HOME }))
      checksComplete = true
      clearTimeout(timeout)
      if (smoke) app.quit()
    } catch (error) { fail(error.message) }
  })
})

// Managed main normally searches for another available port. Audit setup refuses
// that behavior and checks again immediately before loading the real main.
const port = Number(process.env.ORCHESTRA_SERVER_PORT)
const server = net.createServer()
server.once('error', error => fail(`Audit backend port ${port} unavailable: ${error.code}`))
server.listen({ host: '127.0.0.1', port }, () => server.close(() => {
  if (!process.env.ORCHESTRA_BACKEND_BIN || !fs.existsSync(process.env.ORCHESTRA_BACKEND_BIN)) { fail('Native backend binary missing'); return }
  timeout = setTimeout(() => { if (!checksComplete) fail('Native audit readiness timed out') }, 60_000)
  require('../electron/main.cjs')
}))
