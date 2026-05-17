import { useEffect, useMemo, useState } from 'react'
import {
  applyStudioTemplate,
  createStudioSession,
  discardStudioSession,
  getStudioDraft,
  patchStudioDraft,
  pushStudioToBacklog,
  sendStudioMessage,
  studioEventsURL,
  type BackendConfig,
} from '@core/api/client'
import { Button } from '@ui/button'
import { CustomDropdown } from '@layout/shared/controls'
import { StudioChat } from './chat/StudioChat'
import { useStudioSession, type StudioSessionClient } from './chat/useStudioSession'
import { DraftPanel } from './draft/DraftPanel'
import { TemplateLibrary } from './templates/TemplateLibrary'
import { useTemplates } from './templates/useTemplates'

export interface StudioSectionProps {
  config: BackendConfig
  projectId: string
}

const RUNNERS = ['claude-code', 'codex', 'opencode', 'gemini']
const RUNNER_OPTIONS = RUNNERS.map((r) => ({ label: r, value: r }))

export function StudioSection({ config, projectId }: StudioSectionProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [runner, setRunner] = useState(RUNNERS[0])
  const [pushing, setPushing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const client = useMemo<StudioSessionClient>(
    () => ({
      studioEventsURL: (id) => studioEventsURL(config, id),
      getStudioDraft: (id) => getStudioDraft(config, id),
      sendStudioMessage: (id, m) => sendStudioMessage(config, id, m),
      patchStudioDraft: (id, p) => patchStudioDraft(config, id, p),
      pushStudioToBacklog: (id) => pushStudioToBacklog(config, id),
      discardStudioSession: (id) => discardStudioSession(config, id),
    }),
    [config],
  )

  useEffect(() => {
    if (sessionId) return
    let cancelled = false
    createStudioSession(config, { project_id: projectId, runner })
      .then((h) => {
        if (!cancelled) setSessionId(h.session_id)
      })
      .catch((err) => {
        if (!cancelled) setStartError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [config, projectId, runner, sessionId])

  if (startError) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to start studio session: {startError}
      </div>
    )
  }
  if (!sessionId) {
    return <div className="p-6 text-sm text-muted-foreground">Starting studio session…</div>
  }

  return (
    <StudioBody
      sessionId={sessionId}
      runner={runner}
      onRunnerChange={(r) => { setRunner(r); setSessionId(null) }}
      client={client}
      config={config}
      pushing={pushing}
      setPushing={setPushing}
      onPushed={(issueId) => { setToast(`Pushed to backlog: ${issueId}`); setSessionId(null) }}
      onDiscarded={() => setSessionId(null)}
      toast={toast}
      clearToast={() => setToast(null)}
    />
  )
}

function StudioBody({
  sessionId,
  runner,
  onRunnerChange,
  client,
  config,
  pushing,
  setPushing,
  onPushed,
  onDiscarded,
  toast,
  clearToast,
}: {
  sessionId: string
  runner: string
  onRunnerChange: (runner: string) => void
  client: StudioSessionClient
  config: BackendConfig
  pushing: boolean
  setPushing: (b: boolean) => void
  onPushed: (issueId: string) => void
  onDiscarded: () => void
  toast: string | null
  clearToast: () => void
}) {
  const { draft, messages, sendMessage, editDraft, push, discard } = useStudioSession(sessionId, client)
  const { templates, save: saveTemplate, remove: removeTemplate } = useTemplates(config)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const applyTemplate = async (name: string, vars: Record<string, string>) => {
    setTemplateError(null)
    try {
      await applyStudioTemplate(config, sessionId, name, vars)
      setLibraryOpen(false)
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err))
    }
  }

  const pushDisabledReason = !draft
    ? 'Loading draft…'
    : !draft.title.trim()
      ? 'Title required'
      : !draft.description.trim()
        ? 'Description required'
        : undefined

  const handlePush = async () => {
    setPushing(true)
    try {
      const { issue_id } = await push()
      onPushed(issue_id)
    } finally {
      setPushing(false)
    }
  }

  const handleDiscard = async () => {
    await discard()
    onDiscarded()
  }

  return (
    <div className="h-full flex relative">
      <div className="flex-[1.4] min-w-0 flex flex-col">
        <div className="px-2 py-1 border-b border-border flex items-center">
          <CustomDropdown
            className="bg-transparent border-none hover:bg-muted/20 !h-10 !px-3 rounded-lg transition-colors shadow-none"
            value={runner}
            options={RUNNER_OPTIONS}
            onChange={onRunnerChange}
            direction="down"
            triggerContent={
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground/70 uppercase">
                <span className="truncate max-w-[120px]">{runner}</span>
              </div>
            }
          />
        </div>
        <div className="flex-1 min-h-0">
          <StudioChat messages={messages} onSend={sendMessage} runner={runner} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {draft && (
          <DraftPanel
            draft={draft}
            onChange={editDraft}
            onPush={handlePush}
            onDiscard={handleDiscard}
            onBrowseTemplates={() => setLibraryOpen(true)}
            pushing={pushing}
            pushDisabledReason={pushDisabledReason}
          />
        )}
      </div>
      {libraryOpen && (
        <TemplateLibrary
          templates={templates}
          onApply={applyTemplate}
          onSave={saveTemplate}
          onDelete={removeTemplate}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {templateError && (
        <div className="absolute bottom-16 right-4 bg-destructive text-destructive-foreground text-xs px-3 py-2 rounded shadow max-w-sm">
          {templateError}
        </div>
      )}
      {toast && (
        <Button
          type="button"
          onClick={clearToast}
          className="absolute bottom-4 right-4 shadow"
          size="sm"
        >
          {toast}
        </Button>
      )}
    </div>
  )
}
