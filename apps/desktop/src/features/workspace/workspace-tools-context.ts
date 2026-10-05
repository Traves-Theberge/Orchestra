import { createContext } from 'react'

export const WorkspaceToolsContext = createContext<{
  maximized: boolean
  toolbarHosted: boolean
  toggle: () => void
} | null>(null)
