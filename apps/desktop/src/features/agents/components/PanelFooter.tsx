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
    <footer className="flex items-center justify-between gap-3 pt-3 mt-auto border-t border-border/20">
      <div>{extraLeft}</div>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={saving}
            className="h-7 text-[10px]"
          >
            <RotateCcw size={11} className="mr-1.5" /> Discard
          </Button>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          className="h-7 px-4 rounded-md bg-primary text-primary-foreground font-semibold text-[11px] disabled:opacity-40"
        >
          {saving ? (
            <><Loader2 size={11} className="animate-spin mr-1.5" /> Saving…</>
          ) : (
            <><Save size={11} className="mr-1.5" /> Save</>
          )}
        </Button>
      </div>
    </footer>
  )
}
