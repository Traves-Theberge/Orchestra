import type { ReactNode } from 'react'
import type { JsonRenderSpec } from '../lib/types'

interface JsonRenderBlockProps {
  spec: JsonRenderSpec
  onAction?: (actionName: string, params?: Record<string, unknown>) => void
}

function formatCellValue(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map(formatCellValue).join(', ')
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    // Handle json-render component specs embedded in cells (e.g. Badge)
    if ('type' in obj && 'props' in obj && typeof obj.props === 'object') {
      const props = obj.props as Record<string, unknown>
      return String(props.label ?? props.value ?? props.message ?? props.title ?? obj.type)
    }
    // Try common keys
    if ('name' in obj) return String(obj.name)
    if ('label' in obj) return String(obj.label)
    if ('value' in obj) return String(obj.value)
    if ('id' in obj) return String(obj.id)
    if ('text' in obj) return String(obj.text)
    if ('status' in obj) return String(obj.status)
    if ('state' in obj) return String(obj.state)
    // Boolean-like objects
    if ('configured' in obj) return obj.configured ? 'Yes' : 'No'
    if ('enabled' in obj) return obj.enabled ? 'Yes' : 'No'
    // Fallback: compact JSON
    try { return JSON.stringify(val) } catch { return '[object]' }
  }
  return String(val)
}

export function JsonRenderBlock({ spec, onAction }: JsonRenderBlockProps) {
  if (!spec?.root || !spec?.elements) return null

  function renderElement(key: string): ReactNode {
    const el = spec.elements[key]
    if (!el) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (el.props ?? {}) as Record<string, any>
    const kids = (el.children?.map((k) => renderElement(k)) ?? []) as ReactNode[]

    switch (el.type) {
      case 'Card':
        return (
          <div key={key} className={`rounded-xl border border-border/30 bg-gradient-to-b from-card to-muted/5 shadow-sm overflow-x-auto ${p.padding === 'sm' ? 'p-3' : p.padding === 'lg' ? 'p-6' : 'p-4'}`}>
            {(p.title || p.description) && (
              <div className="mb-3">
                {p.title && <p className="text-sm font-bold text-foreground">{String(p.title)}</p>}
                {p.description && <p className="text-[11px] text-muted-foreground mt-0.5">{String(p.description)}</p>}
              </div>
            )}
            <div className="space-y-3">{kids}</div>
          </div>
        )

      case 'Stack':
        return (
          <div key={key} className={`flex ${p.direction === 'horizontal' ? 'flex-row items-center flex-wrap' : 'flex-col'} ${p.gap === 'sm' ? 'gap-1.5' : p.gap === 'lg' ? 'gap-5' : 'gap-3'}`}>
            {kids}
          </div>
        )

      case 'Divider':
        return (
          <div key={key} className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
            {p.label && <span className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-bold">{String(p.label)}</span>}
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
          </div>
        )

      case 'Metric':
        return (
          <div key={key} className="rounded-lg bg-muted/10 border border-border/10 p-3 space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">{String(p.label ?? '')}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-foreground">{String(p.value ?? '')}</span>
              {p.trend && (
                <span className={`text-[11px] font-bold ${p.trend === 'up' ? 'text-emerald-400' : p.trend === 'down' ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→'} {p.trendValue ? String(p.trendValue) : ''}
                </span>
              )}
            </div>
          </div>
        )

      case 'Table': {
        const columns = (p.columns ?? []) as { key: string; label: string }[]
        const rows = (p.rows ?? []) as Record<string, unknown>[]
        return (
          <div key={key} className="rounded-lg border border-border/20 overflow-x-auto">
            <table className="w-full text-[11px] min-w-max">
              <thead>
                <tr className="bg-muted/20">
                  {columns.map((col) => (
                    <th key={col.key} className="py-2 px-3 font-bold uppercase tracking-widest text-[9px] text-muted-foreground/70 text-left border-b border-border/20">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${key}-row-${i}`} className="border-b border-border/10 transition-colors hover:bg-muted/10">
                    {columns.map((col, j) => (
                      <td key={col.key} className={`py-2 px-3 ${j === 0 ? 'font-mono font-bold text-primary/80' : ''}`}>{formatCellValue(row[col.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bg-muted/10 px-3 py-1.5 text-[9px] text-muted-foreground/50 border-t border-border/10">
              {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            </div>
          </div>
        )
      }

      case 'Badge': {
        const variants: Record<string, string> = {
          success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
          warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
          error: 'bg-red-500/15 text-red-400 border-red-500/20',
          info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
          default: 'bg-muted/30 text-muted-foreground border-border/20',
        }
        return (
          <span key={key} className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${variants[p.variant] ?? variants.default}`}>
            {String(p.label ?? '')}
          </span>
        )
      }

      case 'CodeBlock':
        return (
          <div key={key} className="rounded-lg border border-border/20 overflow-hidden">
            {(p.title || p.language) && (
              <div className="flex items-center justify-between bg-muted/15 px-3 py-1.5 border-b border-border/15">
                <span className="text-[10px] font-bold text-muted-foreground/70">{p.title ? String(p.title) : ''}</span>
                {p.language && <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{String(p.language)}</span>}
              </div>
            )}
            <pre className="p-3 text-[11px] font-mono overflow-x-auto bg-background/50 leading-relaxed"><code>{String(p.code ?? '')}</code></pre>
          </div>
        )

      case 'KeyValue': {
        const pairs = (p.pairs ?? []) as { key: string; value: string }[]
        return (
          <div key={key} className="rounded-lg border border-border/15 overflow-hidden divide-y divide-border/10">
            {pairs.map((pair, i) => (
              <div key={`${key}-kv-${pair.key}-${i}`} className="flex items-center justify-between px-3 py-2 hover:bg-muted/10 transition-colors">
                <span className="text-[11px] text-muted-foreground font-medium">{pair.key}</span>
                <span className="text-[11px] font-mono text-foreground">{pair.value}</span>
              </div>
            ))}
          </div>
        )
      }

      case 'Button': {
        const variants: Record<string, string> = {
          primary: 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90',
          secondary: 'border border-border/30 bg-muted/10 text-foreground hover:bg-muted/30',
          destructive: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
          ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted/20',
        }
        return (
          <button key={key} onClick={() => onAction?.(String(p.action ?? ''), (p.params ?? {}) as Record<string, unknown>)}
            className={`rounded-lg px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${variants[p.variant] ?? variants.primary}`}>
            {String(p.label ?? '')}
          </button>
        )
      }

      case 'ButtonGroup':
        return <div key={key} className={`flex ${p.direction === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'} gap-2`}>{kids}</div>

      case 'Alert': {
        const variants: Record<string, { border: string; bg: string; text: string; icon: string }> = {
          success: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-300', icon: '✓' },
          warning: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-300', icon: '⚠' },
          error: { border: 'border-red-500/30', bg: 'bg-red-500/5', text: 'text-red-300', icon: '✕' },
          info: { border: 'border-blue-500/30', bg: 'bg-blue-500/5', text: 'text-blue-300', icon: 'ℹ' },
        }
        const v = variants[p.variant] ?? variants.info
        return (
          <div key={key} className={`rounded-lg border ${v.border} ${v.bg} px-3.5 py-2.5 text-[11px] ${v.text}`}>
            <div className="flex gap-2">
              <span className="shrink-0 mt-0.5">{v.icon}</span>
              <div>
                {p.title && <p className="font-bold mb-0.5">{String(p.title)}</p>}
                <p className="leading-relaxed">{String(p.message ?? '')}</p>
              </div>
            </div>
          </div>
        )
      }

      case 'Progress': {
        const val = Number(p.value ?? 0)
        const max = Number(p.max ?? 100)
        const pct = Math.min(100, (val / max) * 100)
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              {p.label && <p className="text-[10px] font-bold text-muted-foreground">{String(p.label)}</p>}
              <span className="text-[10px] font-mono text-muted-foreground/60">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      }

      case 'List': {
        const items = (p.items ?? []) as { label: string; description?: string }[]
        return (
          <div key={key} className="space-y-1">
            {items.map((item, i) => (
              <div key={`${key}-li-${item.label}-${i}`} className="flex gap-2.5 text-[11px] p-1 rounded-md hover:bg-muted/10 transition-colors">
                <span className="text-primary/60 mt-0.5 shrink-0">{p.ordered ? `${i + 1}.` : '•'}</span>
                <div>
                  <span className="font-medium text-foreground">{item.label}</span>
                  {item.description && <span className="text-muted-foreground/70 ml-1">: {item.description}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      }

      default:
        return <div key={key} className="text-[10px] text-muted-foreground/50 italic">[Unknown: {el.type}]</div>
    }
  }

  try {
    return <div>{renderElement(spec.root)}</div>
  } catch (err) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-[10px] font-bold text-amber-400 mb-1">Render error</p>
        <pre className="text-[9px] font-mono text-muted-foreground/60 overflow-auto max-h-[80px]">
          {err instanceof Error ? err.message : 'Unknown error'}
        </pre>
      </div>
    )
  }
}
