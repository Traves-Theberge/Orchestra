import React, { useMemo } from 'react'
import { Database, TrendingUp, Zap, Cpu, History as HistoryIcon, Search, Eye } from 'lucide-react'
import type { GlobalStats } from '@/lib/orchestra-types'
import { Badge } from '@/components/ui/badge'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'

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
            <div className="p-8 space-y-8 animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-32 bg-background/40 rounded-xl border border-white/5" />
                    ))}
                </div>
                <div className="h-64 bg-background/40 rounded-xl border border-white/5" />
            </div>
        )
    }

    return (
        <div className="p-8 space-y-8 overflow-y-auto h-full custom-scrollbar">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 rounded-full bg-primary/10 text-primary">
                    <Database size={24} />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Warehouse Analytics</h1>
                    <p className="text-muted-foreground">Historical token consumption and agent fleet metrics.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-emerald-500">
                        <Zap size={64} />
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-widest">Total Input</p>
                    <h3 className="text-4xl font-black mb-1">{(stats.total_input / 1000).toFixed(1)}k</h3>
                    <p className="text-xs text-emerald-500/70 font-mono font-bold">tokens ingested</p>
                </div>

                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-primary">
                        <TrendingUp size={64} />
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-widest">Total Output</p>
                    <h3 className="text-4xl font-black mb-1">{(stats.total_output / 1000).toFixed(1)}k</h3>
                    <p className="text-xs text-primary/70 font-mono font-bold">tokens generated</p>
                </div>

                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 relative overflow-hidden group shadow-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-blue-500">
                        <Cpu size={64} />
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-widest">Avg. Efficiency</p>
                    <h3 className="text-4xl font-black mb-1">{((stats.total_output / Math.max(stats.total_input, 1)) * 100).toFixed(1)}%</h3>
                    <p className="text-xs text-blue-500/70 font-mono font-bold">output ratio</p>
                </div>
            </div>

            {chartData.length > 0 && (
                <div className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-sm">
                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-6">Token Burn Trajectory</h3>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#hsl(var(--primary))" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#hsl(var(--primary))" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="name" stroke="#666" fontSize={10} tickMargin={10} />
                                <YAxis stroke="#666" fontSize={10} tickFormatter={(v) => `${v/1000}k`} width={40} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '12px', fontSize: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
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
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-muted/10">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <HistoryIcon size={18} className="text-primary" />
                        Session Archive
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-white/5 px-2 py-1 rounded">
                            Last 50 sessions
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 text-[10px] uppercase tracking-widest font-black text-muted-foreground/60 border-b border-white/5">
                                <th className="px-6 py-4">Session ID</th>
                                <th className="px-6 py-4">Project</th>
                                <th className="px-6 py-4 text-right">Tokens</th>
                                <th className="px-6 py-4 text-right">Timestamp</th>
                                <th className="px-6 py-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {stats.recent_sessions?.map((session: any) => (
                                <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-medium">{session.id.slice(0, 8)}...</span>
                                            <Badge variant="outline" className="text-[9px] uppercase font-bold h-4 px-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                                                {session.source || 'agent'}
                                            </Badge>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{session.project_name || 'Global'}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-xs font-bold">
                                        <span className="text-primary/80">{(session.total_input + session.total_output).toLocaleString()}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right text-xs text-muted-foreground">
                                        {new Date(session.updated_at).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-center">
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
                                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground italic text-sm">
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
