const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('orchestraDesktop', {
  getBackendConfig: () => ipcRenderer.invoke('orchestra:get-backend-config'),
  setBackendConfig: (nextConfig) => ipcRenderer.invoke('orchestra:set-backend-config', nextConfig),
  getBackendProfiles: () => ipcRenderer.invoke('orchestra:get-backend-profiles'),
  setActiveBackendProfile: (profileId) => ipcRenderer.invoke('orchestra:set-active-backend-profile', profileId),
  saveBackendProfile: (profile) => ipcRenderer.invoke('orchestra:save-backend-profile', profile),
  deleteBackendProfile: (profileId) => ipcRenderer.invoke('orchestra:delete-backend-profile', profileId),
  getAgentTokens: () => ipcRenderer.invoke('orchestra:get-agent-tokens'),
  setAgentToken: (name, value) => ipcRenderer.invoke('orchestra:set-agent-token', { name, value }),
  openExternal: (url) => {
    if (typeof url !== 'string') throw new Error('URL must be a string')
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are allowed')
    }
    return ipcRenderer.invoke('orchestra:open-external', url)
  },
  openPath: (targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
      throw new Error('Path must be a non-empty string')
    }
    // Require absolute path: Unix `/` or Windows drive letter (e.g. C:\)
    if (!targetPath.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(targetPath)) {
      throw new Error('Path must be absolute')
    }
    return ipcRenderer.invoke('orchestra:open-path', targetPath)
  },
  selectFolder: () => ipcRenderer.invoke('orchestra:select-folder'),
  selectFile: (options) => ipcRenderer.invoke('orchestra:select-file', options),
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('orchestra:fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('orchestra:fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('orchestra:fs:writeFile', filePath, content),
    stat: (filePath) => ipcRenderer.invoke('orchestra:fs:stat', filePath),
    deletePath: (filePath) => ipcRenderer.invoke('orchestra:fs:deletePath', filePath),
    gitStatus: (worktreePath) => ipcRenderer.invoke('orchestra:fs:gitStatus', worktreePath),
    search: (worktreePath, query, options) => ipcRenderer.invoke('orchestra:fs:search', worktreePath, query, options),
  },
  getScaleFactor: () => 1,
  onSwitchTab: (callback) => ipcRenderer.on('orchestra:switch-tab', (_event, tabNum) => callback(tabNum)),
  openOAuthWindow: (provider) => {
    if (typeof provider !== 'string') throw new Error('provider must be a string')
    return ipcRenderer.invoke('orchestra:oauth-window', provider)
  },
})
