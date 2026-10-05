import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CircleDashed, Copy, Loader2, RefreshCw, Save } from 'lucide-react'
import { fetchAgentConfig, fetchAgents, fetchHarnessSetup, fetchWorkspaceChatProviders, updateAgentConfig, type HarnessSetupObservation, type WorkspaceChatProvider } from '@core/api/client'
import type { BackendConfig } from '@core/api/types'
import { Button } from '@ui/button'
import { useAppStore } from '@core/store'
import { CustomDropdown } from '@layout/shared/controls'
import { PanelHeader } from '../components/PanelHeader'
import type { Provider } from '../types'
import { buildCommandRegistrationPatch, getRegisteredCommand, HARNESS_SIGN_IN_COMMANDS, isHarnessRegistered, KNOWN_HARNESSES, normalizeHarnessId } from './harness-setup'

type AgentConfig = Awaited<ReturnType<typeof fetchAgentConfig>>

const labelFor = (id: string) => normalizeHarnessId(id) === 'GEMINI' ? 'Gemini' : KNOWN_HARNESSES.find((item) => item.id === normalizeHarnessId(id))?.label ?? id
const guideFor = (id: string) => KNOWN_HARNESSES.find((item) => item.id === normalizeHarnessId(id))?.helpUrl

export function HarnessSetupPanel({ config, provider, projectId }: {
  config: BackendConfig | null
  provider: Provider
  projectId: string | null
}) {
  const harnessId = normalizeHarnessId(provider)
  const chatScope = projectId ?? '__orchestrator__'
  const profileKey = JSON.stringify([config?.baseUrl, config?.apiToken])
  const [loadedProfileKey, setLoadedProfileKey] = useState<string | null>(null)
  const [selectedHarness, setSelectedHarness] = useState(harnessId)
  const [loading, setLoading] = useState(false)
  const [savingCommand, setSavingCommand] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [registered, setRegistered] = useState<string[]>([])
  const [chatProviders, setChatProviders] = useState<WorkspaceChatProvider[]>([])
  const [setupObservations, setSetupObservations] = useState<HarnessSetupObservation[]>([])
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [commandDraft, setCommandDraft] = useState('')
  const [defaultDraft, setDefaultDraft] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => setSelectedHarness(harnessId), [harnessId])
  useEffect(() => {
    if (agentConfig) setCommandDraft(getRegisteredCommand(agentConfig.commands ?? {}, selectedHarness))
  }, [agentConfig, selectedHarness])

  useEffect(() => {
    let active = true
    if (!config) {
      setRegistered([])
      setChatProviders([])
      setSetupObservations([])
      setAgentConfig(null)
      setLoadedProfileKey(null)
      setLoading(false)
      setError('Connect to a backend to inspect harness registration and configuration.')
      return () => { active = false }
    }
    setLoading(true)
    setError('')
    void Promise.allSettled([
      fetchAgents(config),
      fetchAgentConfig(config),
      fetchWorkspaceChatProviders(config, chatScope),
      fetchHarnessSetup(config),
    ]).then(([agentsResult, configResult, chatResult, setupResult]) => {
      if (!active) return
      const problems: string[] = []
      if (agentsResult.status === 'fulfilled') setRegistered(agentsResult.value.filter(id => normalizeHarnessId(id) !== 'GEMINI'))
      else problems.push('registered harnesses')
      if (configResult.status === 'fulfilled') {
        setAgentConfig(configResult.value)
        setDefaultDraft(configResult.value.agent_provider ?? '')
      } else problems.push('agent command configuration')
      if (chatResult.status === 'fulfilled') setChatProviders((chatResult.value.providers ?? []).filter(item => normalizeHarnessId(item.id) !== 'GEMINI'))
      else setChatProviders([])
      if (setupResult.status === 'fulfilled') setSetupObservations(setupResult.value)
      else { setSetupObservations([]); problems.push('harness installation and sign-in status') }
      if (problems.length) setError(`Could not read ${problems.join(' and ')}. Retry to refresh this view.`)
      setLoadedProfileKey(profileKey)
      setLoading(false)
    })
    return () => { active = false }
  }, [config, chatScope, refreshKey, profileKey])

  const registeredHarnesses = useMemo(() => {
    const ids = new Set(registered.map(normalizeHarnessId))
    const ordered = KNOWN_HARNESSES.map((item) => item.id)
    for (const id of registered) if (!ordered.includes(normalizeHarnessId(id))) ordered.push(normalizeHarnessId(id))
    return ordered.map((id) => ({ id, registered: ids.has(id), chat: chatProviders.find((entry) => normalizeHarnessId(entry.id) === id) }))
  }, [registered, chatProviders])
  const currentRegistered = isHarnessRegistered(registered, selectedHarness)
  const command = getRegisteredCommand(agentConfig?.commands ?? {}, selectedHarness)
  const currentLabel = labelFor(selectedHarness)
  const currentGuide = guideFor(selectedHarness)
  const selectedSetup = setupObservations.find((item) => normalizeHarnessId(item.id) === selectedHarness)
  const signInCommand = HARNESS_SIGN_IN_COMMANDS[selectedHarness]

  const canOpenSignInTerminal = Boolean(config && selectedSetup?.installation === 'detected' && selectedSetup.terminal_supported)
  const openSignInTerminal = (launchCommand = signInCommand) => {
    if (!canOpenSignInTerminal || !launchCommand) return
    const state = useAppStore.getState()
    const id = `harness-sign-in-${selectedHarness.toLowerCase()}-${Date.now()}`
    state.setOpenTerminals([...state.openTerminals, { id, title: `${currentLabel} sign-in`, initialCommand: launchCommand }])
    state.setActiveSection('CONSOLE')
  }

  const copySignInCommand = async (command = signInCommand) => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setMessage(`Copied ${currentLabel} sign-in command. Run it on the backend host, then refresh this view.`)
    } catch {
      setError(`Could not copy the command. Run ${command} on the backend host.`)
    }
  }

  const refresh = useCallback(() => {
    setError('')
    setMessage('')
    setRefreshKey((value) => value + 1)
  }, [])

  const saveCommand = async () => {
    if (!config || !agentConfig || savingCommand || !commandDraft.trim()) return
    setSavingCommand(true)
    setError('')
    setMessage('')
    try {
      // This endpoint has no version/CAS field. Re-read and refuse to overwrite
      // a concurrent change to this provider or the selected default.
      const latest = await fetchAgentConfig(config)
      const latestCommand = getRegisteredCommand(latest.commands ?? {}, selectedHarness)
      if (latestCommand !== command || latest.agent_provider !== agentConfig.agent_provider) {
        setError('This harness configuration changed elsewhere. Refresh the panel and review the current values before saving.')
        return
      }
      await updateAgentConfig(config, buildCommandRegistrationPatch(latest.commands ?? {}, selectedHarness, commandDraft, latest.agent_provider))
      setRefreshKey((value) => value + 1)
      setMessage(`${currentLabel} command saved. Rechecking backend registration.`)
    } catch (cause) {
      setError(`Could not save the ${currentLabel} command: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSavingCommand(false)
    }
  }

  const saveDefault = async () => {
    if (!config || !agentConfig || savingDefault || !defaultDraft || defaultDraft === agentConfig.agent_provider) return
    if (!isHarnessRegistered(registered, defaultDraft)) {
      setError('The default must be a harness currently registered by the backend.')
      return
    }
    setSavingDefault(true)
    setError('')
    setMessage('')
    try {
      const latest = await fetchAgentConfig(config)
      if (latest.agent_provider !== agentConfig.agent_provider) {
        setError('The default harness changed elsewhere. Refresh the panel before saving.')
        return
      }
      // An empty command patch changes only agent_provider; other commands are
      // merged by the existing backend endpoint and remain untouched.
      await updateAgentConfig(config, { commands: {}, agent_provider: defaultDraft })
      setRefreshKey((value) => value + 1)
      setMessage(`${labelFor(defaultDraft)} is now the default for new task runs.`)
    } catch (cause) {
      setError(`Could not change the default harness: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSavingDefault(false)
    }
  }

  if (config && loadedProfileKey !== profileKey) {
    return <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking harnesses on the connected backend…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-6">
      <PanelHeader
        eyebrow={`${currentLabel} / Harness`}
        title="Harness setup"
        sub="Inspect backend runtimes, sign in through a provider CLI, and configure the command Orchestra uses for task runs."
      />

      {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
      {message && <p role="status" className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{message}</p>}

      <section className="rounded-xl border border-border/50 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Known harnesses</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Registration means a backend runner exists; it does not prove the CLI is installed or signed in. Install and sign in through your provider’s own documented flow.</p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={loading || !config} onClick={refresh}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
          </Button>
        </div>
        <div className="mb-3 max-w-sm">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Configure harness</label>
          <CustomDropdown value={selectedHarness} options={registeredHarnesses.map(({ id }) => ({ label: labelFor(id), value: id }))} onChange={setSelectedHarness} disabled={loading} placeholder="Choose harness" className="w-full" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {registeredHarnesses.map(({ id, registered: isRegistered, chat }) => (
            <div key={id} className={`min-w-0 rounded-lg border p-3 ${id === selectedHarness ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-background/50'}`}>
              <div className="flex items-center gap-2 text-xs font-medium">
                {isRegistered ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <CircleDashed className="size-3.5 text-muted-foreground" />}
                <button type="button" onClick={() => setSelectedHarness(id)} className="min-w-0 truncate text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{labelFor(id)}</button>
                <span className="ml-auto text-[10px] text-muted-foreground">{isRegistered ? 'registered' : 'not registered'}</span>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Installation: {setupObservations.find((item) => normalizeHarnessId(item.id) === id)?.installation === 'detected' ? 'detected on backend' : setupObservations.find((item) => normalizeHarnessId(item.id) === id)?.installation === 'missing' ? 'CLI not found on backend PATH' : 'not observed'}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Authentication: {setupObservations.find((item) => normalizeHarnessId(item.id) === id)?.authentication === 'signed_in' ? 'signed in (Codex CLI status)' : setupObservations.find((item) => normalizeHarnessId(item.id) === id)?.authentication === 'signed_out' ? 'signed out (Codex CLI status)' : 'not verified'}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {chat ? chat.conversation_mode === 'native_session' ? `Chat: native session${chat.provider_resume ? ' · resume supported' : ''}` : 'Chat: transcript replay' : isRegistered ? 'Chat capability: not observed' : 'Runtime capability: unavailable until registered'}
              </p>
              {guideFor(id) && <a href={guideFor(id)} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[10px] font-medium text-primary hover:underline">Provider install and sign-in guide ↗</a>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-card/40 p-4" aria-label={`${currentLabel} onboarding`}>
        <h3 className="text-sm font-semibold">Set up {currentLabel}</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">These observations come from the connected backend host. Registration, installation and sign-in are checked separately.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <p className="rounded-lg border border-border/40 bg-background/50 p-3 text-xs"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Runner</span>{currentRegistered ? 'Registered' : 'Not registered'}</p>
          <p className="rounded-lg border border-border/40 bg-background/50 p-3 text-xs"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">CLI</span>{selectedSetup?.installation === 'detected' ? 'Detected on backend' : selectedSetup?.installation === 'missing' ? 'Not found on backend PATH' : 'Not observed'}</p>
          <p className="rounded-lg border border-border/40 bg-background/50 p-3 text-xs"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Sign-in</span>{selectedSetup?.authentication === 'signed_in' ? 'Verified by Codex CLI' : selectedSetup?.authentication === 'signed_out' ? 'Codex CLI reports signed out' : 'Not verified'}</p>
        </div>
        {signInCommand && <div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded-lg border border-border bg-background px-3 py-2 text-xs">{signInCommand}</code>{canOpenSignInTerminal && <Button type="button" size="sm" onClick={() => openSignInTerminal()}>Open sign-in terminal</Button>}{selectedHarness === 'CODEX' && (canOpenSignInTerminal ? <Button type="button" size="sm" variant="outline" onClick={() => openSignInTerminal('codex login --device-auth')}>Use device code</Button> : <Button type="button" size="sm" variant="outline" onClick={() => void copySignInCommand('codex login --device-auth')}><Copy className="size-3.5" /> Copy device-code command</Button>)}<Button type="button" size="sm" variant="outline" onClick={() => void copySignInCommand()}><Copy className="size-3.5" /> Copy command</Button><span className="text-[11px] text-muted-foreground">{selectedSetup?.installation !== 'detected' ? 'Install the CLI on the backend host before signing in.' : selectedSetup.terminal_supported ? 'Runs on the backend host. Return here and Refresh after signing in.' : 'Interactive backend terminals are unavailable on this host. Run the copied command in a terminal on the backend host, then Refresh.'}</span></div>}
        {!signInCommand && <p className="mt-3 text-[11px] text-muted-foreground">Use the provider setup guide for this harness. Orchestra does not have a verified sign-in command for it.</p>}
        {currentGuide && <a href={currentGuide} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-medium text-primary hover:underline">Open {currentLabel} setup guide ↗</a>}
      </section>

      <section className="rounded-xl border border-border/50 bg-card/40 p-4">
        <h3 className="text-sm font-semibold">Backend-wide {currentLabel} command registration</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Set the command template used for batch task runs across this backend. Use <code className="rounded bg-muted px-1">{'{{prompt}}'}</code> where the task prompt should be inserted. Saving registers the command with the backend; it does not run a probe or sign in to an account. The existing config API cannot unregister a command by clearing it.
        </p>
        {selectedHarness === 'CODEX' && <p className="mt-2 text-[11px] text-muted-foreground">Codex chat uses the separately registered native app-server when available; this command is for batch task runs.</p>}
        {selectedHarness === 'ANTIGRAVITY' && <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <p>Antigravity is its own harness, separate from Gemini CLI. No installation, sign-in, or invocation command is presumed; enter a command you have verified for your installation.</p>
          <p>Its CLI documentation lists <code className="rounded bg-muted px-1">--agent</code>, <code className="rounded bg-muted px-1">--mode accept-edits|plan</code>, stream-json input/output, conversation resume, and sandbox options. Orchestra reports only the runtime modes returned by its backend; these provider flags are not yet individual Orchestra settings.</p>
          <a href="https://www.antigravity.google/docs/cli/headless/" target="_blank" rel="noreferrer" className="inline-flex font-medium text-primary hover:underline">Antigravity headless CLI options ↗</a>
        </div>}
        <label htmlFor="harness-command" className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Command template</label>
        <textarea id="harness-command" value={commandDraft} onChange={(event) => setCommandDraft(event.target.value)} rows={3} spellCheck={false}
          placeholder={currentRegistered ? 'No command recorded for this registered runner' : 'Enter a verified executable command with {{prompt}}'}
          className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="min-w-0 text-[10px] text-muted-foreground">{currentRegistered ? `Current command: ${command || 'not returned by backend'}` : 'Saving a verified command registers this harness with the backend.'}{currentGuide && <> <a href={currentGuide} target="_blank" rel="noreferrer" className="text-primary hover:underline">Setup help ↗</a></>}</p>
          <Button type="button" size="sm" disabled={!config || !agentConfig || loading || savingCommand || !commandDraft.trim() || commandDraft.trim() === command.trim()} onClick={() => void saveCommand()}>
            {savingCommand ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save command
          </Button>
        </div>
      </section>

      <section aria-label="Default task harness" className="rounded-xl border border-border/50 bg-card/40 p-4">
        <h3 className="text-sm font-semibold">Backend-wide default task harness</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">Used when a new task run does not specify a provider. It does not change existing workspace-chat sessions.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CustomDropdown value={defaultDraft} options={registered.map((id) => ({ label: labelFor(id), value: normalizeHarnessId(id) }))} onChange={setDefaultDraft} disabled={loading || !registered.length} placeholder="No registered harness" className="min-w-44" />
          <Button type="button" size="sm" disabled={!config || !agentConfig || loading || savingDefault || !defaultDraft || defaultDraft === agentConfig.agent_provider || !isHarnessRegistered(registered, defaultDraft)} onClick={() => void saveDefault()}>
            {savingDefault ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save default
          </Button>
          <span className="text-[10px] text-muted-foreground">Current: {agentConfig?.agent_provider ? labelFor(agentConfig.agent_provider) : 'unknown'}</span>
        </div>
        {normalizeHarnessId(agentConfig?.agent_provider ?? '') === 'GEMINI' && <p role="status" className="text-[10px] text-muted-foreground">The stored Gemini task default is preserved. Gemini is no longer offered for new task runs; select a currently registered harness to replace it.</p>}
      </section>
    </div>
  )
}
