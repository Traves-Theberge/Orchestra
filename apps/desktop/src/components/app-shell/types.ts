import type { LucideIcon } from 'lucide-react'

export type TimelineItem = {
  type: string
  at: string
  data: Record<string, unknown>
}

export type SidebarItem = {
  id: string
  label: string
  description: string
  icon: LucideIcon
}

export const periodFilters = ['Today', 'Week', 'Month'] as const
