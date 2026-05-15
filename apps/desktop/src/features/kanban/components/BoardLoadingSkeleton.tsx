import { Skeleton } from '@ui/skeleton'

export function BoardLoadingSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0 gap-6">
      <div className="flex items-center gap-3 border-b border-border/40 pb-4 shrink-0">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 min-h-0">
        <div className="h-full grid gap-3 min-w-[640px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          {['backlog', 'todo', 'progress', 'review', 'done'].map((column) => (
            <div key={column} className="flex flex-col min-h-0 gap-4">
              <div className="flex items-center justify-between px-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-2 rounded-full" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <div className="flex-1 space-y-3 overflow-hidden p-1">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="bg-card/40 border border-border/50 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <Skeleton className="h-4 w-16 rounded" />
                      <Skeleton className="size-4 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-2/3 rounded" />
                    <div className="pt-2 flex gap-2">
                      <Skeleton className="h-4 w-12 rounded-full" />
                      <Skeleton className="h-4 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
