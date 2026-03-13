import React, { useMemo } from 'react'
import { Database, TrendingUp, Zap, Cpu, History as HistoryIcon, Search, Eye, Folder, RefreshCcw } from 'lucide-react'
import type { GlobalStats, SessionSummary } from '@/lib/orchestra-types'
import { Badge } from '@/components/ui/badge'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '../ui/tooltip-wrapper'

const PROVIDER_PRICES: Record<string, { input: number; output: number }> = {
    claude: { input: 3.0, output: 15.0 }, // Claude 3.7 Sonnet
    gemini: { input: 0.075, output: 0.30 }, // Gemini 2.0 Flash (approx)
    codex: { input: 2.0, output: 10.0 }, // Default custom pricing
    default: { input: 1.0, output: 5.0 }
}

function calculateCost(tokens: number, type: 'input' | 'output', provider?: string): number {
    const p = provider?.toLowerCase() || 'default'
    const rates = PROVIDER_PRICES[p] || PROVIDER_PRICES.default
    const rate = type === 'input' ? rates.input : rates.output
    return (tokens / 1_000_000) * rate
}

interface AnalyticsDashboardProps {
    stats: GlobalStats | null
    loading: boolean
    onInspectSession?: (sessionId: string) => void
    onCloneSession?: (session: SessionSummary) => void
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ stats, loading, onInspectSession, onCloneSession }) => {
    const chartData = useMemo(() => {
        if (!stats?.recent_sessions) return []
        return [...stats.recent_sessions].reverse().map(session => ({
            name: new Date(session.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            input: session.total_input,
            output: session.total_output,
            total: session.total_input + session.total_output,
        }))
    }, [stats?.recent_sessions])

    if (loading || !stats) {
        return (
            <div className="p-4 space-y-6 animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-32 bg-background/40 rounded-xl border border-white/5" />
                    ))}
                </div>
                <div className="h-64 bg-background/40 rounded-xl border border-white/5" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 overflow-y-auto h-full custom-scrollbar bg-background/20">
            <div className="flex items-center gap-4 mb-8">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5 group transition-all hover:scale-105 active:scale-95 cursor-default">
                    <Database className="text-primary h-6 w-6 group-hover:animate-pulse" strokeWidth={2.5} />
                </div>
                <div>
                    <h1 className="text-2xl font-black tracking-tight leading-none bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">Warehouse Analytics</h1>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-[0.2em] opacity-60 mt-1.5">Historical compute consumption & fleet metrics</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl p-5 relative overflow-hidden group shadow-lg transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:border-emerald-500/20">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-emerald-500">
                        <Zap size={64} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/40" />
                        Total Input
                    </div>
                    <h3 className="text-3xl font-black leading-tight tracking-tighter tabular-nums">{(stats.total_input / 1000).toFixed(1)}k</h3>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] text-emerald-500 font-black tabular-nums bg-emerald-500/5 border border-emerald-500/10 px-1.5 py-0.5 rounded">
                            ${calculateCost(stats.total_input, 'input').toFixed(2)}
                        </span>
                        <span className="text-[8px] text-muted-foreground/40 font-bold uppercase tracking-widest leading-none">Est. USD</span>
                    </div>
                </div>

                <div className="bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl p-5 relative overflow-hidden group shadow-lg transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:border-primary/20">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-primary">
                        <TrendingUp size={64} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                        Total Output
                    </div>
                    <h3 className="text-3xl font-black leading-tight tracking-tighter tabular-nums">{(stats.total_output / 1000).toFixed(1)}k</h3>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] text-primary font-black tabular-nums bg-primary/5 border border-primary/10 px-1.5 py-0.5 rounded">
                            ${calculateCost(stats.total_output, 'output').toFixed(2)}
                        </span>
                        <span className="text-[8px] text-muted-foreground/40 font-bold uppercase tracking-widest leading-none">Est. USD</span>
                    </div>
                </div>

                <div className="bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl p-5 relative overflow-hidden group shadow-lg transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:border-blue-500/20">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-blue-500">
                        <Cpu size={64} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500/40" />
                        Efficiency
                    </div>
                    <h3 className="text-3xl font-black leading-tight tracking-tighter tabular-nums">{((stats.total_output / Math.max(stats.total_input, 1)) * 100).toFixed(1)}%</h3>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] text-blue-500 font-black tabular-nums bg-blue-500/5 border border-blue-500/10 px-1.5 py-0.5 rounded">
                            {((stats.total_output / Math.max(stats.total_input, 1))).toFixed(2)}x
                        </span>
                        <span className="text-[8px] text-muted-foreground/40 font-bold uppercase tracking-widest leading-none">Ratio</span>
                    </div>
                </div>

                <div className="bg-primary/5 backdrop-blur-xl border border-primary/20 rounded-2xl p-5 relative overflow-hidden group shadow-lg transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:border-primary/40 ring-1 ring-primary/10">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-primary">
                        <Zap size={64} strokeWidth={2.5} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-primary/60 mb-2 relative z-10">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]" />
                        Fleet Total
                    </div>
                    <h3 className="text-4xl font-black leading-tight tracking-tighter text-primary tabular-nums relative z-10">
                        ${(calculateCost(stats.total_input, 'input') + calculateCost(stats.total_output, 'output')).toFixed(2)}
                    </h3>
                    <p className="text-[9px] text-muted-foreground/60 font-black uppercase tracking-widest mt-2 relative z-10">Aggregate Spend</p>
                </div>
            </div>

            {chartData.length > 0 && (
                <div className="bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl p-6 shadow-lg transition-all hover:border-primary/10">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">
                            <TrendingUp size={12} className="text-primary" />
                            Burn Trajectory
                        </div>
                        <Badge variant="outline" className="text-[8px] font-black border-primary/20 text-primary px-1.5 h-4 bg-primary/5 uppercase">Real-time Telemetry</Badge>
                    </div>
                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/20" vertical={false} />
                                <XAxis dataKey="name" stroke="currentColor" className="text-muted-foreground/40 font-mono" fontSize={9} tickMargin={10} axisLine={false} tickLine={false} />
                                <YAxis stroke="currentColor" className="text-muted-foreground/40 font-mono" fontSize={9} tickFormatter={(v) => `${v / 1000}k`} width={40} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ 
                                        backgroundColor: 'hsl(var(--popover))', 
                                        borderColor: 'hsl(var(--border))', 
                                        borderRadius: '12px', 
                                        fontSize: '10px', 
                                        fontWeight: 'bold',
                                        boxShadow: '0 20px 50px rgba(0,0,0,0.2)'
                                    }}
                                    itemStyle={{ padding: '2px 0' }}
                                    cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="input" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorInput)" stackId="1" animationDuration={1500} />
                                <Area type="monotone" dataKey="output" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorOutput)" stackId="1" animationDuration={1500} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl overflow-hidden shadow-lg transition-all hover:border-primary/10">
                <div className="p-4 border-b border-border/40 flex items-center justify-between bg-muted/10">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                            <HistoryIcon size={16} />
                        </div>
                        <h3 className="text-base font-black tracking-tight uppercase">Session Archive</h3>
                    </div>
                    <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-widest bg-muted text-muted-foreground border-transparent px-2">
                        Last 50 sessions
                    </Badge>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-muted/20 text-[10px] uppercase tracking-[0.2em] font-black text-muted-foreground/60 border-b border-border/40">
                                <th className="px-6 py-4">Context / Session</th>
                                <th className="px-6 py-4">Workspace</th>
                                <th className="px-6 py-4 text-right">Consumption</th>
                                <th className="px-6 py-4 text-right">Finalization</th>
                                <th className="px-6 py-4 text-center">Diagnostics</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                            {stats.recent_sessions?.map((session: SessionSummary) => (
                                <tr key={session.id} className="hover:bg-primary/[0.03] transition-all group">
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col gap-1.5 text-left">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-[11px] font-black text-foreground/90">{session.id.slice(0, 8)}...</span>
                                                <Badge variant="outline" className="text-[8px] uppercase font-black h-4 px-1.5 border-primary/20 text-primary bg-primary/5">
                                                    {session.source || 'agent'}
                                                </Badge>
                                            </div>
                                            <span className="text-[9px] font-mono text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors">{session.id}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-2.5 text-sm font-bold text-foreground/70 group-hover:text-primary transition-colors text-left">
                                            <div className="p-1.5 rounded-lg bg-muted/20 border border-border/10">
                                                <Folder size={12} className="opacity-60" />
                                            </div>
                                            {session.project_name || 'Global'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right font-mono text-xs font-black">
                                        <div className="flex flex-col items-end gap-0.5">
                                            <span className="text-primary/90 text-sm">{(session.total_input + session.total_output).toLocaleString()}</span>
                                            <span className="text-[8px] uppercase text-muted-foreground/30 font-black tracking-tighter">tokens</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right text-[10px] font-bold text-muted-foreground/60 tabular-nums">
                                        <div className="flex flex-col items-end">
                                            <span>{new Date(session.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                                            <span className="font-medium text-[9px] opacity-50">{new Date(session.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            {onCloneSession && (
                                                <AppTooltip content="Clone session & optimize parameters">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-9 w-9 p-0 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
                                                        onClick={() => onCloneSession(session)}
                                                    >
                                                        <RefreshCcw size={16} className="text-amber-500" strokeWidth={2.5} />
                                                    </Button>
                                                </AppTooltip>
                                            )}
                                            <AppTooltip content="Inspect telemetry data">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-9 w-9 p-0 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 border border-transparent hover:border-primary/20"
                                                    onClick={() => onInspectSession?.(session.id)}
                                                >
                                                    <Eye size={16} className="text-primary" strokeWidth={2.5} />
                                                </Button>
                                            </AppTooltip>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {(!stats.recent_sessions || stats.recent_sessions.length === 0) && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground italic text-xs uppercase tracking-widest font-black opacity-20">
                                        No historical session telemetry indexed
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
