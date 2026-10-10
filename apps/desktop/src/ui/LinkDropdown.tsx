import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { useAppStore } from '@core/store'
import { Globe, ExternalLink, Copy, Check, ChevronDown } from 'lucide-react'
import { cn } from '@core/utils/cn'

export interface LinkDropdownProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  children: React.ReactNode
  linkProjectId?: string
  className?: string
  showChevron?: boolean
}

/**
 * Clickable URL component with a dropdown menu allowing the user
 * to choose where to open the link (Workspace browser, system browser, or copy).
 */
export function LinkDropdown({
  href,
  children,
  linkProjectId,
  className,
  showChevron = true,
  ...props
}: LinkDropdownProps) {
  const [copied, setCopied] = React.useState(false)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const setActiveSection = useAppStore((s) => s.setActiveSection)

  if (href.startsWith('#')) {
    return (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <a
          href={href}
          role="link"
          onClick={(e) => {
            e.stopPropagation()
            if (e.ctrlKey || e.metaKey || e.button === 1) {
              e.preventDefault()
              if (window.orchestraDesktop?.openExternal) {
                void window.orchestraDesktop.openExternal(href)
              } else {
                window.open(href, '_blank', 'noopener,noreferrer')
              }
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
          }}
          className={cn(
            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 -mx-0.5 font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer decoration-primary/40 underline underline-offset-2',
            className
          )}
          title={`Open ${href}...`}
          {...props}
        >
          <span>{children}</span>
          {showChevron && (
            <ChevronDown className="size-2.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </a>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-60 text-xs">
        <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground truncate border-b border-border/40 select-all mb-1">
          {href}
        </div>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            setActiveSection('CONSOLE')
            openBrowserTab(href, linkProjectId)
          }}
          className="gap-2 cursor-pointer py-1.5"
        >
          <Globe className="size-3.5 text-primary shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-foreground">Open in Workspace</span>
            <span className="text-[10px] text-muted-foreground">Internal browser tab</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            if (window.orchestraDesktop?.openExternal) {
              void window.orchestraDesktop.openExternal(href)
            } else {
              window.open(href, '_blank', 'noopener,noreferrer')
            }
          }}
          className="gap-2 cursor-pointer py-1.5"
        >
          <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-foreground">Open in Default Browser</span>
            <span className="text-[10px] text-muted-foreground">System web browser</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async (e) => {
            e.stopPropagation()
            try {
              await navigator.clipboard.writeText(href)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch (err) {
              console.error('Failed to copy URL:', err)
            }
          }}
          className="gap-2 cursor-pointer py-1.5"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-500 shrink-0" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium">{copied ? 'Copied to Clipboard!' : 'Copy Link Address'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
