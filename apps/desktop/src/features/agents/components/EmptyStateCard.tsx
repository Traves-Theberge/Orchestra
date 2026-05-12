// apps/desktop/src/features/agents/components/EmptyStateCard.tsx
import { Button } from '@ui/button'
import { Plus } from 'lucide-react'
import { TOKENS } from '../tokens'

interface EmptyStateCardProps {
  title: string
  description: string
  ctaLabel: string
  onCreate: () => void
  pending?: boolean
}

export function EmptyStateCard({ title, description, ctaLabel, onCreate, pending }: EmptyStateCardProps) {
  return (
    <div className={`flex flex-1 items-center justify-center ${TOKENS.surfaceEmpty}`}>
      <div className="max-w-sm space-y-3">
        <h3 className={TOKENS.textTitle}>{title}</h3>
        <p className={TOKENS.textSub}>{description}</p>
        <Button onClick={onCreate} disabled={pending} size="sm" className="h-7 rounded-lg px-3 text-xs">
          <Plus size={12} className="mr-1.5" />
          {pending ? 'Creating…' : ctaLabel}
        </Button>
      </div>
    </div>
  )
}
