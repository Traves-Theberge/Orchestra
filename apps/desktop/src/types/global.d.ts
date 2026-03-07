export {}

type BackendConfig = {
  baseUrl: string
  apiToken: string
}

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

type BackendProfilesPayload = {
  activeProfileId: string
  profiles: BackendProfile[]
}

declare global {
  interface Window {
    orchestraDesktop: {
      getBackendConfig: () => Promise<BackendConfig>
      setBackendConfig: (nextConfig: BackendConfig) => Promise<BackendConfig>
      getBackendProfiles: () => Promise<BackendProfilesPayload>
      setActiveBackendProfile: (profileId: string) => Promise<BackendConfig>
      saveBackendProfile: (profile: Partial<BackendProfile> & Pick<BackendProfile, 'name' | 'baseUrl' | 'apiToken'> & { makeActive?: boolean }) => Promise<BackendProfilesPayload>
      deleteBackendProfile: (profileId: string) => Promise<BackendProfilesPayload>
    }
  }
}
