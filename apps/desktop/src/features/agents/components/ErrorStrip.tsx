import { AlertCircle, X } from 'lucide-react'

interface ErrorStripProps {
  message: string
  onDismiss: () => void
}

export function ErrorStrip({ message, onDismiss }: ErrorStripProps) {
  if (!message) return null
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/[0.06] text-[11px] text-red-400">
      <AlertCircle size={12} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 text-red-400/60 hover:text-red-400"
      >
        <X size={12} />
      </button>
    </div>
  )
}
