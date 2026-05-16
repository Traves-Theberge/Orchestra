import { useEffect, useReducer, useRef, useState, type Dispatch } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
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

const EMPTY_TOOLS: readonly MCPTool[] = []
const EMPTY_PROJECTS: readonly Project[] = []
const EMPTY_RUNTIMES: readonly RuntimeEntry[] = []

type FormState = {
  title: string
  description: string
  assignee: string
  provider: string
  runtimeTarget: string
  disabledTools: string[]
  projectID: string
  pending: boolean
  titleError: string
  descError: string
  submitError: string
}

type FormAction =
  | { type: 'set-title'; value: string }
  | { type: 'set-description'; value: string }
  | { type: 'set-assignee'; value: string }
  | { type: 'set-provider'; value: string }
  | { type: 'set-runtime-target'; value: string }
  | { type: 'set-disabled-tools'; value: string[] }
  | { type: 'set-project'; value: string }
  | { type: 'set-pending'; value: boolean }
  | { type: 'set-title-error'; value: string }
  | { type: 'set-desc-error'; value: string }
  | { type: 'set-submit-error'; value: string }
  | { type: 'submit-validation'; titleError: string; descError: string }
  | { type: 'append-voice'; field: 'title' | 'description'; text: string }

function initialFormState(availableAgents: string[], initialProjectID: string, projects: readonly Project[]): FormState {
  return {
    title: '',
    description: '',
    assignee: availableAgents.length > 0 ? `agent-${availableAgents[0]}` : 'Unassigned',
    provider: availableAgents.length > 0 ? availableAgents[0] : '',
    runtimeTarget: 'LOCAL',
    disabledTools: [],
    projectID: initialProjectID || (projects.length > 0 ? projects[0].id : ''),
    pending: false,
    titleError: '',
    descError: '',
    submitError: '',
  }
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'set-title':
      return { ...state, title: action.value, titleError: '' }
    case 'set-description':
      return { ...state, description: action.value, descError: '' }
    case 'set-assignee':
      return { ...state, assignee: action.value }
    case 'set-provider':
      return { ...state, provider: action.value }
    case 'set-runtime-target':
      return { ...state, runtimeTarget: action.value }
    case 'set-disabled-tools':
      return { ...state, disabledTools: action.value }
    case 'set-project':
      return { ...state, projectID: action.value }
    case 'set-pending':
      return { ...state, pending: action.value }
    case 'set-title-error':
      return { ...state, titleError: action.value }
    case 'set-desc-error':
      return { ...state, descError: action.value }
    case 'set-submit-error':
      return { ...state, submitError: action.value }
    case 'submit-validation':
      return { ...state, titleError: action.titleError, descError: action.descError }
    case 'append-voice': {
      if (action.field === 'title') {
        const next = state.title.trim() ? `${state.title.trimEnd()} ${action.text.trim()}` : action.text.trim()
        return { ...state, title: next }
      }
      const next = state.description.trim() ? `${state.description.trimEnd()}\n${action.text.trim()}` : action.text.trim()
      return { ...state, description: next }
    }
    default:
      return state
  }
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  config,
  initialState: _initialState,
  availableAgents,
  allTools: _allTools = EMPTY_TOOLS,
  projects = EMPTY_PROJECTS,
  initialProjectID = '',
  availableRuntimes = EMPTY_RUNTIMES,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: BackendConfig | null
  initialState: string
  availableAgents: string[]
  allTools?: readonly MCPTool[]
  projects?: readonly Project[]
  initialProjectID?: string
  availableRuntimes?: readonly RuntimeEntry[]
  onSubmit: (payload: IssueCreatePayload) => Promise<void>
}) {
  void _initialState
  void _allTools
  useEffect(() => {
    setWhisperBackendConfig(config)
  }, [config])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent srTitle="Create new task" className="max-w-5xl w-[90vw] bg-background border border-border/50 shadow-2xl shadow-black/30 p-0 overflow-hidden min-h-[55vh] max-h-[85vh] flex flex-col rounded-xl">
        {open ? (
          <CreateTaskForm
            key={`${initialProjectID}|${availableAgents.join(',')}`}
            onOpenChange={onOpenChange}
            availableAgents={availableAgents}
            projects={projects}
            initialProjectID={initialProjectID}
            availableRuntimes={availableRuntimes}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CreateTaskForm({
  onOpenChange,
  availableAgents,
  projects,
  initialProjectID,
  availableRuntimes,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void
  availableAgents: string[]
  projects: readonly Project[]
  initialProjectID: string
  availableRuntimes: readonly RuntimeEntry[]
  onSubmit: (payload: IssueCreatePayload) => Promise<void>
}) {
  const [state, dispatch] = useReducer(formReducer, undefined, () =>
    initialFormState(availableAgents, initialProjectID, projects),
  )
  const [recording, setRecording] = useState(false)
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus>({ state: 'idle' })
  const transcriptionCancelledRef = useRef(false)
  const activeFieldRef = useRef<'title' | 'description'>('description')

  useEffect(() => {
    return () => {
      const client = getWhisperClient()
      if (client.recording) {
        void client.stopRecording()
      }
      transcriptionCancelledRef.current = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const tErr = validateTaskTitle(state.title)
    const dErr = validateTaskDescription(state.description)
    dispatch({ type: 'submit-validation', titleError: tErr, descError: dErr })
    if (tErr || dErr) return
    if (!state.description.trim()) {
      dispatch({ type: 'set-desc-error', value: 'Description is required' })
      return
    }
    if (!state.assignee || state.assignee === 'Unassigned') {
      dispatch({ type: 'set-submit-error', value: 'An agent must be assigned' })
      return
    }
    dispatch({ type: 'set-pending', value: true })
    dispatch({ type: 'set-submit-error', value: '' })
    try {
      await onSubmit({
        title: state.title,
        description: state.description,
        state: 'Backlog',
        assignee_id: state.assignee,
        project_id: state.projectID,
        provider: state.provider,
        runtime_target: state.runtimeTarget !== 'LOCAL' ? state.runtimeTarget : undefined,
        disabled_tools: state.disabledTools
      })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task creation failed'
      dispatch({ type: 'set-submit-error', value: message })
    } finally {
      dispatch({ type: 'set-pending', value: false })
    }
  }

  const startRecording = async () => {
    if (recording || whisperStatus.state !== 'idle') return
    try {
      const client = getWhisperClient(setWhisperStatus)
      await client.startRecording()
      setRecording(true)
      dispatch({ type: 'set-submit-error', value: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microphone access failed'
      dispatch({ type: 'set-submit-error', value: message })
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
        dispatch({ type: 'append-voice', field: activeFieldRef.current, text })
      }
    } catch (error) {
      if (!transcriptionCancelledRef.current) {
        const message = error instanceof Error ? error.message : 'Transcription failed'
        dispatch({ type: 'set-submit-error', value: message })
      }
    } finally {
      if (!transcriptionCancelledRef.current) {
        setWhisperStatus({ state: 'idle' })
      }
    }
  }

  return (
    <FormBody
      state={state}
      dispatch={dispatch}
      availableAgents={availableAgents}
      projects={projects}
      availableRuntimes={availableRuntimes}
      onOpenChange={onOpenChange}
      handleSubmit={handleSubmit}
      recording={recording}
      whisperStatus={whisperStatus}
      startRecording={startRecording}
      stopRecording={stopRecording}
      activeFieldRef={activeFieldRef}
    />
  )
}

function FormBody({
  state,
  dispatch,
  availableAgents,
  projects,
  availableRuntimes,
  onOpenChange,
  handleSubmit,
  recording,
  whisperStatus,
  startRecording,
  stopRecording,
  activeFieldRef,
}: {
  state: FormState
  dispatch: Dispatch<FormAction>
  availableAgents: string[]
  projects: readonly Project[]
  availableRuntimes: readonly RuntimeEntry[]
  onOpenChange: (open: boolean) => void
  handleSubmit: (e: React.FormEvent) => Promise<void>
  recording: boolean
  whisperStatus: WhisperStatus
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  activeFieldRef: React.MutableRefObject<'title' | 'description'>
}) {
  const { title, description, assignee, runtimeTarget, projectID, pending, titleError, descError, submitError } = state
  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full flex-1">
      <div className="px-8 pt-8 pb-3 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50">New task</p>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden px-8 pb-4 gap-y-3">
        <input
          className="w-full bg-transparent border-none outline-none text-3xl font-semibold tracking-tight placeholder:text-muted-foreground/30 focus:ring-0 focus:outline-none p-0 selection:bg-primary/30"
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => dispatch({ type: 'set-title', value: e.target.value })}
          onFocus={() => { activeFieldRef.current = 'title' }}
          required
        />
        {titleError && <p className="text-[11px] text-destructive">{titleError}</p>}
        <div
          role="presentation"
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
            onChange={(e) => dispatch({ type: 'set-description', value: e.target.value })}
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
            projects={[...projects]}
            onChange={(value) => dispatch({ type: 'set-project', value })}
          />
          <div className="w-px h-4 bg-border/40 mx-1" />
          <AgentSelector
            value={assignee}
            agents={availableAgents}
            onChange={(val) => {
              dispatch({ type: 'set-assignee', value: val })
              const agentName = val.replace('agent-', '')
              if (availableAgents.includes(agentName)) {
                dispatch({ type: 'set-provider', value: agentName })
              } else if (val === '') {
                dispatch({ type: 'set-provider', value: availableAgents.length > 0 ? availableAgents[0] : '' })
              }
            }}
          />
          {availableRuntimes.filter((r) => r.configured && r.target !== 'LOCAL').length > 0 && (
            <>
              <div className="w-px h-4 bg-border/40 mx-1" />
              <RuntimeSelector
                value={runtimeTarget}
                runtimes={[{ target: 'LOCAL', configured: true }, ...availableRuntimes.filter((r) => r.configured)]}
                onChange={(value) => dispatch({ type: 'set-runtime-target', value })}
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
              <><Square className="size-3.5" /> Release</>
            ) : whisperStatus.state === 'loading' ? (
              <><Loader2 className="size-3.5 animate-spin-smooth" /> Loading {whisperStatus.progress}%</>
            ) : whisperStatus.state === 'transcribing' ? (
              <><Loader2 className="size-3.5 animate-spin-smooth" /> Transcribing</>
            ) : (
              <><Mic className="size-3.5" /> Hold to talk</>
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
            {pending ? <Loader2 className="size-4 animate-spin-smooth" /> : 'Create task'}
          </button>
        </div>
      </div>
    </form>
  )
}
