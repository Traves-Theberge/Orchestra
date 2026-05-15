import { Skeleton } from '@ui/skeleton'
import { OverviewPanel, type ProviderSummary } from '../panels/OverviewPanel'
import { SettingsPanel } from '../panels/SettingsPanel'
import { InstructionsPanel } from '../panels/InstructionsPanel'
import { SkillsPanel } from '../panels/SkillsPanel'
import { HooksPanel } from '../panels/HooksPanel'
import { MCPPanel } from '../panels/MCPPanel'
import { RulesPanel } from '../panels/RulesPanel'
import { SubAgentsPanel } from '../panels/SubAgentsPanel'
import { PermissionsPanel } from '../panels/PermissionsPanel'
import { CodexInstructionsPanel } from '../panels/CodexInstructionsPanel'
import { CodexConfigPanel } from '../panels/CodexConfigPanel'
import { CodexApprovalsPanel } from '../panels/CodexApprovalsPanel'
import { CodexModelPanel } from '../panels/CodexModelPanel'
import { CodexEnvironmentPanel } from '../panels/CodexEnvironmentPanel'
import { CodexProfilesPanel } from '../panels/CodexProfilesPanel'
import { CodexSubAgentsPanel } from '../panels/CodexSubAgentsPanel'
import { CodexSkillsPanel } from '../panels/CodexSkillsPanel'
import { CodexRulesPanel } from '../panels/CodexRulesPanel'
import { GeminiContextPanel } from '../panels/GeminiContextPanel'
import { GeminiSettingsPanel } from '../panels/GeminiSettingsPanel'
import { GeminiCommandsPanel } from '../panels/GeminiCommandsPanel'
import { GeminiModelPanel } from '../panels/GeminiModelPanel'
import { GeminiPermissionsPanel } from '../panels/GeminiPermissionsPanel'
import { OpenCodeConfigPanel } from '../panels/OpenCodeConfigPanel'
import { OpenCodeInstructionsPanel } from '../panels/OpenCodeInstructionsPanel'
import { OpenCodeAgentsPanel } from '../panels/OpenCodeAgentsPanel'
import { OpenCodeCommandsPanel } from '../panels/OpenCodeCommandsPanel'
import { OpenCodeSkillsPanel } from '../panels/OpenCodeSkillsPanel'
import { OpenCodeModelPanel } from '../panels/OpenCodeModelPanel'
import { OpenCodePermissionsPanel } from '../panels/OpenCodePermissionsPanel'
import type { ClaudeConfigState } from '../hooks/use-claude-config'
import type {
  CodexConfigState,
  GeminiConfigState,
  OpenCodeConfigState,
} from '../hooks/use-provider-domain-config'
import type { CategoryId, Provider, Scope } from '../types'
import type { ProviderItems } from './use-provider-items'

interface ProviderCommonLike {
  loading: boolean
  saving: string | null
}

interface CategoryRouterProps {
  provider: Provider
  category: CategoryId
  isClaudeOrEightgent: boolean
  agentHubScope: Scope
  agentHubProjectId: string | null
  selectedProjectName: string | null
  overviewSummaryGlobal: ProviderSummary
  overviewSummaryProject: ProviderSummary | null
  onOverviewNavigate: (nextCategory: CategoryId, nextScope: Scope) => void
  state: ClaudeConfigState | CodexConfigState | GeminiConfigState | OpenCodeConfigState
  domainState: CodexConfigState | GeminiConfigState | OpenCodeConfigState
  claude: ClaudeConfigState
  claudeGlobal: ClaudeConfigState
  codex: CodexConfigState
  gemini: GeminiConfigState
  opencode: OpenCodeConfigState
  providerItems: ProviderItems
}

export function CategoryRouter({
  provider,
  category,
  isClaudeOrEightgent,
  agentHubScope,
  selectedProjectName,
  overviewSummaryGlobal,
  overviewSummaryProject,
  onOverviewNavigate,
  state,
  domainState,
  claude,
  claudeGlobal,
  codex,
  gemini,
  opencode,
  providerItems,
}: CategoryRouterProps) {
  if (category === 'overview') {
    return (
      <OverviewPanel
        provider={provider}
        projectName={selectedProjectName}
        globalSummary={overviewSummaryGlobal}
        projectSummary={overviewSummaryProject}
        onNavigate={onOverviewNavigate}
      />
    )
  }

  if ((state as ProviderCommonLike).loading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  if (isClaudeOrEightgent) {
    return (
      <ClaudeCategoryBranch
        category={category}
        agentHubScope={agentHubScope}
        selectedProjectName={selectedProjectName}
        claude={claude}
        claudeGlobal={claudeGlobal}
      />
    )
  }

  return (
    <LegacyCategoryBranch
      provider={provider}
      category={category}
      agentHubScope={agentHubScope}
      selectedProjectName={selectedProjectName}
      domainState={domainState}
      codex={codex}
      gemini={gemini}
      opencode={opencode}
      providerItems={providerItems}
    />
  )
}

interface ClaudeBranchProps {
  category: CategoryId
  agentHubScope: Scope
  selectedProjectName: string | null
  claude: ClaudeConfigState
  claudeGlobal: ClaudeConfigState
}

function ClaudeCategoryBranch({
  category,
  agentHubScope,
  selectedProjectName,
  claude,
  claudeGlobal,
}: ClaudeBranchProps) {
  switch (category) {
    case 'settings':
      return (
        <SettingsPanel
          settings={claude.settings}
          globalSettings={claudeGlobal.settings}
          scope={agentHubScope}
          projectName={selectedProjectName}
          settingsPath={claude.settingsPath}
          settingsExists={claude.settingsExists}
          saving={claude.saving}
          onSave={claude.saveSettings}
        />
      )
    case 'instructions':
      return (
        <InstructionsPanel
          content={claude.instructions}
          path={claude.instructionsPath}
          exists={claude.instructionsExists}
          saving={claude.saving}
          scope={agentHubScope}
          projectName={selectedProjectName}
          onSave={claude.saveInstructions}
          onDelete={claude.deleteInstructions}
        />
      )
    case 'hooks':
      return (
        <HooksPanel
          hooks={claude.hooks}
          globalHooks={claudeGlobal.hooks}
          scope={agentHubScope}
          projectName={selectedProjectName}
          onSave={claude.saveHooks}
          loading={claude.loading}
          saving={claude.saving}
          provider="claude"
        />
      )
    case 'mcp':
      return (
        <MCPPanel
          providerServers={claude.providerMcpServers}
          orchestraServers={claude.orchestraMcpServers}
          globalProviderServers={claudeGlobal.providerMcpServers}
          scope={agentHubScope}
          projectName={selectedProjectName}
          onAddProvider={claude.addMCPServer}
          onUpdateProvider={claude.updateMCPServer}
          onToggleProvider={claude.toggleMCPServer}
          onDeleteProvider={claude.deleteMCPServer}
          onDeleteOrchestra={claude.deleteOrchestraMCPServer}
          loading={claude.loading}
          saving={claude.saving}
          provider="claude"
        />
      )
    case 'rules':
      return (
        <RulesPanel
          items={claude.rules}
          globalItems={claudeGlobal.rules}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={claude.saving}
          onSave={claude.saveRule}
          onDelete={claude.removeRule}
        />
      )
    case 'skills':
      return (
        <SkillsPanel
          items={claude.skills}
          globalItems={claudeGlobal.skills}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={claude.saving}
          onSave={claude.saveSkill}
          onDelete={claude.removeSkill}
        />
      )
    case 'agents':
      return (
        <SubAgentsPanel
          items={claude.subagents}
          globalItems={claudeGlobal.subagents}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={claude.saving}
          onSave={claude.saveSubAgent}
          onDelete={claude.removeSubAgent}
        />
      )
    default:
      return null
  }
}

interface LegacyBranchProps {
  provider: Provider
  category: CategoryId
  agentHubScope: Scope
  selectedProjectName: string | null
  domainState: CodexConfigState | GeminiConfigState | OpenCodeConfigState
  codex: CodexConfigState
  gemini: GeminiConfigState
  opencode: OpenCodeConfigState
  providerItems: ProviderItems
}

function LegacyCategoryBranch({
  provider,
  category,
  agentHubScope,
  selectedProjectName,
  domainState,
  codex,
  gemini,
  opencode,
  providerItems,
}: LegacyBranchProps) {
  if (!category) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/20">
        <p className="text-sm font-bold uppercase tracking-widest">Select a category</p>
      </div>
    )
  }

  return (
    <>
      {category === 'config' && provider === 'opencode' && (
        <OpenCodeConfigPanel
          items={providerItems.config}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={opencode.saveConfigResource}
          onCreate={opencode.createConfigResource}
        />
      )}
      {category === 'config' && provider === 'codex' && (
        <CodexConfigPanel
          items={providerItems.config}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={codex.saveConfigFile}
          onCreate={codex.createConfigFile}
        />
      )}
      {category === 'approvals' && provider === 'codex' && (
        <CodexApprovalsPanel
          permissions={codex.permissions}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={codex.saving}
          onSave={codex.savePermissions}
        />
      )}
      {category === 'models' && provider === 'codex' && (
        <CodexModelPanel
          modelConfig={codex.modelConfig}
          configContent={codex.config[0]?.content ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={codex.saving}
          onSave={codex.saveModel}
          onSaveConfig={(content) => codex.saveConfigFile(codex.config[0]?.path ?? '', content)}
        />
      )}
      {category === 'environment' && provider === 'codex' && (
        <CodexEnvironmentPanel
          items={codex.config}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={codex.saving}
          onSave={codex.saveConfigFile}
        />
      )}
      {category === 'profiles' && provider === 'codex' && (
        <CodexProfilesPanel
          items={codex.config}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={codex.saving}
          onSave={codex.saveConfigFile}
        />
      )}
      {category === 'settings' && provider === 'gemini' && (
        <GeminiSettingsPanel
          items={providerItems.config}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={gemini.saveSettingsFile}
          onCreate={gemini.createSettingsResource}
        />
      )}
      {category === 'models' && provider === 'gemini' && (
        <GeminiModelPanel
          modelConfig={gemini.modelConfig}
          settingsContent={gemini.settings[0]?.content ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={gemini.saving}
          onSave={gemini.saveModel}
        />
      )}
      {category === 'models' && provider === 'opencode' && (
        <OpenCodeModelPanel
          modelConfig={opencode.modelConfig}
          configContent={opencode.config[0]?.content ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={opencode.saving}
          onSave={opencode.saveModel}
        />
      )}
      {category === 'instructions' && provider === 'codex' && (
        <CodexInstructionsPanel
          items={providerItems.instructions}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={codex.saveInstructionFile}
          onCreate={codex.createInstructionFile}
        />
      )}
      {category === 'instructions' && provider !== 'codex' && (
        <OpenCodeInstructionsPanel
          items={providerItems.instructions}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={opencode.saveConfigResource}
          onCreate={() => opencode.createConfigResource()}
        />
      )}
      {category === 'context' && (
        <GeminiContextPanel
          items={providerItems.context}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={gemini.saveContextFile}
          onCreate={gemini.createContextResource}
        />
      )}
      {category === 'skills' && provider === 'opencode' && (
        <OpenCodeSkillsPanel
          items={providerItems.skills}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={opencode.saveSkillFile}
          onDelete={opencode.deleteSkillResource}
          onCreate={opencode.createSkillResourceFile}
        />
      )}
      {category === 'skills' && provider === 'codex' && (
        <CodexSkillsPanel
          items={codex.skills}
          configContent={codex.config[0]?.content ?? ''}
          configPath={codex.config[0]?.path ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={codex.saveSkillFile}
          onDelete={codex.deleteSkillFile}
          onCreate={codex.createSkillResource}
          onSaveConfig={codex.saveConfigFile}
        />
      )}
      {category === 'commands' && provider === 'opencode' && (
        <OpenCodeCommandsPanel
          items={providerItems.commands}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={opencode.saveCommandFile}
          onDelete={opencode.deleteCommandResource}
          onCreate={opencode.createCommandResource}
        />
      )}
      {category === 'commands' && provider === 'gemini' && (
        <GeminiCommandsPanel
          items={providerItems.commands}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={gemini.saveCommandFile}
          onDelete={gemini.deleteCommandFile}
          onCreate={gemini.createCommandResource}
        />
      )}
      {category === 'agents' && provider === 'opencode' && (
        <OpenCodeAgentsPanel
          items={providerItems.agents}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={opencode.saveAgentFile}
          onDelete={opencode.deleteAgentFile}
          onCreate={opencode.createAgentResourceFile}
        />
      )}
      {category === 'agents' && provider === 'codex' && (
        <CodexSubAgentsPanel
          items={codex.subagents}
          configContent={codex.config[0]?.content ?? ''}
          configPath={codex.config[0]?.path ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={codex.saveSubagentFile}
          onDelete={codex.deleteSubagentFile}
          onCreate={codex.createSubagentFile}
          onSaveConfig={codex.saveConfigFile}
        />
      )}
      {category === 'hooks' && (
        <HooksPanel
          hooks={domainState.hooks}
          onSave={domainState.saveHooks}
          loading={domainState.loading}
          saving={domainState.saving}
          provider={provider}
        />
      )}
      {category === 'rules' && provider === 'codex' && (
        <CodexRulesPanel
          items={codex.rules}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={codex.saving}
          onSave={codex.saveRuleFile}
          onDelete={codex.deleteRuleFile}
        />
      )}
      {category === 'mcp' && (
        <MCPPanel
          providerServers={domainState.providerMcpServers}
          orchestraServers={domainState.orchestraMcpServers}
          scope={agentHubScope}
          projectName={selectedProjectName}
          onAddProvider={domainState.addMCPServer}
          onUpdateProvider={domainState.updateMCPServer}
          onToggleProvider={domainState.toggleMCPServer}
          onDeleteProvider={domainState.deleteMCPServer}
          onDeleteOrchestra={domainState.deleteOrchestraMCPServer}
          loading={domainState.loading}
          saving={domainState.saving}
          provider={provider}
        />
      )}
      {category === 'permissions' && provider === 'gemini' && (
        <GeminiPermissionsPanel
          settingsPath={gemini.settings[0]?.path ?? ''}
          settingsContent={gemini.settings[0]?.content ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={gemini.saving}
          onSave={gemini.saveSettingsFile}
        />
      )}
      {category === 'permissions' && provider === 'opencode' && (
        <OpenCodePermissionsPanel
          configPath={opencode.config[0]?.path ?? ''}
          configContent={opencode.config[0]?.content ?? ''}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={opencode.saving}
          onSave={opencode.saveConfigResource}
        />
      )}
      {category === 'permissions' && provider !== 'gemini' && provider !== 'opencode' && (
        <PermissionsPanel
          permissions={domainState.permissions}
          scope={agentHubScope}
          projectName={selectedProjectName}
          saving={domainState.saving}
          onSave={domainState.savePermissions}
          provider={provider}
        />
      )}
    </>
  )
}
