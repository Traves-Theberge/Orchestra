const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('disable-gpu-sandbox')

function createDefaultProfile() {
  return {
    id: 'default',
    name: 'Default',
    baseUrl: process.env.ORCHESTRA_BASE_URL || 'http://127.0.0.1:4010',
    apiToken: process.env.ORCHESTRA_API_TOKEN || '',
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
      encrypted[key] = value // Fallback if encryption unavailable
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Orchestra Desktop',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('did-fail-load', { code, description, url })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone', details)
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
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
  return { baseUrl: active.baseUrl, apiToken: active.apiToken, agentTokens }
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

ipcMain.handle('orchestra:open-external', async (_event, url) => {
  if (url) await shell.openExternal(url)
})

ipcMain.handle('orchestra:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

app.whenReady().then(async () => {
  await loadProfilesState()
  await loadTokens()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
