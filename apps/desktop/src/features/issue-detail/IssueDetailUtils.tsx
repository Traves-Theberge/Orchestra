import { Activity, AlertCircle, CheckCircle2, Code, Database, File, FileText, Layers, Play, Rows, Terminal, Wrench } from 'lucide-react'

import type { TimelineItem } from '@layout/types'

/** A single file entry extracted from a unified diff. */
export type DiffFile = {
  /** File path from the diff header. */
  path: string
  /** Full diff content for this file (including headers and hunks). */
  content: string
}

/** Descriptor for a lifecycle hook that runs around issue processing. */
export type IssueHook = {
  /** Hook type identifier (e.g. "after_create", "before_run"). */
  id: string
  /** Human-readable label for display. */
  label: string
  /** Short description of the hook's purpose. */
  description: string
}

/** A single checkbox item from an agent's operational plan. */
export type PlanItem = {
  /** The plan step description text. */
  text: string
  /** Whether this step has been completed. */
  done: boolean
}

function asEventData(event: TimelineItem): Record<string, unknown> {
  return (event.data && typeof event.data === 'object') ? (event.data as Record<string, unknown>) : {}
}

/** Parses a unified diff string into an array of per-file diff entries. */
export function parseDiff(rawDiff: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = rawDiff.split('\n')
  let currentFile: string | null = null
  let currentContent: string[] = []

  lines.forEach((line) => {
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        files.push({ path: currentFile, content: currentContent.join('\n') })
      }
      const match = line.match(/b\/(.+)$/)
      currentFile = match ? match[1] : 'unknown'
      currentContent = [line]
    } else if (currentFile) {
      currentContent.push(line)
    }
  })

  if (currentFile) {
    files.push({ path: currentFile, content: currentContent.join('\n') })
  }

  return files
}

/** Collects the output text of completed or failed hooks for a given issue from the timeline. */
export function extractHookOutputs(timeline: TimelineItem[], issueId: string, issueIdentifier: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  for (const event of timeline) {
    const data = asEventData(event)
    if (data.issue_id !== issueId && data.issue_identifier !== issueIdentifier) continue
    if (event.type !== 'HOOK_COMPLETED' && event.type !== 'HOOK_FAILED') continue
    const type = typeof data.hook_type === 'string' ? data.hook_type : ''
    const output = typeof data.output === 'string' ? data.output : ''
    if (type && output) {
      outputs[type] = output
    }
  }
  return outputs
}

/** Derives the current status of a specific hook type (`pending`, `active`, `completed`, or `failed`) from the timeline. */
export function getHookStatus(timeline: TimelineItem[], issueId: string, issueIdentifier: string, type: string) {
  let hasFailed = false
  let hasCompleted = false
  let hasStarted = false
  for (const event of timeline) {
    const data = asEventData(event)
    if (data.issue_id !== issueId && data.issue_identifier !== issueIdentifier) continue
    if (data.hook_type !== type) continue
    if (event.type === 'HOOK_FAILED') hasFailed = true
    else if (event.type === 'HOOK_COMPLETED') hasCompleted = true
    else if (event.type === 'HOOK_STARTED') hasStarted = true
  }
  if (hasFailed) return 'failed'
  if (hasCompleted) return 'completed'
  if (hasStarted) return 'active'
  return 'pending'
}

/** Returns a small colored icon element appropriate for the given event kind. */
export function getEventIcon(kind: string) {
  const normalizedKind = kind.toLowerCase()
  if (normalizedKind.includes('started') || normalizedKind.includes('init')) {
    return <Play className="size-3 text-emerald-500" fill="currentColor" />
  }
  if (normalizedKind.includes('failed') || normalizedKind.includes('error')) {
    return <AlertCircle className="size-3 text-red-500" />
  }
  if (normalizedKind.includes('completed') || normalizedKind.includes('success')) {
    return <CheckCircle2 className="size-3 text-primary" />
  }
  if (normalizedKind.includes('tool')) {
    return <Wrench className="size-3 text-amber-500" />
  }
  if (normalizedKind.includes('hook')) {
    return <Rows className="size-3 text-blue-400" />
  }
  return <Activity size={12} className="text-muted-foreground/40" />
}

/** Returns a file-type icon element based on the file extension. */
export function getFileIcon(path: string, active: boolean) {
  const ext = path.split('.').pop()?.toLowerCase()
  const color = active ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/60'

  switch (ext) {
    case 'md':
      return <FileText size={14} className={color} />
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <Code size={14} className={active ? 'text-blue-400' : 'text-blue-400/40 group-hover:text-blue-400/60'} />
    case 'json':
      return <Database size={14} className={active ? 'text-amber-400' : 'text-amber-400/40 group-hover:text-amber-400/60'} />
    case 'sh':
      return <Terminal size={14} className={active ? 'text-emerald-400' : 'text-emerald-400/40 group-hover:text-emerald-400/60'} />
    case 'css':
      return <Layers size={14} className={active ? 'text-pink-400' : 'text-pink-400/40 group-hover:text-pink-400/60'} />
    default:
      return <File size={14} className={color} />
  }
}

/** Extracts markdown checkbox items from free-form text into structured plan items. */
export function extractPlanFromText(text: string): PlanItem[] {
  return parsePlanItemsFromText(text)
}

function parsePlanItemsFromText(text: string): PlanItem[] {
  if (!text) return []

  // Strip code blocks (``` ... ```) so we don't parse example checkboxes from templates
  const stripped = text.replace(/```[\s\S]*?```/g, '')

  const lines = stripped.split('\n')
  const checkboxItems: PlanItem[] = []
  for (const line of lines) {
    const match = line.match(/^\s*[-*+]\s*\[\s*([xX ])\s*\]\s+(.+)$/)
    if (!match) continue
    const text = match[2].trim()
    if (text.length === 0 || text === 'step one' || text === 'step two' || text === 'step three') continue
    checkboxItems.push({ done: match[1].toLowerCase() === 'x', text })
  }

  if (checkboxItems.length > 0) {
    return checkboxItems
  }

  return []
}

/**
 * Collects agent messages from the timeline that may contain operational plan
 * items (thoughts, plans, numbered lists, or checkbox items).
 */
function collectCandidateMessages(timeline: TimelineItem[], issueId: string, issueIdentifier: string): string[] {
  const relevant = timeline.filter((item) => {
    const eventIssueID = typeof item.data?.issue_id === 'string' ? item.data.issue_id : ''
    const eventIssueIdentifier = typeof item.data?.issue_identifier === 'string' ? item.data.issue_identifier : ''
    if (!eventIssueID && !eventIssueIdentifier) return true
    return eventIssueID === issueId || eventIssueIdentifier === issueIdentifier
  })

  const messages: string[] = []
  for (const event of relevant) {
    if (event.type !== 'RUN_EVENT') {
      continue
    }

    const runEvent = event.data?.event
    if (!runEvent || typeof runEvent !== 'object') {
      continue
    }

    const kind = typeof (runEvent as Record<string, unknown>).kind === 'string' ? (runEvent as Record<string, string>).kind : ''
    const msg = typeof (runEvent as Record<string, unknown>).message === 'string' ? (runEvent as Record<string, string>).message : ''
    if (!msg) {
      continue
    }

    // Skip PTY noise and example plan items from WORKFLOW.md
    if (kind === 'pty' || kind === 'stderr') continue
    if (msg.includes('step one') && msg.includes('step two')) continue

    const message = msg
    const normalizedKind = kind.toLowerCase()
    if (
      normalizedKind.includes('thought') ||
      normalizedKind.includes('plan') ||
      normalizedKind.includes('reason') ||
      message.includes('- [ ]') ||
      message.includes('- [x]') ||
      /^\s*\d+\.\s+/m.test(message)
    ) {
      messages.push(message)
    }
  }

  return messages
}

/**
 * Searches timeline events for agent plan messages and extracts checkbox items.
 * Falls back to parsing the issue description if no plan is found in the timeline.
 */
export function extractOperationalPlanItems(timeline: TimelineItem[], issueId: string, issueIdentifier: string, description: string): PlanItem[] {
  const messages = collectCandidateMessages(timeline, issueId, issueIdentifier)

  for (const message of messages) {
    const items = parsePlanItemsFromText(message)
    if (items.length > 0) {
      return items
    }
  }

  return parsePlanItemsFromText(description)
}
