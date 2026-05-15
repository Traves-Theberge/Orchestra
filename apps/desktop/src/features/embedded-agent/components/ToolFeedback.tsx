import { useState } from 'react'
import { ChevronDown, ChevronRight, Zap, Check, AlertTriangle, Loader2 } from 'lucide-react'
import type { ToolCallInfo, ToolResultInfo } from '../lib/types'

interface ToolFeedbackProps {
  toolCalls: ToolCallInfo[]
  toolResults: ToolResultInfo[]
  isStreaming?: boolean
}

type StepGroup = {
  stepIndex: number
  calls: ToolCallInfo[]
  results: ToolResultInfo[]
}

function groupByStep(calls: ToolCallInfo[], results: ToolResultInfo[]): StepGroup[] {
  const stepMap = new Map<number, StepGroup>()

  for (const call of calls) {
    const idx = call.stepIndex ?? 0
    if (!stepMap.has(idx)) {
      stepMap.set(idx, { stepIndex: idx, calls: [], results: [] })
    }
    stepMap.get(idx)!.calls.push(call)
  }

  for (const result of results) {
    const idx = result.stepIndex ?? 0
    if (!stepMap.has(idx)) {
      stepMap.set(idx, { stepIndex: idx, calls: [], results: [] })
    }
    stepMap.get(idx)!.results.push(result)
  }

  return Array.from(stepMap.values()).sort((a, b) => a.stepIndex - b.stepIndex)
}

export function ToolFeedback({ toolCalls, toolResults, isStreaming }: ToolFeedbackProps) {
  const [expanded, setExpanded] = useState(false)

  if (toolCalls.length === 0) return null

  const steps = groupByStep(toolCalls, toolResults)
  const isMultiStep = steps.length > 1
  const hasErrors = toolResults.some((r) => r.isError)
  const completedSteps = steps.filter((s) => s.results.length >= s.calls.length).length
  const totalSteps = steps.length

  return (
    <div className="rounded-xl border border-border/20 bg-background/30 text-[10px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Zap className="size-3 shrink-0 text-primary/60" />
        <span className="font-bold uppercase tracking-wider">
          {isMultiStep
            ? `${completedSteps}/${totalSteps} steps · ${toolCalls.length} tool${toolCalls.length !== 1 ? 's' : ''}`
            : `${toolCalls.length} tool${toolCalls.length !== 1 ? 's' : ''} used`}
        </span>
        {isStreaming && completedSteps < totalSteps && (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary/60" />
        )}
        {!isStreaming && !hasErrors && toolResults.length > 0 && (
          <Check className="size-3 shrink-0 text-emerald-500" />
        )}
        {hasErrors && (
          <AlertTriangle className="size-3 shrink-0 text-amber-500" />
        )}
      </button>

      {/* Multi-step progress bar */}
      {isMultiStep && (
        <div className="flex gap-0.5 px-3 pb-1.5">
          {steps.map((step) => {
            const done = step.results.length >= step.calls.length
            const hasErr = step.results.some((r) => r.isError)
            return (
              <div
                key={step.stepIndex}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  hasErr
                    ? 'bg-amber-500'
                    : done
                      ? 'bg-emerald-500'
                      : 'bg-muted/30'
                }`}
              />
            )
          })}
        </div>
      )}

      {expanded && (
        <div className="space-y-px border-t border-border/20">
          {steps.map((step) => (
            <div key={step.stepIndex}>
              {isMultiStep && (
                <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
                  <span className="font-bold uppercase tracking-wider text-muted-foreground/60">
                    Step {step.stepIndex + 1}
                  </span>
                  {step.results.length >= step.calls.length && !step.results.some((r) => r.isError) && (
                    <Check className="size-2.5 text-emerald-500" />
                  )}
                  {step.results.some((r) => r.isError) && (
                    <AlertTriangle className="size-2.5 text-amber-500" />
                  )}
                </div>
              )}
              {step.calls.map((call, i) => {
                const result = step.results[i] ?? null
                return (
                  <div key={`${step.stepIndex}-${call.toolName}-${i}`} className="px-3 py-2 transition-colors hover:bg-muted/10">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold font-mono text-foreground/80">{call.toolName}</span>
                      {result && !result.isError && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-500">ok</span>
                      )}
                      {result?.isError && (
                        <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-red-500">error</span>
                      )}
                    </div>
                    {Object.keys(call.args).length > 0 && (
                      <pre className="mt-1 overflow-x-auto rounded-md bg-muted/20 p-1.5 font-mono text-muted-foreground/70 max-h-[60px]">
                        {JSON.stringify(call.args, null, 2)}
                      </pre>
                    )}
                    {result && (
                      <pre
                        className={`mt-1 overflow-x-auto rounded-md p-1.5 font-mono max-h-[60px] ${
                          result.isError
                            ? 'bg-red-500/5 text-red-400'
                            : 'bg-emerald-500/5 text-emerald-400/70'
                        }`}
                      >
                        {typeof result.result === 'string'
                          ? result.result
                          : JSON.stringify(result.result, null, 2)}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
