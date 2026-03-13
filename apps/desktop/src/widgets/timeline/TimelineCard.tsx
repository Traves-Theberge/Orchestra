import { useMemo, useState, type CSSProperties } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Activity, ChevronDown, SignalLow, Ticket } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TimelineItem } from '@/components/app-shell/types'

type TimelineNarrative = {
  title: string
  desc: string
  color: string
  bg: string
}

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const toTransparentTheme = (theme: Record<string, CSSProperties>): Record<string, CSSProperties> => {
  return Object.fromEntries(
    Object.entries(theme).map(([key, styles]) => [
      key,
      {
        ...styles,
        background: 'transparent',
        backgroundColor: 'transparent',
        backgroundClip: 'padding-box',
      },
    ]),
  ) as Record<string, CSSProperties>
}

export function TimelineCard({ timeline }: { timeline: TimelineItem[] }) {
  const osOptions = useMemo(() => ({
    scrollbars: { autoHide: 'move' as const, theme: 'os-theme-custom' },
    overflow: { x: 'hidden' as const, y: 'scroll' as const },
  }), [])

  const getHumanNarrative = (item: TimelineItem) => {
    const id = asString(item.data.issue_identifier) || 'System'
    const provider = asString(item.data.provider) || ''
    const message = asString(item.data.message)

    switch (item.type) {
      case 'run_started':
        return {
          title: 'Session Initiated',
          desc: `Agent ${provider} started working on ${id}`,
          color: 'text-blue-500',
          bg: 'bg-blue-500/10',
        }
      case 'run_succeeded':
        return {
          title: 'Task Resolved',
          desc: `${id} successfully completed by ${provider}`,
          color: 'text-primary',
          bg: 'bg-primary/10',
        }
      case 'run_failed':
        return {
          title: 'Execution Fault',
          desc: `${id} failed during ${provider} turn`,
          color: 'text-red-500',
          bg: 'bg-red-500/10',
        }
      case 'retry_scheduled':
        return {
          title: 'Auto-Recovery',
          desc: `Rescheduling ${id} for another attempt`,
          color: 'text-amber-500',
          bg: 'bg-amber-500/10',
        }
      case 'hook_started':
        return {
          title: 'Environment Setup',
          desc: `Provisioning workspace for ${id}`,
          color: 'text-blue-400',
          bg: 'bg-blue-400/10',
        }
      case 'hook_completed':
        return {
          title: 'Setup Verified',
          desc: 'Workspace ready for agent execution',
          color: 'text-emerald-500',
          bg: 'bg-emerald-500/10',
        }
      default:
        return {
          title: item.type.replace(/_/g, ' '),
          desc: message || 'System signal recorded',
          color: 'text-muted-foreground',
          bg: 'bg-muted/20',
        }
    }
  }

  return (
    <Card className="h-full border border-border/40 bg-card/40 backdrop-blur-xl shadow-2xl flex flex-col transition-all duration-500 hover:shadow-primary/5">
      <CardHeader className="pb-3 border-b border-border/20 bg-muted/5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
              <Activity size={14} className="text-primary" />
              Runtime Pulse
            </CardTitle>
            <CardDescription className="text-[10px] font-medium text-muted-foreground/60">Live operational narrative stream</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-2 bg-background border-border/50 text-[9px] font-black tabular-nums">{timeline.length}</Badge>
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
        <OverlayScrollbarsComponent
          element="div"
          options={osOptions}
          className="h-full"
        >
          <div className="p-3 space-y-2">
            {timeline.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 opacity-20 grayscale">
                <SignalLow size={48} className="mb-4" strokeWidth={1} />
                <p className="text-[10px] font-black uppercase tracking-[0.3em]">Awaiting Uplink...</p>
              </div>
            ) : (
              timeline.map((item, idx) => (
                <TimelineItemRow key={`${item.at}-${idx}`} item={item} narrative={getHumanNarrative(item)} />
              ))
            )}
          </div>
        </OverlayScrollbarsComponent>
      </CardContent>
    </Card>
  )
}

function TimelineItemRow({ item, narrative }: { item: TimelineItem; narrative: TimelineNarrative }) {
  const [expanded, setExpanded] = useState(false)
  const issueIdentifier = asString(item.data.issue_identifier)
  const provider = asString(item.data.provider)

  const cleanOneDark = useMemo(() => {
    return toTransparentTheme(oneDark as Record<string, CSSProperties>)
  }, [])

  return (
    <div className={`group flex flex-col rounded-xl border transition-all duration-300 ${expanded ? 'border-border/60 bg-muted/30 shadow-inner' : 'border-transparent hover:border-border/40 hover:bg-muted/20'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-3 p-2.5 w-full text-left"
      >
        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/50 ${narrative.bg} shadow-sm transition-transform duration-500 ${expanded ? 'scale-110 rotate-3' : 'group-hover:scale-110 group-hover:rotate-3'}`}>
          <Activity className={`h-3.5 w-3.5 ${narrative.color}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate text-[11px] font-black uppercase tracking-wider text-foreground/90">{narrative.title}</p>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[8px] font-bold text-muted-foreground/30 tabular-nums">
                {new Date(item.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <ChevronDown size={12} className={`text-muted-foreground/40 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
          <p className="text-[11px] font-medium text-muted-foreground/70 leading-relaxed group-hover:text-foreground/80 transition-colors line-clamp-1">{narrative.desc}</p>

          <div className="flex items-center gap-2 pt-1">
            <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
              <Ticket size={8} />
              {issueIdentifier || 'SYS'}
            </div>
            {provider && (
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
                via {provider}
              </div>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-lg bg-black/40 p-3 border border-border/40 shadow-inner">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Raw Telemetry Payload</span>
              <Badge variant="outline" className="text-[7px] font-black opacity-40">JSON</Badge>
            </div>
            <SyntaxHighlighter
              language="json"
              style={cleanOneDark}
              customStyle={{
                margin: 0,
                padding: 0,
                background: 'transparent',
                fontSize: '10px',
                lineHeight: '1.5',
                textShadow: 'none',
              }}
              codeTagProps={{
                style: { background: 'transparent', textShadow: 'none' },
              }}
              useInlineStyles
            >
              {JSON.stringify(item.data, null, 2)}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
    </div>
  )
}
