import type { ComponentProps, ReactNode } from 'react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { SidebarNav } from '@/components/app-shell/sidebar-nav'
import { TopBar } from '@/components/app-shell/top-bar'
import type { SidebarItem } from '@/components/app-shell/types'

type AppShellProps = {
  items: SidebarItem[]
  activeSection: string
  onSectionChange: (section: string) => void
  sidebarCollapsed: boolean
  sidebarWidth: number
  onToggleCollapsed: () => void
  osOptions: ComponentProps<typeof OverlayScrollbarsComponent>['options']
  zoom?: number
  topBarProps: ComponentProps<typeof TopBar>
  children: ReactNode
}

export function AppShell({
  items,
  activeSection,
  onSectionChange,
  sidebarCollapsed,
  sidebarWidth,
  onToggleCollapsed,
  osOptions,
  zoom = 0.6,
  topBarProps,
  children,
}: AppShellProps) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full w-full relative">
        <SidebarNav
          items={items}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          sidebarCollapsed={sidebarCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          sidebarWidth={sidebarWidth}
        />

        <OverlayScrollbarsComponent
          element="main"
          options={osOptions}
          className="min-w-0 flex-1 bg-gradient-to-b from-background via-background to-muted/30 h-full"
        >
          <div
            className="px-6 pb-6 pt-4 lg:px-8 w-full max-w-[1800px] mx-auto flex flex-col min-h-full transition-all duration-500 origin-top-left"
            style={{ zoom }}
          >
            <TopBar {...topBarProps} />
            {children}
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </div>
  )
}
