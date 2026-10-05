// Exercise the production renderer, preload bridge and managed backend in Electron.
// Launch with electron scripts/electron-smoke.cjs after building both applications.
const { app, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestra-electron-smoke-'))
app.setPath('userData', path.join(fixture, 'desktop'))
process.env.ORCHESTRA_MANAGED_BACKEND = '1'
process.env.ORCHESTRA_SERVER_PORT = '4110'
delete process.env.VITE_DEV_SERVER_URL
const errors = []
fs.mkdirSync(path.join(fixture, 'home'), { recursive: true })
process.env.HOME = path.join(fixture, 'home')
process.env.USERPROFILE = path.join(fixture, 'home')
let complete = false
const timeout = setTimeout(() => finish(new Error('Electron smoke timed out')), 45_000)

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
        while (!document.querySelector('[data-testid="sidebar-nav-ISSUES"], [data-testid="sidebar-back"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
        // Fresh profiles open the Console workspace drilldown. Exercise its back
        // action before requiring primary navigation; neither view is a boot failure.
        document.querySelector('[data-testid="sidebar-back"]')?.click()
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
      console.log('ELECTRON_SMOKE_RESULT', JSON.stringify(result))
      const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (screenshot.isEmpty()) throw new Error('Electron returned an empty launch screenshot')
      fs.writeFileSync(path.join(fixture, 'launch.png'), screenshot.toPNG())
      const reports = path.join(__dirname, '..', 'reports')
      fs.mkdirSync(reports, { recursive: true })
      fs.writeFileSync(path.join(reports, 'electron-smoke-launch.png'), screenshot.toPNG())
      if (errors.length) throw new Error('Renderer logged errors')
      finish()
    } catch (error) { finish(error) }
  })
})

if (process.argv.includes('--fail-before-checks')) app.whenReady().then(() => app.quit())
else require('../electron/main.cjs')
