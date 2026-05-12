import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@ui/button'

interface PanelFooterProps {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  extraLeft?: React.ReactNode
}

export function PanelFooter({ dirty, saving, onSave, onDiscard, extraLeft }: PanelFooterProps) {
  return (
    <footer className="flex items-center justify-between gap-3 pt-4 mt-auto">
      <div className="text-xs text-muted-foreground">{extraLeft}</div>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={saving}
            className="h-7 text-xs"
          >
            <RotateCcw size={12} className="mr-1.5" /> Discard
          </Button>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          className="h-7 rounded-lg px-3 text-xs font-medium"
        >
          {saving ? (
            <><Loader2 size={12} className="animate-spin mr-1.5" /> Saving…</>
          ) : (
            <><Save size={12} className="mr-1.5" /> Save</>
          )}
        </Button>
      </div>
    </footer>
  )
}
