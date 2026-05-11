// apps/desktop/src/features/agents/components/EmptyStateCard.tsx
import { Button } from '@ui/button'
import { Plus } from 'lucide-react'

interface EmptyStateCardProps {
  title: string
  description: string
  ctaLabel: string
  onCreate: () => void
  pending?: boolean
}

export function EmptyStateCard({ title, description, ctaLabel, onCreate, pending }: EmptyStateCardProps) {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[200px]">
      <div className="max-w-sm text-center space-y-3 px-6 py-8">
        <h3 className="text-[13px] font-semibold text-foreground/85">{title}</h3>
        <p className="text-[11px] text-foreground/50 leading-relaxed">{description}</p>
        <Button onClick={onCreate} disabled={pending} size="sm" className="h-7 text-[11px] mt-2">
          <Plus size={11} className="mr-1.5" />
          {pending ? 'Creating…' : ctaLabel}
        </Button>
      </div>
    </div>
  )
}
