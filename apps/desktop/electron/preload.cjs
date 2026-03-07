const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('orchestraDesktop', {
  getBackendConfig: () => ipcRenderer.invoke('orchestra:get-backend-config'),
  setBackendConfig: (nextConfig) => ipcRenderer.invoke('orchestra:set-backend-config', nextConfig),
  getBackendProfiles: () => ipcRenderer.invoke('orchestra:get-backend-profiles'),
  setActiveBackendProfile: (profileId) => ipcRenderer.invoke('orchestra:set-active-backend-profile', profileId),
  saveBackendProfile: (profile) => ipcRenderer.invoke('orchestra:save-backend-profile', profile),
  deleteBackendProfile: (profileId) => ipcRenderer.invoke('orchestra:delete-backend-profile', profileId),
})
