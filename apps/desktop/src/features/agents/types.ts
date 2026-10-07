import type { LucideIcon } from 'lucide-react'

export type Provider = 'claude' | 'codex' | 'antigravity' | 'opencode' | '8gent'
/** Sidebar tab: a harness, or the cross-harness Orchestra view. */
export type ActiveAgentProvider = Provider | 'orchestra'
export type CategoryId =
  | 'overview'
  | 'settings'
  | 'config'
  | 'approvals'
  | 'models'
  | 'environment'
  | 'profiles'
  | 'instructions'
  | 'context'
  | 'agents'
  | 'skills'
  | 'hooks'
  | 'mcp'
  | 'rules'
  | 'commands'
  | 'permissions'
export type Scope = 'GLOBAL' | 'PROJECT'

export interface CategoryDef {
  id: CategoryId
  label: string
  icon: LucideIcon | string
  pinned?: boolean
}
