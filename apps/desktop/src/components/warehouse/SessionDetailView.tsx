import React from 'react'
import { History, Zap, Activity, Clock, ShieldCheck, Database, Layout, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SessionDetail, SessionEvent } from '@/lib/orchestra-types'

interface SessionDetailViewProps {
    session: SessionDetail
}

export const SessionDetailView: React.FC<SessionDetailViewProps> = ({ session }) => {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-muted/30 p-3 rounded-lg border border-border/40">
                    <div className="flex items-center gap-2 mb-1 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                        <Activity size={12} />
                        Provider
                    </div>
                    <div className="text-sm font-bold uppercase tracking-tight">{session.provider}</div>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg border border-border/40">
                    <div className="flex items-center gap-2 mb-1 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                        <Zap size={12} />
                        Compute
                    </div>
                    <div className="text-sm font-bold">{(session.total_input + session.total_output).toLocaleString()} tokens</div>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg border border-border/40">
                    <div className="flex items-center gap-2 mb-1 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                        <Clock size={12} />
                        Timestamp
                    </div>
                    <div className="text-sm font-medium">{new Date(session.created_at).toLocaleString()}</div>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg border border-border/40">
                    <div className="flex items-center gap-2 mb-1 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                        <Layout size={12} />
                        Project
                    </div>
                    <div className="text-sm font-medium truncate">{session.project_name || 'Global'}</div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Terminal size={14} />
                    Execution Timeline
                </h3>
                <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden shadow-inner">
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                        {session.events?.map((event: SessionEvent, idx: number) => (
                            <div key={idx} className="p-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors group">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <Badge variant="outline" className="text-[10px] font-bold uppercase h-5 bg-background">
                                            {event.kind}
                                        </Badge>
                                        <span className="text-[10px] font-mono text-muted-foreground opacity-60">
                                            {new Date(event.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className="text-[9px] font-mono text-muted-foreground flex gap-2">
                                        {(event.input_tokens ?? 0) > 0 && <span className="text-emerald-500/70">+{event.input_tokens ?? 0} IN</span>}
                                        {(event.output_tokens ?? 0) > 0 && <span className="text-blue-500/70">+{event.output_tokens ?? 0} OUT</span>}
                                    </div>
                                </div>
                                <p className="text-sm text-foreground leading-relaxed pl-1 border-l-2 border-primary/20 group-hover:border-primary transition-colors">
                                    {event.message}
                                </p>
                                {event.raw_payload && (
                                    <div className="mt-3 rounded-lg bg-card/40 p-3 border border-border hidden group-hover:block animate-in fade-in slide-in-from-top-1 duration-200">
                                        <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto">
                                            {event.raw_payload}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))}
                        {(!session.events || session.events.length === 0) && (
                            <div className="py-20 text-center opacity-30 italic text-sm">
                                No fine-grained execution events recorded.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
