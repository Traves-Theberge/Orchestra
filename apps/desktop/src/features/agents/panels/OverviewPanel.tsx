import { OverviewRow } from '../components/OverviewRow'
import { PanelHeader } from '../components/PanelHeader'
import { TOKENS } from '../tokens'
import type { Provider, CategoryId, Scope } from '../types'

export interface ProviderSummary {
  model: string | null
  instructionsLines: number | null
  skillsCount: number | null
  skillsAddedNames?: string[]
  mcpCount: number | null
  hooksCount: number | null
  subAgentsCount: number | null
}

interface OverviewPanelProps {
  provider: Provider
  projectName: string | null
  globalSummary: ProviderSummary
  projectSummary: ProviderSummary | null
  onNavigate: (category: CategoryId, scope: Scope) => void
}

const providerLabel: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  '8gent': '8gent',
}

export function OverviewPanel({ provider, projectName, globalSummary, projectSummary, onNavigate }: OverviewPanelProps) {
  const label = providerLabel[provider]
  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      <PanelHeader
        eyebrow={`${label} / Configuration`}
        title="Global & project overrides"
        sub={projectName
          ? `Side-by-side view of what applies everywhere and what's specific to ${projectName}.`
          : 'No project selected — showing global configuration only.'}
      />

      <div className={`grid ${projectName ? 'grid-cols-2' : 'grid-cols-1'} gap-3 flex-1 min-h-0 overflow-auto`}>

        {/* Global column */}
        <section className={TOKENS.surfaceGlobal}>
          <header className="px-3 pt-3 pb-2">
            <h3 className={TOKENS.textTitle}>Global</h3>
          </header>
          <OverviewRow
            name="Model"
            value={globalSummary.model ?? '—'}
            status={globalSummary.model ? 'set' : 'empty'}
            onClick={() => onNavigate('models', 'GLOBAL')}
          />
          <OverviewRow
            name="Instructions"
            value={globalSummary.instructionsLines ? `${globalSummary.instructionsLines} lines` : 'not set'}
            status={globalSummary.instructionsLines ? 'set' : 'empty'}
            hint={globalSummary.instructionsLines ? '~/.claude/CLAUDE.md' : undefined}
            onClick={() => onNavigate('instructions', 'GLOBAL')}
          />
          <OverviewRow
            name="Skills"
            value={`${globalSummary.skillsCount ?? 0} enabled`}
            status={(globalSummary.skillsCount ?? 0) > 0 ? 'set' : 'empty'}
            onClick={() => onNavigate('skills', 'GLOBAL')}
          />
          <OverviewRow
            name="Sub-agents"
            value={`${globalSummary.subAgentsCount ?? 0} configured`}
            status={(globalSummary.subAgentsCount ?? 0) > 0 ? 'set' : 'empty'}
            onClick={() => onNavigate('agents', 'GLOBAL')}
          />
          <OverviewRow
            name="Hooks"
            value={(globalSummary.hooksCount ?? 0) === 0 ? 'none' : `${globalSummary.hooksCount}`}
            status={(globalSummary.hooksCount ?? 0) > 0 ? 'set' : 'empty'}
            onClick={() => onNavigate('hooks', 'GLOBAL')}
          />
          <OverviewRow
            name="MCP servers"
            value={(globalSummary.mcpCount ?? 0) === 0 ? 'none' : `${globalSummary.mcpCount} connected`}
            status={(globalSummary.mcpCount ?? 0) > 0 ? 'set' : 'empty'}
            onClick={() => onNavigate('mcp', 'GLOBAL')}
          />
        </section>

        {/* Project column */}
        {projectName && projectSummary && (
          <section className={TOKENS.surfaceProject}>
            <header className="px-3 pt-3 pb-2">
              <h3 className={`${TOKENS.textTitle} text-accent`}>{projectName}</h3>
            </header>

            <OverviewRow
              name="Model"
              value={projectSummary.model ?? 'inherits global'}
              status={projectSummary.model ? 'override' : 'inherited'}
              pillText={projectSummary.model ? 'override' : undefined}
              onClick={() => onNavigate('models', 'PROJECT')}
            />
            <OverviewRow
              name="Instructions"
              value={projectSummary.instructionsLines
                ? `+${projectSummary.instructionsLines} lines appended`
                : 'inherits global'}
              status={projectSummary.instructionsLines ? 'override' : 'inherited'}
              pillText={projectSummary.instructionsLines ? 'override' : undefined}
              onClick={() => onNavigate('instructions', 'PROJECT')}
            />
            <OverviewRow
              name="Skills"
              value={(projectSummary.skillsAddedNames ?? []).join(', ') || 'inherits global'}
              status={(projectSummary.skillsCount ?? 0) > 0 ? 'override' : 'inherited'}
              pillText={(projectSummary.skillsCount ?? 0) > 0 ? `+${projectSummary.skillsCount}` : undefined}
              onClick={() => onNavigate('skills', 'PROJECT')}
            />
            <OverviewRow
              name="Sub-agents"
              value={(projectSummary.subAgentsCount ?? 0) > 0
                ? `+${projectSummary.subAgentsCount}`
                : 'inherits global'}
              status={(projectSummary.subAgentsCount ?? 0) > 0 ? 'override' : 'inherited'}
              pillText={(projectSummary.subAgentsCount ?? 0) > 0 ? `+${projectSummary.subAgentsCount}` : undefined}
              onClick={() => onNavigate('agents', 'PROJECT')}
            />
            <OverviewRow
              name="Hooks"
              value={(projectSummary.hooksCount ?? 0) > 0 ? `${projectSummary.hooksCount}` : 'inherits global'}
              status={(projectSummary.hooksCount ?? 0) > 0 ? 'override' : 'inherited'}
              onClick={() => onNavigate('hooks', 'PROJECT')}
            />
            <OverviewRow
              name="MCP servers"
              value={(projectSummary.mcpCount ?? 0) > 0 ? `+${projectSummary.mcpCount}` : 'inherits global'}
              status={(projectSummary.mcpCount ?? 0) > 0 ? 'override' : 'inherited'}
              pillText={(projectSummary.mcpCount ?? 0) > 0 ? `+${projectSummary.mcpCount}` : undefined}
              onClick={() => onNavigate('mcp', 'PROJECT')}
            />
          </section>
        )}
      </div>
    </div>
  )
}
