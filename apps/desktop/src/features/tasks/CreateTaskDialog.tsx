import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogContent,
} from '@ui/dialog'
import { getWhisperClient, setWhisperBackendConfig, type WhisperStatus } from '@/workers/whisper-client'
import { validateTaskTitle, validateTaskDescription } from '@core/utils/validation'
import {
  type BackendConfig,
  type IssueCreatePayload,
  type MCPTool,
  type RuntimeEntry,
} from '@core/api/client'
import type { Project } from '@core/api/types'
import { AgentSelector, ProjectSelector, RuntimeSelector } from '@layout/shared/controls'

export function CreateTaskDialog({
  open,
  onOpenChange,
  config,
  initialState,
  availableAgents,
  allTools: _allTools = [],
  projects = [],
  initialProjectID = '',
  availableRuntimes = [],
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: BackendConfig | null
  initialState: string
  availableAgents: string[]
  allTools?: MCPTool[]
  projects?: Project[]
  initialProjectID?: string
  availableRuntimes?: RuntimeEntry[]
  onSubmit: (payload: IssueCreatePayload) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const state = 'Backlog'
  const [assignee, setAssignee] = useState(availableAgents.length > 0 ? `agent-${availableAgents[0]}` : 'Unassigned')
  const [provider, setProvider] = useState('')
  const [runtimeTarget, setRuntimeTarget] = useState('LOCAL')
  const [disabledTools, setDisabledTools] = useState<string[]>([])
  const [projectID, setProjectID] = useState(initialProjectID || (projects.length > 0 ? projects[0].id : ''))
  const [pending, setPending] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [descError, setDescError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [recording, setRecording] = useState(false)
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus>({ state: 'idle' })
  const transcriptionCancelledRef = useRef(false)
  const activeFieldRef = useRef<'title' | 'description'>('description')

  useEffect(() => {
    setWhisperBackendConfig(config)
  }, [config])

  useEffect(() => {
    if (open) {
      setProjectID(initialProjectID || (projects.length > 0 ? projects[0].id : ''))
      setTitle('')
      setDescription('')
      setAssignee(availableAgents.length > 0 ? `agent-${availableAgents[0]}` : 'Unassigned')
      setProvider(availableAgents.length > 0 ? availableAgents[0] : '')
      setRuntimeTarget('LOCAL')
      setDisabledTools([])
      setSubmitError('')
    }
  }, [open, initialProjectID, availableAgents, projects])

  useEffect(() => {
    if (!open) {
      const client = getWhisperClient()
      if (client.recording) {
        void client.stopRecording()
      }
      transcriptionCancelledRef.current = true
      setRecording(false)
      setWhisperStatus({ state: 'idle' })
    } else {
      transcriptionCancelledRef.current = false
    }
  }, [open])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const tErr = validateTaskTitle(title)
    const dErr = validateTaskDescription(description)
    setTitleError(tErr)
    setDescError(dErr)
    if (tErr || dErr) return
    if (!description.trim()) {
      setDescError('Description is required')
      return
    }
    if (!assignee || assignee === 'Unassigned') {
      setSubmitError('An agent must be assigned')
      return
    }
    setPending(true)
    setSubmitError('')
    try {
      await onSubmit({
        title,
        description,
        state,
        assignee_id: assignee,
        project_id: projectID,
        provider,
        runtime_target: runtimeTarget !== 'LOCAL' ? runtimeTarget : undefined,
        disabled_tools: disabledTools
      })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task creation failed'
      setSubmitError(message)
    } finally {
      setPending(false)
    }
  }

  const startRecording = async () => {
    if (recording || whisperStatus.state !== 'idle') return
    try {
      const client = getWhisperClient(setWhisperStatus)
      await client.startRecording()
      setRecording(true)
      setSubmitError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microphone access failed'
      setSubmitError(message)
    }
  }

  const stopRecording = async () => {
    if (!recording) return
    setRecording(false)
    try {
      const client = getWhisperClient(setWhisperStatus)
      const pcm = await client.stopRecording()
      if (transcriptionCancelledRef.current) return
      const text = await client.transcribe(pcm)
      if (!transcriptionCancelledRef.current && text.trim()) {
        if (activeFieldRef.current === 'title') {
          setTitle((prev) => (prev.trim() ? `${prev.trimEnd()} ${text.trim()}` : text.trim()))
        } else {
          setDescription((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text.trim()}` : text.trim()))
        }
      }
    } catch (error) {
      if (!transcriptionCancelledRef.current) {
        const message = error instanceof Error ? error.message : 'Transcription failed'
        setSubmitError(message)
      }
    } finally {
      if (!transcriptionCancelledRef.current) {
        setWhisperStatus({ state: 'idle' })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent srTitle="Create new task" className="max-w-5xl w-[90vw] bg-background border border-border/50 shadow-2xl shadow-black/30 p-0 overflow-hidden min-h-[55vh] max-h-[85vh] flex flex-col rounded-xl">
        <form onSubmit={handleSubmit} className="flex flex-col h-full flex-1">
          <div className="px-8 pt-8 pb-3 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">New task</p>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden px-8 pb-4 space-y-3">
            <input
              autoFocus
              className="w-full bg-transparent border-none outline-none text-3xl font-black tracking-tight placeholder:text-muted-foreground/30 focus:ring-0 focus:outline-none p-0 selection:bg-primary/30"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleError('') }}
              onFocus={() => { activeFieldRef.current = 'title' }}
              required
            />
            {titleError && <p className="text-[11px] text-destructive">{titleError}</p>}
            <div
              className="flex-1 min-h-0 cursor-text"
              onClick={(e) => {
                const ta = (e.currentTarget as HTMLElement).querySelector('textarea')
                if (ta && e.target === e.currentTarget) ta.focus()
              }}
            >
              <textarea
                className="w-full h-full bg-transparent border-none outline-none text-[13px] text-foreground/80 placeholder:text-muted-foreground/30 focus:ring-0 focus:outline-none p-0 resize-none min-h-0 selection:bg-primary/20 leading-relaxed"
                placeholder="Describe the task for the agent…"
                value={description}
                onChange={(e) => { setDescription(e.target.value); setDescError('') }}
                onFocus={() => { activeFieldRef.current = 'description' }}
              />
            </div>
            {descError && <p className="text-[11px] text-destructive">{descError}</p>}
          </div>

          {submitError && (
            <div className="mx-8 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {submitError}
            </div>
          )}

          <div className="px-6 py-3 flex items-center justify-between border-t border-border/40">
            <div className="flex items-center gap-1">
              <ProjectSelector
                value={projectID}
                projects={projects}
                onChange={setProjectID}
              />
              <div className="w-px h-4 bg-border/40 mx-1" />
              <AgentSelector
                value={assignee}
                agents={availableAgents}
                onChange={(val) => {
                  setAssignee(val)
                  const agentName = val.replace('agent-', '')
                  if (availableAgents.includes(agentName)) {
                    setProvider(agentName)
                  } else if (val === '') {
                    setProvider(availableAgents.length > 0 ? availableAgents[0] : '')
                  }
                }}
              />
              {availableRuntimes.filter((r) => r.configured && r.target !== 'LOCAL').length > 0 && (
                <>
                  <div className="w-px h-4 bg-border/40 mx-1" />
                  <RuntimeSelector
                    value={runtimeTarget}
                    runtimes={[{ target: 'LOCAL', configured: true }, ...availableRuntimes.filter((r) => r.configured)]}
                    onChange={setRuntimeTarget}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onPointerDown={(event) => { event.preventDefault(); void startRecording() }}
                onPointerUp={(event) => { event.preventDefault(); void stopRecording() }}
                onPointerLeave={() => { void stopRecording() }}
                onPointerCancel={() => { void stopRecording() }}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault()
                    void startRecording()
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault()
                    void stopRecording()
                  }
                }}
                disabled={whisperStatus.state !== 'idle' && !recording}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[12px] font-medium tracking-tight touch-none transition-colors ${
                  recording
                    ? 'text-destructive bg-destructive/10'
                    : whisperStatus.state !== 'idle'
                      ? 'text-amber-500 bg-amber-500/10'
                      : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                {recording ? (
                  <><Square className="h-3.5 w-3.5" /> Release</>
                ) : whisperStatus.state === 'loading' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin-smooth" /> Loading {whisperStatus.progress}%</>
                ) : whisperStatus.state === 'transcribing' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin-smooth" /> Transcribing</>
                ) : (
                  <><Mic className="h-3.5 w-3.5" /> Hold to talk</>
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="h-9 px-3.5 rounded-md text-[12px] font-medium tracking-tight text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !title.trim() || !description.trim() || !projectID || !assignee || assignee === 'Unassigned'}
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-foreground text-background hover:bg-foreground/90 text-[12.5px] font-semibold tracking-tight transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin-smooth" /> : 'Create task'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
