import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { fetchAgentSkills, type AgentSkill, type BackendConfig } from '@core/api/client'
import { Button } from '@ui/button'
import { harnessLabel } from '../lib/agent-display'

/** Skills discovered across harnesses (and shared .agents/skills), as agents can reference them. */
export function OrchestraSkillsPanel({ config, projectId }: { config: BackendConfig; projectId?: string }) {
  const [skills, setSkills] = useState<AgentSkill[]>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    fetchAgentSkills(config, { projectId })
      .then(list => { if (!cancelled) { setSkills(list); setError('') } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Skills unavailable') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [config, projectId, revision])
  const groups = new Map<string, AgentSkill[]>()
  for (const skill of skills ?? []) {
    const key = !skill.harness || skill.harness === 'shared' ? 'Shared' : harnessLabel(skill.harness)
    groups.set(key, [...(groups.get(key) ?? []), skill])
  }
  return (
    <section aria-label="Skills" className="flex h-full min-h-0 flex-col px-6 py-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-muted-foreground"><Sparkles className="size-4" /><span className="text-[11px] font-medium uppercase tracking-wide">Skills</span></div>
          <h2 className="text-[18px] font-semibold tracking-tight">Skills across harnesses</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Orchestra agents can grant any of these by name. Edit a skill from its harness section.</p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1) }}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh
        </Button>
      </div>
      {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
      {skills && !skills.length && <p className="text-[12px] text-muted-foreground">No skills found.</p>}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {[...groups].map(([group, items]) => (
          <div key={group}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
            <ul className="divide-y divide-border/50">
              {items.map(skill => (
                <li key={`${skill.harness ?? ''}:${skill.scope ?? ''}:${skill.name}`} className="py-2">
                  <div className="flex items-center gap-2"><span className="text-[13px] font-medium">{skill.name}</span>{skill.scope && <span className="text-[11px] text-muted-foreground">{skill.scope}</span>}</div>
                  {skill.description && <p className="text-[12px] text-muted-foreground">{skill.description}</p>}
                  {skill.path && <p className="truncate font-mono text-[11px] text-muted-foreground/70">{skill.path}</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
