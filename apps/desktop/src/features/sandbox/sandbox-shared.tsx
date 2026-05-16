import { CheckCircle2, CircleDashed } from 'lucide-react'

export type PillStatus = 'connected' | 'configured' | 'not-configured'

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{children}</label>
  )
}

export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none disabled:opacity-50"
    />
  )
}

export function StatusMessage({ message }: { message: string }) {
  if (!message) return null
  const isError = /fail|error|invalid/i.test(message)
  return (
    <p className={`text-[11px] font-medium ${isError ? 'text-red-500' : 'text-emerald-500'}`}>
      {message}
    </p>
  )
}

export function TabStatusPill({ status }: { status: PillStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    )
  }
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-500">
        <CheckCircle2 className="size-3" />
        Configured
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/60">
      <CircleDashed className="size-3" />
      Not configured
    </span>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold tracking-tight text-muted-foreground/70">{label}</label>
      {children}
    </div>
  )
}

export function SectionBlock({ label, trailing, children }: { label: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground/60">{label}</h3>
        {trailing}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function ResourceRow({ icon, label, id, meta, statusLabel, statusColor }: {
  icon: React.ReactNode
  label?: string
  id: string
  meta?: string
  statusLabel: string
  statusColor: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 h-9 rounded-md hover:bg-foreground/[0.03] transition-colors">
      <div className="flex items-center gap-2.5 min-w-0 text-[11.5px]">
        {icon}
        {label && <span className="text-muted-foreground/70">{label}</span>}
        <span className="font-mono text-foreground/80 truncate">{id}</span>
        {meta && <span className="text-muted-foreground/60">{meta}</span>}
      </div>
      <span className={`text-[10px] font-semibold shrink-0 ${statusColor}`}>{statusLabel}</span>
    </div>
  )
}
