import { useEffect, useState } from 'react'
import { toDisplayError, type BackendConfig } from '@core/api/client'

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

type BackendConfigState = {
  config: BackendConfig | null
  setConfig: (config: BackendConfig | null) => void
  loadingConfig: boolean
  savingConfig: boolean
  setSavingConfig: (saving: boolean) => void
  backendProfiles: BackendProfile[]
  setBackendProfiles: (profiles: BackendProfile[]) => void
  activeProfileId: string
  setActiveProfileId: (id: string) => void
  profilesPending: boolean
  setProfilesPending: (pending: boolean) => void
  errorMessage: string
  setErrorMessage: (message: string) => void
}

/**
 * Loads the backend configuration and profiles from the Electron desktop bridge.
 * Handles initial config fetch, profile enumeration, and default profile creation.
 */
export function useBackendConfig(): BackendConfigState {
  const [config, setConfig] = useState<BackendConfig | null>(() =>
    typeof window !== 'undefined' && typeof window.orchestraDesktop?.getBackendConfig !== 'function' ? readBrowserBackendConfig() : null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [profilesPending, setProfilesPending] = useState(false)
  const [backendProfiles, setBackendProfiles] = useState<BackendProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Load config from desktop bridge on mount
  useEffect(() => {
    let mounted = true
    const desktopBridge = window.orchestraDesktop
    if (!desktopBridge || typeof desktopBridge.getBackendConfig !== 'function') {
      // Browser dev mode — fall back to default local backend
      return () => { mounted = false }
    }

    desktopBridge
      .getBackendConfig()
      .then((value) => {
        if (mounted) setConfig(value)
      })
      .then(async () => {
        if (!mounted || typeof desktopBridge.getBackendProfiles !== 'function') return
        const payload = await desktopBridge.getBackendProfiles()
        if (!mounted) return
        setBackendProfiles(payload.profiles)
        setActiveProfileId(payload.activeProfileId)
      })
      .catch((err: unknown) => {
        if (mounted) setErrorMessage(`config load failed: ${toDisplayError(err)}`)
      })
      .finally(() => {
        if (mounted) setLoadingConfig(false)
      })

    return () => { mounted = false }
  }, [])

  // Create default profile if none exist
  useEffect(() => {
    if (!config || backendProfiles.length > 0) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBackendProfiles([
      { id: 'active', name: 'Active', baseUrl: config.baseUrl, apiToken: config.apiToken },
    ])
    setActiveProfileId('active')
  }, [config, backendProfiles.length])

  return {
    config, setConfig,
    loadingConfig,
    savingConfig, setSavingConfig,
    backendProfiles, setBackendProfiles,
    activeProfileId, setActiveProfileId,
    profilesPending, setProfilesPending,
    errorMessage, setErrorMessage,
  }
}

// Browser development uses a tab-scoped connection. Electron continues to own
// its profile through the desktop bridge; no account configuration is changed.
export function readBrowserBackendConfig(): BackendConfig {
  try {
    const saved = JSON.parse(sessionStorage.getItem('orchestra:browser-backend:v1') ?? 'null')
    if (saved && typeof saved.baseUrl === 'string' && typeof saved.apiToken === 'string'
      && ['http:', 'https:'].includes(new URL(saved.baseUrl).protocol)) return { baseUrl: saved.baseUrl, apiToken: saved.apiToken }
  } catch { /* Fall back to the development endpoint. */ }
  return { baseUrl: 'http://127.0.0.1:4010', apiToken: 'dev-token' }
}
