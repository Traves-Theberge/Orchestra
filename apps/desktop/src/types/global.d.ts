export { }

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
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          preload?: string
          nodeintegration?: string
        },
        HTMLElement
      >
    }
  }

  interface Window {
    orchestraDesktop: {
      getBackendConfig: () => Promise<BackendConfig>
      setBackendConfig: (nextConfig: BackendConfig) => Promise<BackendConfig>
      getBackendProfiles: () => Promise<BackendProfilesPayload>
      setActiveBackendProfile: (profileId: string) => Promise<BackendConfig>
      saveBackendProfile: (profile: Partial<BackendProfile> & Pick<BackendProfile, 'name' | 'baseUrl' | 'apiToken'> & { makeActive?: boolean }) => Promise<BackendProfilesPayload>
      deleteBackendProfile: (profileId: string) => Promise<BackendProfilesPayload>
      getAgentTokens: () => Promise<Record<string, string>>
      setAgentToken: (name: string, value: string | null) => Promise<void>
      openExternal: (url: string) => Promise<void>
      openPath: (targetPath: string) => Promise<void>
      selectFolder: () => Promise<string | null>
      selectFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
      getScaleFactor: () => number
      openOAuthWindow?: (provider: string) => Promise<string>
      fs: {
        readDir: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
        readFile: (filePath: string) => Promise<{ content: string; isBinary: boolean; tooLarge?: boolean }>
        writeFile: (filePath: string, content: string) => Promise<void>
        stat: (filePath: string) => Promise<{ isDirectory: boolean; size: number; mtime: number }>
        deletePath: (filePath: string) => Promise<void>
        gitStatus: (worktreePath: string) => Promise<Record<string, string>>
        search: (worktreePath: string, query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; includeGlob?: string; excludeGlob?: string }) => Promise<Array<{ file: string; relativePath: string; matches: Array<{ line: number; text: string }> }>>
      }
    }
  }
}
