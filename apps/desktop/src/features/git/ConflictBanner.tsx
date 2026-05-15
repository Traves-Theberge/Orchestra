interface ConflictBannerProps {
  conflicts: { in_merge: boolean; files: string[] }
  onResolve: (file: string) => void
  onAbort: () => void
}

export function ConflictBanner({ conflicts, onResolve, onAbort }: ConflictBannerProps) {
  if (!conflicts.in_merge || conflicts.files.length === 0) {
    return null
  }

  return (
    <div className="bg-amber-500/[0.06] border-b border-amber-500/20 px-5 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-semibold tracking-tight text-amber-500">
          Merge in progress: {conflicts.files.length} conflicted file{conflicts.files.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={onAbort}
          className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          Abort merge
        </button>
      </div>
      <div className="space-y-0.5">
        {conflicts.files.map((file) => (
          <div key={file} className="flex items-center justify-between gap-3 px-2 py-1 rounded hover:bg-foreground/[0.03] transition-colors">
            <span className="text-[11.5px] font-mono text-foreground/85 truncate">{file}</span>
            <button
              onClick={() => onResolve(file)}
              className="text-[10.5px] font-medium text-amber-500 hover:text-amber-400 shrink-0 transition-colors"
            >
              Mark resolved
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
