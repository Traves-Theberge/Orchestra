import React, { useMemo } from 'react'
import { Database, TrendingUp, Zap, Cpu, History as HistoryIcon, Search, Eye } from 'lucide-react'
import type { GlobalStats } from '@/lib/orchestra-types'
import { Badge } from '@/components/ui/badge'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'

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
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ stats, loading, onInspectSession }) => {
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
        <div className="p-6 space-y-6 overflow-y-auto h-full custom-scrollbar">
            <div className="flex items-center gap-4 mb-6">
                <div className="p-1.5 rounded-full bg-primary/10 text-primary">
                    <Database size={16} />
                </div>
                <div>
                    <h1 className="text-xl font-bold tracking-tight leading-none">Warehouse Analytics</h1>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Historical token consumption and agent fleet metrics.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-5 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-emerald-500">
                        <Zap size={32} />
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground mb-1 uppercase tracking-widest leading-none">Total Input</p>
                    <h3 className="text-3xl font-black leading-tight">{(stats.total_input / 1000).toFixed(1)}k</h3>
                    <p className="text-[11px] text-emerald-500/70 font-mono font-bold uppercase tracking-tight leading-none">
                        ~${calculateCost(stats.total_input, 'input').toFixed(2)} USD
                    </p>
                </div>

                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-5 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-primary">
                        <TrendingUp size={32} />
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground mb-1 uppercase tracking-widest leading-none">Total Output</p>
                    <h3 className="text-3xl font-black leading-tight">{(stats.total_output / 1000).toFixed(1)}k</h3>
                    <p className="text-[11px] text-primary/70 font-mono font-bold uppercase tracking-tight leading-none">
                        ~${calculateCost(stats.total_output, 'output').toFixed(2)} USD
                    </p>
                </div>

                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-5 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-blue-500">
                        <Cpu size={32} />
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground mb-1 uppercase tracking-widest leading-none">Avg. Efficiency</p>
                    <h3 className="text-3xl font-black leading-tight">{((stats.total_output / Math.max(stats.total_input, 1)) * 100).toFixed(1)}%</h3>
                    <p className="text-[11px] text-blue-500/70 font-mono font-bold uppercase tracking-tight leading-none">output ratio</p>
                </div>

                <div className="bg-background/40 backdrop-blur-md border border-primary/20 rounded-xl p-5 relative overflow-hidden group shadow-md ring-1 ring-primary/10">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-primary">
                        <TrendingUp size={32} />
                    </div>
                    <p className="text-[11px] font-bold text-primary/60 mb-1 uppercase tracking-widest leading-none">Total Cost</p>
                    <h3 className="text-3xl font-black leading-tight text-primary">
                        ${(calculateCost(stats.total_input, 'input') + calculateCost(stats.total_output, 'output')).toFixed(2)}
                    </h3>
                    <p className="text-[11px] text-muted-foreground font-mono font-bold uppercase tracking-tight leading-none">estimated usd</p>
                </div>
            </div>

            {chartData.length > 0 && (
                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-sm">
                    <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4 leading-none">Token Burn Trajectory</h3>
                    <div className="h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#hsl(var(--primary))" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#hsl(var(--primary))" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="name" stroke="#666" fontSize={10} tickMargin={10} />
                                <YAxis stroke="#666" fontSize={10} tickFormatter={(v) => `${v / 1000}k`} width={40} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '12px', fontSize: '11px', border: '1px solid rgba(255,255,255,0.1)' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="monotone" dataKey="input" stroke="#10b981" fillOpacity={1} fill="url(#colorInput)" stackId="1" />
                                <Area type="monotone" dataKey="output" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorOutput)" stackId="1" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-sm">
                <div className="p-2.5 border-b border-white/5 flex items-center justify-between bg-muted/10">
                    <h3 className="text-base font-bold flex items-center gap-2">
                        <HistoryIcon size={16} className="text-primary" />
                        Session Archive
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-white/5 px-2 py-0.5 rounded">
                            Last 50 sessions
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 text-[11px] uppercase tracking-[0.2em] font-black text-muted-foreground/50 border-b border-white/5">
                                <th className="px-4 py-4">Session ID</th>
                                <th className="px-4 py-4">Project</th>
                                <th className="px-4 py-4 text-right">Tokens</th>
                                <th className="px-4 py-4 text-right">Timestamp</th>
                                <th className="px-4 py-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {stats.recent_sessions?.map((session: any) => (
                                <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-sm font-medium">{session.id.slice(0, 8)}...</span>
                                            <Badge variant="outline" className="text-[10px] uppercase font-bold h-5 px-2 opacity-40 group-hover:opacity-100 transition-opacity leading-none">
                                                {session.source || 'agent'}
                                            </Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{session.project_name || 'Global'}</span>
                                    </td>
                                    <td className="px-4 py-4 text-right font-mono text-sm font-bold">
                                        <span className="text-primary/80">{(session.total_input + session.total_output).toLocaleString()}</span>
                                    </td>
                                    <td className="px-4 py-4 text-right text-[11px] text-muted-foreground">
                                        {new Date(session.updated_at).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => onInspectSession?.(session.id)}
                                        >
                                            <Eye size={14} className="text-primary" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                            {(!stats.recent_sessions || stats.recent_sessions.length === 0) && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic text-xs">
                                        No historical sessions indexed in warehouse.
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
