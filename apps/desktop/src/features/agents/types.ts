import type { LucideIcon } from 'lucide-react'

export type Provider = 'claude' | 'codex' | 'gemini' | 'opencode' | '8gent'
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

