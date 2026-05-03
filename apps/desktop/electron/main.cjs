const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu } = require('electron')
const { openOAuthWindow } = require('./oauth-handler.cjs')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const crypto = require('node:crypto')
const net = require('node:net')
const { spawn } = require('node:child_process')

let managedBackendState = null

function backendBinaryName() {
  return process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad'
}

function backendTargetKey() {
  return `${process.platform}-${process.arch}`
}

function newestExistingPath(candidates) {
  let newest = ''
  let newestMtime = -1

  for (const candidate of candidates) {
    if (!candidate || !fsSync.existsSync(candidate)) {
      continue
    }
    try {
      const stats = fsSync.statSync(candidate)
      const mtime = stats.mtimeMs || 0
      if (mtime >= newestMtime) {
        newest = candidate
        newestMtime = mtime
      }
    } catch {
      // Ignore unreadable candidates and continue evaluating other paths.
    }
  }

  return newest
}

function resolveManagedBackendBinaryPath() {
  const overridePath = process.env.ORCHESTRA_BACKEND_BIN
  if (overridePath && fsSync.existsSync(overridePath)) {
    return overridePath
  }

  const binaryName = backendBinaryName()
  const targetKey = backendTargetKey()

  const packagedPath = path.join(process.resourcesPath, 'backend', targetKey, binaryName)
  const devCandidates = [
    path.join(__dirname, '..', '..', 'backend', binaryName),
    path.join(__dirname, '..', '..', 'backend', 'dist', 'orchestra', binaryName),
    path.join(__dirname, '..', 'resources', 'backend', targetKey, binaryName),
  ]

  if (app.isPackaged) {
    return fsSync.existsSync(packagedPath) ? packagedPath : ''
  }

  return newestExistingPath(devCandidates)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findAvailablePort(startPort, maxAttempts = 50) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const nextPort = startPort + offset
    if (await isPortAvailable(nextPort)) {
      return nextPort
    }
  }
  throw new Error(`unable to find available port after ${maxAttempts} attempts from ${startPort}`)
}

async function waitForManagedBackendReady(baseUrl, token, child, timeoutMs = 20000) {
  const started = Date.now()
  let lastError = 'no response yet'

  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited with code ${child.exitCode}`)
    }

    try {
      const response = await fetch(new URL('/api/v1/state', baseUrl), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        return
      }

      lastError = `status ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await wait(250)
  }

  throw new Error(`managed backend health check timed out: ${lastError}`)
}

async function startManagedBackend() {
  const explicitToggle = process.env.ORCHESTRA_MANAGED_BACKEND
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const shouldRun = explicitToggle === '1' || (explicitToggle !== '0' && !devServerUrl)
  if (!shouldRun) {
    return null
  }

  const backendBin = resolveManagedBackendBinaryPath()
  if (!backendBin) {
    if (app.isPackaged) {
      throw new Error(`unable to locate bundled backend binary for ${backendTargetKey()}`)
    }
    console.warn('Managed backend disabled: orchestrad binary not found in development mode')
    return null
  }
  console.log(`[orchestra-desktop] selected backend binary: ${backendBin}`)

  const preferredPort = Number.parseInt(process.env.ORCHESTRA_SERVER_PORT || '4010', 10)
  const port = Number.isFinite(preferredPort) && preferredPort > 0 ? await findAvailablePort(preferredPort) : await findAvailablePort(4010)
  const token = crypto.randomBytes(24).toString('hex')
  const workspaceRoot = path.join(app.getPath('userData'), 'workspaces')
  await fs.mkdir(workspaceRoot, { recursive: true })

  const child = spawn(backendBin, ['start'], {
    cwd: path.dirname(backendBin),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      LANG: process.env.LANG,
      ORCHESTRA_SERVER_HOST: '127.0.0.1',
      ORCHESTRA_SERVER_PORT: String(port),
      ORCHESTRA_WORKSPACE_ROOT: workspaceRoot,
      ORCHESTRA_API_TOKEN: token,
      ORCHESTRA_TOKEN_KEY: process.env.ORCHESTRA_TOKEN_KEY,
    },
  })

  const maskToken = (text) => text.replaceAll(token, '****')
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[orchestrad] ${maskToken(chunk.toString())}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[orchestrad] ${maskToken(chunk.toString())}`)
  })

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForManagedBackendReady(baseUrl, token, child)

  return {
    child,
    config: {
      baseUrl,
      apiToken: token,
    },
  }
}

async function stopManagedBackend() {
  const child = managedBackendState?.child
  if (!child || child.killed || child.exitCode !== null) {
    managedBackendState = null
    return
  }

  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    child.once('exit', finish)
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL')
        finish()
      }
    }, 1200)
  })

  managedBackendState = null
}

// GPU enabled for WebGPU (Transformers.js Whisper inference)
// Use WebGPU without forcing Vulkan — Vulkan can crash the renderer on Wayland
app.commandLine.appendSwitch('enable-features', 'WebGPU')
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
// Disable GBM DMA-BUF scanout path — fails on some Wayland + GPU driver combos
// when moving/resizing the window across monitors (EINVAL from gbm_wrapper.cc).
// Disabling these features keeps hardware acceleration while avoiding the BO
// modifier negotiation that triggers the crash.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'UseDMABufVideoDecoder,WaylandWindowDecorations')
}

function createDefaultProfile() {
  const managed = managedBackendState?.config
  return {
    id: 'default',
    name: 'Default',
    baseUrl: managed?.baseUrl || process.env.ORCHESTRA_BASE_URL || 'http://127.0.0.1:4010',
    apiToken: managed?.apiToken || process.env.ORCHESTRA_API_TOKEN || '',
  }
}

function normalizeProfile(raw, fallbackId, fallbackName) {
  const id = typeof raw?.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : fallbackId
  const name = typeof raw?.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : fallbackName
  const baseUrl = typeof raw?.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim() : createDefaultProfile().baseUrl
  const apiToken = typeof raw?.apiToken === 'string' ? raw.apiToken.trim() : ''
  return { id, name, baseUrl, apiToken }
}

function ensureProfilesState(value) {
  const profilesRaw = Array.isArray(value?.profiles) ? value.profiles : []
  const profiles = profilesRaw.map((entry, index) => normalizeProfile(entry, `profile-${index + 1}`, `Profile ${index + 1}`))

  if (profiles.length === 0) {
    const fallback = createDefaultProfile()
    return {
      activeProfileId: fallback.id,
      profiles: [fallback],
    }
  }

  const activeProfileId =
    typeof value?.activeProfileId === 'string' && profiles.some((profile) => profile.id === value.activeProfileId)
      ? value.activeProfileId
      : profiles[0].id

  return { activeProfileId, profiles }
}

let backendProfilesState = ensureProfilesState({
  activeProfileId: 'default',
  profiles: [createDefaultProfile()],
})

let agentTokens = {}

function tokensFilePath() {
  return path.join(app.getPath('userData'), 'agent-tokens.json')
}

async function persistTokens() {
  const file = tokensFilePath()
  const encrypted = {}
  for (const [key, value] of Object.entries(agentTokens)) {
    if (safeStorage.isEncryptionAvailable()) {
      encrypted[key] = safeStorage.encryptString(value).toString('base64')
    } else {
      console.warn('WARNING: safeStorage encryption unavailable — skipping token persistence for', key)
      continue
    }
  }
  await fs.writeFile(file, JSON.stringify(encrypted, null, 2), 'utf-8')
}

async function loadTokens() {
  try {
    const raw = await fs.readFile(tokensFilePath(), 'utf-8')
    const encrypted = JSON.parse(raw)
    for (const [key, value] of Object.entries(encrypted)) {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          agentTokens[key] = safeStorage.decryptString(Buffer.from(value, 'base64'))
        } catch {
          agentTokens[key] = ''
        }
      } else {
        agentTokens[key] = value
      }
    }
  } catch {
    agentTokens = {}
  }
}

function stateFilePath() {
  return path.join(app.getPath('userData'), 'backend-profiles.json')
}

function getActiveProfile() {
  return backendProfilesState.profiles.find((profile) => profile.id === backendProfilesState.activeProfileId) || backendProfilesState.profiles[0]
}

function getProfilesPayload() {
  return {
    activeProfileId: backendProfilesState.activeProfileId,
    profiles: backendProfilesState.profiles,
  }
}

async function persistProfilesState() {
  const file = stateFilePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(getProfilesPayload(), null, 2), 'utf-8')
}

async function loadProfilesState() {
  try {
    const raw = await fs.readFile(stateFilePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    backendProfilesState = ensureProfilesState(parsed)
  } catch {
    backendProfilesState = ensureProfilesState(getProfilesPayload())
    await persistProfilesState()
  }
}

function applyManagedBackendProfile() {
  if (!managedBackendState?.config) {
    return
  }

  const managed = managedBackendState.config
  let hasDefault = false

  const profiles = backendProfilesState.profiles.map((profile) => {
    if (profile.id !== 'default') {
      return profile
    }
    hasDefault = true
    return {
      ...profile,
      baseUrl: managed.baseUrl,
      apiToken: managed.apiToken,
    }
  })

  const nextProfiles = hasDefault
    ? profiles
    : [
        {
          id: 'default',
          name: 'Default',
          baseUrl: managed.baseUrl,
          apiToken: managed.apiToken,
        },
        ...profiles,
      ]

  const nextActive = backendProfilesState.activeProfileId || 'default'
  backendProfilesState = ensureProfilesState({
    activeProfileId: nextActive,
    profiles: nextProfiles,
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Orchestra Desktop',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true, // Hide the File/Edit/View menu bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  })

  // Remove the menu entirely for a cleaner look
  Menu.setApplicationMenu(null)

  // Enforce Content Security Policy on all responses
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // In dev mode, Vite injects inline scripts for React fast refresh preamble
    const scriptSrc = isDev ? "'self' 'unsafe-inline'" : "'self'"
    // Allow connections to backend (loopback) and LLM provider APIs for
    // the embedded agent model listing and inference.
    const providerAPIs = [
      'https://openrouter.ai',
      'https://api.openai.com',
      'https://api.anthropic.com',
      'https://generativelanguage.googleapis.com',
      // Whisper voice model assets (downloaded once, cached in IndexedDB)
      'https://huggingface.co',
      'https://cdn-lfs.huggingface.co',
      'https://cas-bridge.xethub.hf.co',
      // react-grab dev tool version manifest (dev only)
      'https://www.react-grab.com',
    ].join(' ')
    // Google Fonts (used by some embedded panels) — split host for stylesheet vs files
    const fontStyleHosts = 'https://fonts.googleapis.com'
    const fontFileHosts = 'https://fonts.gstatic.com'
    const connectSrc = isDev
      ? `'self' http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:* ${providerAPIs}`
      : `'self' http://127.0.0.1:* ws://127.0.0.1:* ${providerAPIs}`
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          `script-src ${scriptSrc}; ` +
          `style-src 'self' 'unsafe-inline' ${fontStyleHosts}; ` +
          "img-src 'self' data: blob:; " +
          `font-src 'self' ${fontFileHosts}; ` +
          `connect-src ${connectSrc}; ` +
          "media-src 'self' blob:; " +
          "worker-src 'self' blob:"
        ],
      },
    })
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('did-fail-load', { code, description, url })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone', details)
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(0)
  })

  // Intercept Ctrl+1-8 before Chromium consumes them, and wire F12 / Ctrl+Shift+I
  // for DevTools (since the menu has been removed).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    // F12 → toggle DevTools
    if (input.key === 'F12' && !input.control && !input.meta && !input.alt && !input.shift) {
      event.preventDefault()
      win.webContents.toggleDevTools()
      return
    }

    // Ctrl+Shift+I / Cmd+Opt+I → toggle DevTools
    if (input.shift && (input.control || input.meta) && (input.key === 'I' || input.key === 'i')) {
      event.preventDefault()
      win.webContents.toggleDevTools()
      return
    }

    // Ctrl+R / Cmd+R → reload
    if ((input.control || input.meta) && !input.shift && !input.alt && (input.key === 'R' || input.key === 'r')) {
      event.preventDefault()
      win.webContents.reload()
      return
    }

    // Ctrl+1..8 → switch tab
    if ((input.control || input.meta) && !input.alt && !input.shift) {
      const num = parseInt(input.key, 10)
      if (!isNaN(num) && num >= 1 && num <= 8) {
        event.preventDefault()
        win.webContents.send('orchestra:switch-tab', num)
      }
    }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
    // Auto-open DevTools in dev mode for easier debugging
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('orchestra:get-agent-tokens', () => {
  const publicTokens = {}
  for (const key of Object.keys(agentTokens)) {
    publicTokens[key] = '********'
  }
  return publicTokens
})

ipcMain.handle('orchestra:set-agent-token', async (_event, { name, value }) => {
  if (!name) throw new Error('token name required')
  if (value === undefined || value === null) {
    delete agentTokens[name]
  } else {
    agentTokens[name] = value
  }
  await persistTokens()
  return true
})

ipcMain.handle('orchestra:get-backend-config', () => {
  const active = getActiveProfile()
  return { baseUrl: active.baseUrl, apiToken: active.apiToken, agentTokensCount: Object.keys(agentTokens).length }
})

ipcMain.handle('orchestra:set-backend-config', async (_event, nextConfig) => {
  const baseUrl = typeof nextConfig?.baseUrl === 'string' ? nextConfig.baseUrl.trim() : ''
  const apiToken = typeof nextConfig?.apiToken === 'string' ? nextConfig.apiToken.trim() : ''
  if (!baseUrl) {
    throw new Error('baseUrl is required')
  }

  backendProfilesState = ensureProfilesState({
    activeProfileId: backendProfilesState.activeProfileId,
    profiles: backendProfilesState.profiles.map((profile) =>
      profile.id === backendProfilesState.activeProfileId
        ? { ...profile, baseUrl, apiToken }
        : profile,
    ),
  })

  await persistProfilesState()
  return { baseUrl, apiToken }
})

ipcMain.handle('orchestra:get-backend-profiles', () => getProfilesPayload())

ipcMain.handle('orchestra:set-active-backend-profile', async (_event, profileId) => {
  const id = typeof profileId === 'string' ? profileId.trim() : ''
  if (!id) {
    throw new Error('profile id is required')
  }
  if (!backendProfilesState.profiles.some((profile) => profile.id === id)) {
    throw new Error('profile not found')
  }

  backendProfilesState = ensureProfilesState({
    ...backendProfilesState,
    activeProfileId: id,
  })

  await persistProfilesState()
  const active = getActiveProfile()
  return { baseUrl: active.baseUrl, apiToken: active.apiToken }
})

ipcMain.handle('orchestra:save-backend-profile', async (_event, payload) => {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
  const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
  const baseUrl = typeof payload?.baseUrl === 'string' ? payload.baseUrl.trim() : ''
  const apiToken = typeof payload?.apiToken === 'string' ? payload.apiToken.trim() : ''
  const makeActive = Boolean(payload?.makeActive)

  if (!name) {
    throw new Error('profile name is required')
  }
  if (!baseUrl) {
    throw new Error('baseUrl is required')
  }

  let profiles = backendProfilesState.profiles
  let savedId = id

  if (savedId !== '' && profiles.some((profile) => profile.id === savedId)) {
    profiles = profiles.map((profile) => (profile.id === savedId ? { ...profile, name, baseUrl, apiToken } : profile))
  } else {
    savedId = crypto.randomUUID()
    profiles = [...profiles, { id: savedId, name, baseUrl, apiToken }]
  }

  backendProfilesState = ensureProfilesState({
    activeProfileId: makeActive ? savedId : backendProfilesState.activeProfileId,
    profiles,
  })

  await persistProfilesState()
  return getProfilesPayload()
})

ipcMain.handle('orchestra:delete-backend-profile', async (_event, profileId) => {
  const id = typeof profileId === 'string' ? profileId.trim() : ''
  if (!id) {
    throw new Error('profile id is required')
  }
  if (backendProfilesState.profiles.length <= 1) {
    throw new Error('cannot delete the only remaining profile')
  }

  const profiles = backendProfilesState.profiles.filter((profile) => profile.id !== id)
  if (profiles.length === backendProfilesState.profiles.length) {
    throw new Error('profile not found')
  }

  const nextActiveId =
    backendProfilesState.activeProfileId === id
      ? profiles[0].id
      : backendProfilesState.activeProfileId

  backendProfilesState = ensureProfilesState({
    activeProfileId: nextActiveId,
    profiles,
  })

  await persistProfilesState()
  return getProfilesPayload()
})

const { registerFilesystemIPC } = require('./ipc-filesystem.cjs')
registerFilesystemIPC()

ipcMain.handle('orchestra:open-external', async (_event, url) => {
  if (!url || typeof url !== 'string') return
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed')
  }
  await shell.openExternal(url)
})

ipcMain.handle('orchestra:open-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return
  }
  // Require absolute path: Unix `/` or Windows drive letter (e.g. C:\)
  if (!targetPath.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(targetPath)) {
    throw new Error('Path must be absolute')
  }
  await shell.openPath(targetPath)
})

ipcMain.handle('orchestra:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('orchestra:select-file', async (_event, options) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options?.filters || undefined,
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('orchestra:oauth-window', async (_event, provider) => {
  if (typeof provider !== 'string') {
    throw new Error('provider must be a string')
  }
  return openOAuthWindow(provider)
})

app.whenReady().then(async () => {
  try {
    managedBackendState = await startManagedBackend()
    await loadProfilesState()
    applyManagedBackendProfile()
    await persistProfilesState()
    await loadTokens()
    createWindow()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Orchestra startup failed', `Unable to start local Orchestra backend.\n\n${message}`)
    app.quit()
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  void stopManagedBackend()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
