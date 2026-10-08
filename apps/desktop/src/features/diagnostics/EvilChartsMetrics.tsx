/**
 * Adapted from EvilCharts EvilGridBarChart, GridBarShape and GridBarBackground.
 * Source: legions-developer/evilcharts, ecbd6a5db7b25f9a7e070c02b2ef728c378eeb5c,
 * src/registry/blocks/recharts/b-grid-bar-chart.tsx. MIT © 2026 Gurbinder.
 * Full license and adaptation receipt: ./EVILCHARTS-LICENSE.txt.
 */
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltipContent } from '@ui/chart'
import type { DiagnosticPoint } from './api'

const SQUARE_SIZE = 6
const GAP = 2
const CELL_SIZE = SQUARE_SIZE + GAP
type GridBarProps = { x?: number; y?: number; width?: number; height?: number; fill?: string }
function GridBarShape({ x = 0, y = 0, width = 0, height = 0, fill, ghost = false }: GridBarProps & { ghost?: boolean }) {
  const realHeight = Number(height); const realWidth = Number(width)
  if (realHeight <= 0) return null
  const rows = Math.min(64, Math.ceil(realHeight / CELL_SIZE))
  const columns = Math.min(6, Math.max(1, Math.floor(realWidth / CELL_SIZE)))
  const squareSize = Math.min(SQUARE_SIZE, realWidth)
  const squareX = Number(x) + (realWidth - (columns * CELL_SIZE - GAP)) / 2
  const bottomY = Number(y) + realHeight
  return <g opacity={ghost ? 0.12 : 1}>{Array.from({ length: rows * columns }, (_, i) => {
    const row = Math.floor(i / columns)
    const height = Math.min(squareSize, realHeight - row * CELL_SIZE)
    return height > 0 ? <rect key={i} x={squareX + (i % columns) * CELL_SIZE} y={bottomY - row * CELL_SIZE - height} width={squareSize} height={height} rx={1} fill={ghost ? 'hsl(var(--muted-foreground))' : fill} /> : null
  })}</g>
}
function GridBarBackground(props: GridBarProps) { return <GridBarShape {...props} ghost /> }

/** Real bucket counts replace sample data; local theme, no animation, textual table. */
export function EvilChartsMetrics({ points }: { points: DiagnosticPoint[] }) {
  const data = [...(points ?? [])].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-120).map(point => ({ ...point, label: new Date(point.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) }))
  const totals = data.reduce((sum, point) => ({ operations: sum.operations + point.operations, errors: sum.errors + point.errors }), { operations: 0, errors: 0 })
  return <div className="border border-border rounded-xl bg-card p-5 space-y-5">
    <div className="flex flex-wrap justify-between items-start gap-4"><div><h3 className="font-semibold">Recorded operations over time</h3><p className="text-xs text-muted-foreground mt-1">Daily activity · {data.length} recorded {data.length === 1 ? 'day' : 'days'} · UTC</p></div><div className="flex gap-6 text-right"><div><p className="text-xs text-muted-foreground">Operations</p><p className="text-2xl font-semibold tabular-nums">{totals.operations.toLocaleString()}</p></div><div><p className="text-xs text-muted-foreground">Errors</p><p className={`text-2xl font-semibold tabular-nums ${totals.errors ? 'text-destructive' : 'text-muted-foreground'}`}>{totals.errors.toLocaleString()}</p></div></div></div>
    {data.length ? <><div className="flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><i className="size-2 rounded-sm bg-chart-1" />Operations</span><span className="flex items-center gap-2"><i className="size-2 rounded-sm bg-destructive" />Errors</span></div><ChartContainer config={{ operations: { label: 'Operations', color: 'hsl(var(--chart-1))' }, errors: { label: 'Errors', color: 'hsl(var(--destructive))' } }} initialDimension={{ width: 600, height: 256 }} className="h-64 w-full min-w-0 aspect-auto"><BarChart accessibilityLayer data={data} maxBarSize={40} barGap={8} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 5" opacity={0.5} /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={25} tickMargin={12} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} /><Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }} content={<ChartTooltipContent className="min-w-40" />} /><Bar dataKey="operations" fill="var(--color-operations)" background={GridBarBackground} shape={GridBarShape} activeBar={GridBarShape} isAnimationActive={false} /><Bar dataKey="errors" fill="var(--color-errors)" shape={GridBarShape} isAnimationActive={false} /></BarChart></ChartContainer><details className="border-t border-border pt-3"><summary className="text-xs cursor-pointer text-muted-foreground">Chart data table</summary><p className="text-xs text-muted-foreground my-3">Daily buckets from hourly aggregates. Task/project filters use retained detail. Duration is a total, not a percentile.</p><table className="w-full text-xs text-left"><thead><tr><th>Bucket</th><th>Operations</th><th>Errors</th><th>Total duration (ms)</th></tr></thead><tbody>{data.map(point => <tr key={point.time}><td>{point.time}</td><td>{point.operations}</td><td>{point.errors}</td><td>{point.duration_ms.toFixed(1)}</td></tr>)}</tbody></table></details></> : <p className="text-sm text-muted-foreground">No recorded metric buckets.</p>}
  </div>
}
