import {
  patchAgentConfig,
  toDisplayError,
  updateAgentConfig,
  type BackendConfig,
} from '@core/api/client'
import { useAppStore } from '@core/store'

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

interface UseBackendProfilesOpts {
  setConfig: (cfg: BackendConfig | null) => void
  setErrorMessage: (m: string) => void
  setStatusMessage: (m: string) => void
  savingConfig: boolean
  setSavingConfig: (v: boolean) => void
  setBackendProfiles: (p: BackendProfile[]) => void
  setActiveProfileId: (id: string) => void
  setProfilesPending: (v: boolean) => void
}

interface UseBackendProfilesResult {
  handleBackendConfigSave: (nextConfig: BackendConfig) => Promise<void>
  handleSetActiveProfile: (profileId: string) => Promise<void>
  handleCreateProfile: (name: string) => Promise<void>
  handleDeleteProfile: (profileId: string) => Promise<void>
  handleAgentConfigSave: (nextAgentConfig: { commands: Record<string, string>; agent_provider: string; max_turns: number }) => Promise<void>
}

/**
 * Manages backend profile CRUD and agent config save operations.
 */
export function useBackendProfiles(
  config: BackendConfig | null,
  opts: UseBackendProfilesOpts,
): UseBackendProfilesResult {
  const handleBackendConfigSave = async (nextConfig: BackendConfig) => {
    const desktopBridge = window.orchestraDesktop
    try {
      if (!['http:', 'https:'].includes(new URL(nextConfig.baseUrl).protocol)) throw new Error('Unsupported URL protocol')
    } catch {
      opts.setErrorMessage('backend config save failed: base URL must be a valid absolute URL')
      return
    }

    opts.setSavingConfig(true)
    opts.setErrorMessage('')
    try {
      const saved = desktopBridge && typeof desktopBridge.setBackendConfig === 'function'
        ? await desktopBridge.setBackendConfig(nextConfig)
        : (() => { sessionStorage.setItem('orchestra:browser-backend:v1', JSON.stringify(nextConfig)); return nextConfig })()
      opts.setConfig(saved)
      if (desktopBridge && typeof desktopBridge.getBackendProfiles === 'function') {
        const payload = await desktopBridge.getBackendProfiles()
        opts.setBackendProfiles(payload.profiles)
        opts.setActiveProfileId(payload.activeProfileId)
      }
      opts.setStatusMessage('Backend configuration saved.')
    } catch (err) {
      const message = toDisplayError(err)
      opts.setErrorMessage(`backend config save failed: ${message}`)
    } finally {
      opts.setSavingConfig(false)
    }
  }

  const handleSetActiveProfile = async (profileId: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.setActiveBackendProfile !== 'function') {
      opts.setErrorMessage('desktop bridge unavailable: cannot change active profile')
      return
    }

    opts.setProfilesPending(true)
    opts.setErrorMessage('')
    try {
      const nextConfig = await desktopBridge.setActiveBackendProfile(profileId)
      opts.setConfig(nextConfig)
      if (typeof desktopBridge.getBackendProfiles === 'function') {
        const payload = await desktopBridge.getBackendProfiles()
        opts.setBackendProfiles(payload.profiles)
        opts.setActiveProfileId(payload.activeProfileId)
      }
      opts.setStatusMessage('Active backend profile switched.')
    } catch (err) {
      opts.setErrorMessage(`switch profile failed: ${toDisplayError(err)}`)
    } finally {
      opts.setProfilesPending(false)
    }
  }

  const handleCreateProfile = async (name: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.saveBackendProfile !== 'function') {
      opts.setErrorMessage('desktop bridge unavailable: cannot save profile')
      return
    }

    const fromConfig = config ?? { baseUrl: 'http://127.0.0.1:4010', apiToken: 'dev-token' }
    opts.setProfilesPending(true)
    opts.setErrorMessage('')
    try {
      const payload = await desktopBridge.saveBackendProfile({
        name: name.trim(),
        baseUrl: fromConfig.baseUrl,
        apiToken: fromConfig.apiToken,
        makeActive: true,
      })
      opts.setBackendProfiles(payload.profiles)
      opts.setActiveProfileId(payload.activeProfileId)
      const active = payload.profiles.find((profile: BackendProfile) => profile.id === payload.activeProfileId)
      if (active) {
        opts.setConfig({ baseUrl: active.baseUrl, apiToken: active.apiToken })
      }
      opts.setStatusMessage('Backend profile created and activated.')
    } catch (err) {
      opts.setErrorMessage(`create profile failed: ${toDisplayError(err)}`)
    } finally {
      opts.setProfilesPending(false)
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.deleteBackendProfile !== 'function') {
      opts.setErrorMessage('desktop bridge unavailable: cannot delete profile')
      return
    }

    opts.setProfilesPending(true)
    opts.setErrorMessage('')
    try {
      const payload = await desktopBridge.deleteBackendProfile(profileId)
      opts.setBackendProfiles(payload.profiles)
      opts.setActiveProfileId(payload.activeProfileId)
      const active = payload.profiles.find((profile: BackendProfile) => profile.id === payload.activeProfileId)
      if (active) {
        opts.setConfig({ baseUrl: active.baseUrl, apiToken: active.apiToken })
      }
      opts.setStatusMessage('Backend profile deleted.')
    } catch (err) {
      opts.setErrorMessage(`delete profile failed: ${toDisplayError(err)}`)
    } finally {
      opts.setProfilesPending(false)
    }
  }

  const handleAgentConfigSave = async (nextAgentConfig: {
    commands: Record<string, string>
    agent_provider: string
    max_turns: number
  }) => {
    if (!config) return
    opts.setSavingConfig(true)
    try {
      await updateAgentConfig(config, { commands: nextAgentConfig.commands, agent_provider: nextAgentConfig.agent_provider })
      await patchAgentConfig(config, { max_turns: nextAgentConfig.max_turns })
      useAppStore.getState().setAgentConfig(nextAgentConfig)
      opts.setStatusMessage('Agent configuration updated.')
    } catch (err) {
      const message = toDisplayError(err)
      opts.setErrorMessage(`save agent config failed: ${message}`)
    } finally {
      opts.setSavingConfig(false)
    }
  }

  return {
    handleBackendConfigSave,
    handleSetActiveProfile,
    handleCreateProfile,
    handleDeleteProfile,
    handleAgentConfigSave,
  }
}
