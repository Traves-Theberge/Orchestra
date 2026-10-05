import { createContext } from 'react'

export const WorkspaceToolsContext = createContext<{
  maximized: boolean
  toggle: () => void
} | null>(null)
