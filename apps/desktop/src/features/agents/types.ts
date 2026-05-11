import type { LucideIcon } from 'lucide-react'
import type { AgentConfig } from '@core/api/types'
import type { ProviderPermissions, ProviderModelConfig, ProviderHook } from '@core/api/client'

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

// Shared panel contract used by file-backed resource editors.
export interface PanelProps {
  items: AgentConfig[]
  selectedItem: string | null
  onSelectItem: (path: string | null) => void
  onSave: (path: string, content: string) => Promise<void>
  onDelete: (path: string) => Promise<void>
  onCreate: (name: string, content?: string) => Promise<void>
  loading: boolean
  saving: string | null
  provider: Provider
}
