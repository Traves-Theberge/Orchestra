import { defineRegistry } from '@json-render/react'
import type { DefineRegistryResult } from '@json-render/react'
import { agentCatalog } from './json-render-catalog'

// ── Types ──────────────────────────────────────────────────────
type ActionHandler = (
  actionName: string,
  params?: Record<string, unknown>,
) => void

// ── Helpers ────────────────────────────────────────────────────
const gapClass: Record<string, string> = {
  none: 'gap-0',
  sm: 'gap-1',
  md: 'gap-3',
  lg: 'gap-6',
}

const paddingClass: Record<string, string> = {
  none: 'p-0',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
}

const alertVariantClass: Record<string, string> = {
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
}

const badgeVariantClass: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-500/20 text-emerald-300',
  warning: 'bg-amber-500/20 text-amber-300',
  error: 'bg-red-500/20 text-red-300',
  info: 'bg-blue-500/20 text-blue-300',
}

const buttonVariantClass: Record<string, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}

const trendIcon: Record<string, string> = {
  up: '\u2191',
  down: '\u2193',
  flat: '\u2192',
}

const trendColor: Record<string, string> = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  flat: 'text-muted-foreground',
}

// ── Registry factory ───────────────────────────────────────────
export function createAgentRegistry(onAction: ActionHandler): DefineRegistryResult {
  return defineRegistry(agentCatalog, {
    components: {
      // ── Layout ─────────────────────────────────────────────
      Card: ({ props, children }) => (
        <div className={`rounded-lg border border-border bg-card text-card-foreground shadow-sm ${paddingClass[props.padding ?? 'md']}`}>
          {props.title && (
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
              {props.description && (
                <p className="text-xs text-muted-foreground">{props.description}</p>
              )}
            </div>
          )}
          {children}
        </div>
      ),

      Stack: ({ props, children }) => {
        const dir = props.direction ?? 'vertical'
        const align = props.align ?? 'stretch'
        const alignMap: Record<string, string> = {
          start: 'items-start',
          center: 'items-center',
          end: 'items-end',
          stretch: 'items-stretch',
        }
        return (
          <div
            className={`flex ${dir === 'horizontal' ? 'flex-row' : 'flex-col'} ${gapClass[props.gap ?? 'md']} ${alignMap[align]}`}
          >
            {children}
          </div>
        )
      },

      Divider: ({ props }) => (
        <div className="relative flex items-center py-2">
          <div className="flex-grow border-t border-border" />
          {props.label && (
            <>
              <span className="mx-3 shrink-0 text-xs text-muted-foreground">
                {props.label}
              </span>
              <div className="flex-grow border-t border-border" />
            </>
          )}
        </div>
      ),

      // ── Data ───────────────────────────────────────────────
      Metric: ({ props }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{props.label}</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-foreground">
              {String(props.value)}
            </span>
            {props.trend && (
              <span className={`text-xs font-medium ${trendColor[props.trend]}`}>
                {trendIcon[props.trend]}
                {props.trendValue && ` ${props.trendValue}`}
              </span>
            )}
          </div>
        </div>
      ),

      Table: ({ props }) => (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {props.columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 text-xs font-medium text-muted-foreground ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, i) => (
                <tr
                  key={`row-${i}`}
                  className={`border-b border-border last:border-0 ${
                    props.striped && i % 2 === 1 ? 'bg-muted/30' : ''
                  }`}
                >
                  {props.columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-foreground ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),

      Badge: ({ props }) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            badgeVariantClass[props.variant ?? 'default']
          }`}
        >
          {props.label}
        </span>
      ),

      CodeBlock: ({ props }) => (
        <div className="rounded-md border border-border bg-muted/50 overflow-hidden">
          {(props.title || props.language) && (
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {props.title ?? props.language}
              </span>
            </div>
          )}
          <pre className="overflow-x-auto p-3 text-xs text-foreground">
            <code>{props.code}</code>
          </pre>
        </div>
      ),

      KeyValue: ({ props }) => (
        <div className="space-y-1.5">
          {props.pairs.map((pair, i) => (
            <div key={`${pair.key}-${i}`} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="shrink-0 text-muted-foreground">{pair.key}</span>
              <span className="truncate text-right font-medium text-foreground">
                {String(pair.value)}
              </span>
            </div>
          ))}
        </div>
      ),

      // ── Interactive ────────────────────────────────────────
      Button: ({ props }) => (
        <button
          type="button"
          className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            buttonVariantClass[props.variant ?? 'default']
          }`}
          onClick={() => onAction(props.action, props.params as Record<string, unknown> | undefined)}
        >
          {props.label}
        </button>
      ),

      ButtonGroup: ({ props, children }) => {
        const dir = props.direction ?? 'horizontal'
        return (
          <div className={`flex ${dir === 'horizontal' ? 'flex-row' : 'flex-col'} gap-2`}>
            {children}
          </div>
        )
      },

      // ── Feedback ───────────────────────────────────────────
      Alert: ({ props }) => (
        <div
          className={`rounded-md border p-3 text-sm ${
            alertVariantClass[props.variant ?? 'info']
          }`}
        >
          {props.title && (
            <div className="mb-1 font-semibold">{props.title}</div>
          )}
          <div>{props.message}</div>
        </div>
      ),

      Progress: ({ props }) => {
        const max = props.max ?? 100
        const pct = Math.min(100, Math.round((props.value / max) * 100))
        return (
          <div className="space-y-1">
            {props.label && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{props.label}</span>
                <span>{pct}%</span>
              </div>
            )}
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      },
    },

    actions: {
      navigate: async (params) => {
        if (params) {
          onAction('navigate', params as Record<string, unknown>)
        }
      },
      send_chat: async (params) => {
        if (params) {
          onAction('send_chat', params as Record<string, unknown>)
        }
      },
      copy_to_clipboard: async (params) => {
        if (params?.text && typeof params.text === 'string') {
          await navigator.clipboard.writeText(params.text)
        }
      },
    },
  })
}
