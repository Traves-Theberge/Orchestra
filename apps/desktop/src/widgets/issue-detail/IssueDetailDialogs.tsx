import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { GitBranch, Loader2, ShieldCheck, Terminal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

export function PRReviewDialog({
  open,
  onOpenChange,
  prPending,
  prTitle,
  setPrTitle,
  prBody,
  setPrBody,
  prHead,
  onFinalize,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  prPending: boolean
  prTitle: string
  setPrTitle: (value: string) => void
  prBody: string
  setPrBody: (value: string) => void
  prHead: string
  onFinalize: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-none shadow-2xl p-0 overflow-hidden rounded-2xl">
        <div className="flex flex-col h-full max-h-[85vh]">
          <div className="p-6 border-b border-border/10 bg-muted/20">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                <GitBranch className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">Pull Request Review</DialogTitle>
                <DialogDescription className="text-muted-foreground/60">Review and refine the autonomously generated PR details.</DialogDescription>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8 space-y-6 custom-scrollbar">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">PR Title</label>
              <input
                className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 text-sm font-bold placeholder:text-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Description</label>
              <textarea
                className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 text-sm font-medium placeholder:text-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all min-h-[160px] leading-relaxed resize-none"
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Head Branch</label>
                <div className="flex items-center gap-2 bg-muted/30 border border-border/50 rounded-xl px-4 py-2 text-xs font-mono text-muted-foreground/80">
                  <GitBranch size={12} className="opacity-40" />
                  {prHead}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Base Branch</label>
                <div className="flex items-center gap-2 bg-muted/30 border border-border/50 rounded-xl px-4 py-2 text-xs font-mono text-muted-foreground/80">
                  <GitBranch size={12} className="opacity-40" />
                  main
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-border/10 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-500/80">
              <ShieldCheck size={14} />
              <span className="text-[9px] font-black uppercase tracking-widest">Signed & Verified</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={prPending} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-foreground">
                Discard
              </Button>
              <Button onClick={() => void onFinalize()} disabled={prPending || !prTitle.trim()} className="h-9 px-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 font-black uppercase tracking-widest text-[11px]">
                {prPending ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Creating...</span>
                  </div>
                ) : (
                  'Create Pull Request'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function HookOutputDialog({
  selectedHookLog,
  setSelectedHookLog,
}: {
  selectedHookLog: { id: string; label: string; output: string } | null
  setSelectedHookLog: (value: { id: string; label: string; output: string } | null) => void
}) {
  return (
    <Dialog open={!!selectedHookLog} onOpenChange={(open) => !open && setSelectedHookLog(null)}>
      <DialogContent className="max-w-4xl bg-card border-none shadow-2xl p-0 overflow-hidden rounded-2xl">
        <div className="flex flex-col h-[70vh]">
          <div className="p-4 border-b border-border/10 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                <Terminal className="h-4 w-4 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-sm font-bold tracking-tight">{selectedHookLog?.label} Output</DialogTitle>
                <DialogDescription className="text-[10px] text-muted-foreground/60">Execution transcript from the workspace lifecycle hook.</DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="h-5 px-2 text-[8px] font-black uppercase tracking-widest bg-white/5 border-border">
              {selectedHookLog?.id}
            </Badge>
          </div>

          <div className="flex-1 overflow-auto bg-black/40 p-6 font-mono text-xs leading-relaxed selection:bg-primary/30">
            <SyntaxHighlighter
              language="bash"
              style={oneDark}
              customStyle={{ margin: 0, padding: 0, background: 'transparent', fontSize: '11px', lineHeight: '1.6' }}
            >
              {selectedHookLog?.output || 'No output captured for this hook.'}
            </SyntaxHighlighter>
          </div>

          <div className="p-4 border-t border-border/10 bg-muted/20 flex items-center justify-end">
            <Button size="sm" onClick={() => setSelectedHookLog(null)} className="h-8 px-4 text-[10px] font-black uppercase tracking-widest">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
