import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react'
import type { BackendConfig } from '@core/api/types'
import {
  type CodexDeviceLogin,
  type HarnessAccounts,
  type HarnessSetupObservation,
  type WorkspaceChatProvider,
  beginHarnessAccount,
  cancelCodexDeviceLogin,
  fetchAgentConfig,
  fetchAgents,
  fetchCodexDeviceLogin,
  fetchHarnessAccounts,
  fetchHarnessSetup,
  fetchWorkspaceChatProviders,
  reauthHarnessAccount,
  removeHarnessAccount,
  selectHarnessAccount,
  setHarnessRegistration,
  startCodexDeviceLogin,
  updateAgentConfig,
  verifyHarnessAccount,
} from '@core/api/client'
import { useAppStore } from '@core/store'
import { Button } from '@ui/button'
import { CustomDropdown } from '@layout/shared/controls'
import { PanelHeader } from '../components/PanelHeader'
import { AgentCatalogRow } from './AgentCatalogRow'
import { AgentDefaultPills } from './AgentDefaultPills'
import {
  buildCommandRegistrationPatch,
  getRegisteredCommand,
  isHarnessRegistered,
  KNOWN_HARNESSES,
  normalizeHarnessId,
} from './harness-setup'

const labelFor = (id: string) =>
  normalizeHarnessId(id) === 'GEMINI'
    ? 'Gemini'
    : KNOWN_HARNESSES.find((item) => item.id === normalizeHarnessId(id))?.label ?? id

export function HarnessSetupPanel({
  config,
  provider,
  projectId: _projectId,
}: {
  config: BackendConfig | null
  provider: string
  projectId: string | null
}) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [registered, setRegistered] = useState<string[]>([])
  const [setupObservations, setSetupObservations] = useState<HarnessSetupObservation[]>([])
  const [chatProviders, setChatProviders] = useState<WorkspaceChatProvider[]>([])
  const [agentConfig, setAgentConfig] = useState<{ commands?: Record<string, string>; agent_provider?: string; max_turns?: number } | null>(null)
  const [selectedHarness, setSelectedHarness] = useState(() => normalizeHarnessId(provider))
  const [expandedHarness, setExpandedHarness] = useState<string>(() => normalizeHarnessId(provider))
  const [commandDraft, setCommandDraft] = useState('')
  const [defaultDraft, setDefaultDraft] = useState('')
  const [registrationBusy, setRegistrationBusy] = useState(false)
  const [savingCommand, setSavingCommand] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [deviceLogin, setDeviceLogin] = useState<CodexDeviceLogin | null>(null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [accounts, setAccounts] = useState<HarnessAccounts | null>(null)
  const [accountLabel, setAccountLabel] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [loadedProfileKey, setLoadedProfileKey] = useState<string | null>(null)

  const profileKey = config ? `${config.baseUrl}::${config.apiToken ?? ''}` : null

  useEffect(() => {
    const nextHarness = normalizeHarnessId(provider)
    setSelectedHarness(nextHarness)
    setExpandedHarness(nextHarness)
  }, [provider])

  useEffect(() => {
    if (!config) {
      setRegistered([])
      setSetupObservations([])
      setChatProviders([])
      setAgentConfig(null)
      setDefaultDraft('')
      setDeviceLogin(null)
      setAccounts(null)
      setLoadedProfileKey(null)
      return
    }

    let active = true
    setLoading(true)
    setError('')

    Promise.allSettled([
      fetchAgents(config),
      fetchHarnessSetup(config),
      fetchWorkspaceChatProviders(config, '__orchestrator__'),
      fetchAgentConfig(config),
      fetchHarnessAccounts(config),
    ]).then(([agentsResult, setupResult, chatResult, configResult, accountsResult]) => {
      if (!active) return

      if (agentsResult.status === 'fulfilled') {
        const nextRegistered = agentsResult.value
          .map(normalizeHarnessId)
          .filter((id) => id !== 'GEMINI')
        setRegistered(nextRegistered)
      } else {
        setError(`Could not load registered harnesses: ${agentsResult.reason instanceof Error ? agentsResult.reason.message : String(agentsResult.reason)}`)
      }

      if (setupResult.status === 'fulfilled') {
        setSetupObservations(setupResult.value)
      }

      if (chatResult.status === 'fulfilled') {
        setChatProviders((chatResult.value.providers ?? []).filter((item) => normalizeHarnessId(item.id) !== 'GEMINI'))
      }

      if (configResult.status === 'fulfilled') {
        setAgentConfig(configResult.value)
        setDefaultDraft(normalizeHarnessId(configResult.value.agent_provider ?? ''))
      } else if (agentsResult.status === 'fulfilled') {
        setError(`Could not load harness commands: ${configResult.reason instanceof Error ? configResult.reason.message : String(configResult.reason)}`)
      }

      if (accountsResult.status === 'fulfilled') {
        setAccounts(accountsResult.value)
      } else {
        setAccounts(null)
      }

      setLoadedProfileKey(profileKey)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [config, profileKey, refreshKey])

  const registeredHarnesses = useMemo(() => {
    return KNOWN_HARNESSES.map((item) => {
      const isRegistered = isHarnessRegistered(registered, item.id)
      const chat = chatProviders.find((provider) => normalizeHarnessId(provider.id) === item.id)
      return {
        id: item.id,
        label: item.label,
        registered: isRegistered,
        chat,
      }
    })
  }, [chatProviders, registered])

  const setupMap = useMemo(() => {
    return new Map(setupObservations.map((obs) => [normalizeHarnessId(obs.id), obs]))
  }, [setupObservations])

  const installedList = useMemo(() => {
    return registeredHarnesses.filter((h) => {
      const obs = setupMap.get(h.id)
      return obs?.installation === 'detected'
    })
  }, [registeredHarnesses, setupMap])

  const availableList = useMemo(() => {
    return registeredHarnesses.filter((h) => {
      const obs = setupMap.get(h.id)
      return obs?.installation !== 'detected'
    })
  }, [registeredHarnesses, setupMap])

  const command = useMemo(() => {
    return getRegisteredCommand(agentConfig?.commands ?? {}, selectedHarness)
  }, [agentConfig?.commands, selectedHarness])

  useEffect(() => {
    setCommandDraft(command)
  }, [command])

  useEffect(() => {
    if (!config || !deviceLogin || !['starting', 'pending'].includes(deviceLogin.state)) return
    let cancelled = false
    const timer = setInterval(() => {
      fetchCodexDeviceLogin(config, deviceLogin.id)
        .then((latest) => {
          if (cancelled) return
          setDeviceLogin(latest)
          if (latest.state === 'succeeded') {
            setMessage('Codex sign-in completed. Refreshing backend harness status…')
            setRefreshKey((value) => value + 1)
      window.dispatchEvent(new CustomEvent('orchestra:harness-registration-changed'))
          }
        })
        .catch(() => {})
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [config, deviceLogin])

  const refresh = useCallback(() => {
    setError('')
    setMessage('')
    setRefreshKey((value) => value + 1)
  }, [])

  const toggleRegistration = async (targetHarness?: string, forceState?: boolean) => {
    const harnessId = targetHarness ?? selectedHarness
    const targetSetup = setupObservations.find((item) => normalizeHarnessId(item.id) === harnessId)
    const isCurrentReg = isHarnessRegistered(registered, harnessId)
    const nextState = forceState !== undefined ? forceState : !isCurrentReg
    if (!config || !targetSetup || registrationBusy) return
    if (nextState === isCurrentReg) return

    setRegistrationBusy(true)
    setError('')
    setMessage('')
    try {
      await setHarnessRegistration(config, harnessId, nextState, targetSetup.registration_version ?? 0)
      setMessage(`${labelFor(harnessId)} ${nextState ? 'registered' : 'unregistered'}. New turns now use the updated availability.`)
      setRefreshKey((value) => value + 1)
    } catch (cause) {
      setError(`Could not ${nextState ? 'register' : 'unregister'} ${labelFor(harnessId)}: ${cause instanceof Error ? cause.message : String(cause)}. Refresh to review the current state.`)
    } finally {
      setRegistrationBusy(false)
    }
  }

  const saveCommand = async (targetHarness?: string) => {
    const harnessId = targetHarness ?? selectedHarness
    if (!config || !agentConfig || savingCommand || !commandDraft.trim()) return
    setSavingCommand(true)
    setError('')
    setMessage('')
    try {
      const latest = await fetchAgentConfig(config)
      const latestCommand = getRegisteredCommand(latest.commands ?? {}, harnessId)
      if (latestCommand !== command || latest.agent_provider !== agentConfig.agent_provider) {
        setError('This harness configuration changed elsewhere. Refresh the panel and review the current values before saving.')
        return
      }
      await updateAgentConfig(config, buildCommandRegistrationPatch(latest.commands ?? {}, harnessId, commandDraft, latest.agent_provider))
      setRefreshKey((value) => value + 1)
      setMessage(`${labelFor(harnessId)} command saved. Register the harness above to make it available for new turns.`)
    } catch (cause) {
      setError(`Could not save the ${labelFor(harnessId)} command: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSavingCommand(false)
    }
  }

  const saveDefault = async (targetId?: string) => {
    const nextDefault = targetId ?? defaultDraft
    if (!config || !agentConfig || savingDefault || !nextDefault || nextDefault === agentConfig.agent_provider) return
    if (!isHarnessRegistered(registered, nextDefault)) {
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
      await updateAgentConfig(config, { commands: {}, agent_provider: nextDefault })
      setDefaultDraft(nextDefault)
      setRefreshKey((value) => value + 1)
      window.dispatchEvent(new CustomEvent('orchestra:harness-registration-changed'))
      setMessage(`${labelFor(nextDefault)} is now the default for new task runs.`)
    } catch (cause) {
      setError(`Could not change the default harness: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSavingDefault(false)
    }
  }

  const openSignInTerminal = (targetHarness?: string, explicitCommand?: string) => {
    const harnessId = targetHarness ?? selectedHarness
    const initialCommand = explicitCommand || (harnessId === 'CODEX' ? 'codex login' : harnessId === 'CLAUDE' ? 'claude auth login' : '')
    if (!initialCommand) return
    const title = `${labelFor(harnessId)} sign-in`
    const state = useAppStore.getState()
    const id = `harness-sign-in-${harnessId.toLowerCase()}-${Date.now()}`
    state.setOpenTerminals([...state.openTerminals, { id, title, initialCommand }])
    state.setActiveSection('CONSOLE')
  }

  const copySignInCommand = (explicitCommand?: string) => {
    const textToCopy = explicitCommand || (selectedHarness === 'CODEX' ? 'codex login' : selectedHarness === 'CLAUDE' ? 'claude auth login' : '')
    if (textToCopy) {
      void navigator.clipboard.writeText(textToCopy)
      setMessage(`Copied "${textToCopy}" to clipboard. Run it in a terminal on the backend host, then Refresh.`)
    }
  }

  const startDeviceLogin = async () => {
    if (!config || deviceBusy) return
    setDeviceBusy(true)
    setError('')
    setMessage('')
    try {
      const login = await startCodexDeviceLogin(config)
      setDeviceLogin(login)
    } catch (cause) {
      setError(`Could not start device login: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setDeviceBusy(false)
    }
  }

  const cancelDeviceLogin = async () => {
    if (!config || !deviceLogin) return
    try {
      await cancelCodexDeviceLogin(config, deviceLogin.id)
      setDeviceLogin((current) => (current ? { ...current, state: 'canceled', message: 'Device login canceled.' } : null))
    } catch (cause) {
      setError(`Could not cancel device login: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  const accountSelection = useMemo(() => {
    return accounts?.selections?.find((item) => item.provider === 'CODEX') ?? { provider: 'CODEX', version: 0, account_id: '' }
  }, [accounts?.selections])

  const managedAccounts = useMemo(() => {
    return (accounts?.accounts ?? []).filter((item) => item.provider === 'CODEX')
  }, [accounts?.accounts])

  const addManagedAccount = async () => {
    if (!config || accountBusy || !accountLabel.trim()) return
    setAccountBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await beginHarnessAccount(config, accountLabel.trim())
      setAccountLabel('')
      setRefreshKey((value) => value + 1)
      if (result.login) {
        setDeviceLogin(result.login)
      }
    } catch (cause) {
      setError(`Could not add account: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setAccountBusy(false)
    }
  }

  const manageAccount = async (action: 'select' | 'verify' | 'reauth' | 'remove', accountId: string) => {
    if (!config || accountBusy) return
    setAccountBusy(true)
    setError('')
    setMessage('')
    try {
      if (action === 'select') {
        await selectHarnessAccount(config, 'CODEX', accountId, accountSelection.version)
      } else if (action === 'verify') {
        await verifyHarnessAccount(config, accountId)
      } else if (action === 'reauth') {
        const result = await reauthHarnessAccount(config, accountId)
        setDeviceLogin(result)
      } else if (action === 'remove') {
        await removeHarnessAccount(config, accountId)
      }
      setRefreshKey((value) => value + 1)
    } catch (cause) {
      setError(`Account action failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setAccountBusy(false)
    }
  }

  if (config && loadedProfileKey !== profileKey) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking harnesses on the connected backend…
      </div>
    )
  }

  const currentDefault = normalizeHarnessId(agentConfig?.agent_provider ?? '')

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-6">
      <PanelHeader
        eyebrow="Harness"
        title="Harness setup"
        sub="Inspect backend runtimes, manage provider authentication, and configure task harnesses."
      />

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-muted-foreground">
          {message}
        </p>
      )}

      {/* Top Default Agent Pills */}
      <AgentDefaultPills
        registered={registered}
        activeDefaultId={currentDefault}
        savingDefault={savingDefault}
        disabled={loading || !config}
        onSelectDefault={(harnessId) => {
          void saveDefault(harnessId)
        }}
      />

      {/* Installed Agents Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">Installed</h3>
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              {installedList.length} detected
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !config}
            onClick={refresh}
            className="h-7 gap-1 text-xs"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Refresh
          </Button>
        </div>

        <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card/40">
          {installedList.map((harness) => {
            const isReg = isHarnessRegistered(registered, harness.id)
            const isDef = currentDefault === harness.id
            const isExp = expandedHarness === harness.id
            const setup = setupMap.get(harness.id)
            const rowCommand = getRegisteredCommand(agentConfig?.commands ?? {}, harness.id)
            return (
              <AgentCatalogRow
                key={harness.id}
                id={harness.id}
                isReg={isReg}
                isDefault={isDef}
                isExpanded={isExp}
                setup={setup}
                chat={harness.chat}
                command={rowCommand}
                draft={selectedHarness === harness.id ? commandDraft : rowCommand}
                config={config}
                loading={loading}
                registrationBusy={registrationBusy}
                savingCommand={savingCommand}
                savingDefault={savingDefault}
                deviceLogin={deviceLogin}
                deviceBusy={deviceBusy}
                accountLabel={accountLabel}
                accountBusy={accountBusy}
                accounts={accounts}
                managedAccounts={managedAccounts}
                accountSelection={accountSelection}
                onToggleExpand={(id) => {
                  setSelectedHarness(id)
                  setExpandedHarness((prev) => (prev === id ? '' : id))
                }}
                onToggleRegistration={(id, nextState) => void toggleRegistration(id, nextState)}
                onSaveDefault={(id) => void saveDefault(id)}
                onSaveCommand={(id) => void saveCommand(id)}
                onDraftChange={(_id, val) => setCommandDraft(val)}
                onOpenTerminal={(id, cmd) => openSignInTerminal(id, cmd)}
                onCopyCommand={(cmd) => copySignInCommand(cmd)}
                onStartDeviceLogin={() => void startDeviceLogin()}
                onCancelDeviceLogin={() => void cancelDeviceLogin()}
                onAddAccount={() => void addManagedAccount()}
                onAccountLabelChange={(val) => setAccountLabel(val)}
                onManageAccount={(action, id) => void manageAccount(action, id)}
              />
            )
          })}
        </div>
      </section>

      {/* Available to install Section */}
      {availableList.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">Available to install</h3>
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              {availableList.length} {availableList.length === 1 ? 'agent' : 'agents'}
            </span>
          </div>

          <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card/40">
            {availableList.map((harness) => {
              const isReg = isHarnessRegistered(registered, harness.id)
              const isDef = currentDefault === harness.id
              const isExp = expandedHarness === harness.id
              const setup = setupMap.get(harness.id)
              const rowCommand = getRegisteredCommand(agentConfig?.commands ?? {}, harness.id)
              return (
                <AgentCatalogRow
                  key={harness.id}
                  id={harness.id}
                  isReg={isReg}
                  isDefault={isDef}
                  isExpanded={isExp}
                  setup={setup}
                  chat={harness.chat}
                  command={rowCommand}
                  draft={selectedHarness === harness.id ? commandDraft : rowCommand}
                  config={config}
                  loading={loading}
                  registrationBusy={registrationBusy}
                  savingCommand={savingCommand}
                  savingDefault={savingDefault}
                  deviceLogin={deviceLogin}
                  deviceBusy={deviceBusy}
                  accountLabel={accountLabel}
                  accountBusy={accountBusy}
                  accounts={accounts}
                  managedAccounts={managedAccounts}
                  accountSelection={accountSelection}
                  onToggleExpand={(id) => {
                    setSelectedHarness(id)
                    setExpandedHarness((prev) => (prev === id ? '' : id))
                  }}
                  onToggleRegistration={(id, nextState) => void toggleRegistration(id, nextState)}
                  onSaveDefault={(id) => void saveDefault(id)}
                  onSaveCommand={(id) => void saveCommand(id)}
                  onDraftChange={(_id, val) => setCommandDraft(val)}
                  onOpenTerminal={(id, cmd) => openSignInTerminal(id, cmd)}
                  onCopyCommand={(cmd) => copySignInCommand(cmd)}
                  onStartDeviceLogin={() => void startDeviceLogin()}
                  onCancelDeviceLogin={() => void cancelDeviceLogin()}
                  onAddAccount={() => void addManagedAccount()}
                  onAccountLabelChange={(val) => setAccountLabel(val)}
                  onManageAccount={(action, id) => void manageAccount(action, id)}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Default task harness dropdown selector for backend-wide preference */}
      <section aria-label="Default task harness" className="rounded-xl border border-border/50 bg-card/40 p-4">
        <h3 className="text-sm font-semibold">Backend-wide default task harness</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Used when a new task run does not specify a provider. It does not change existing workspace-chat sessions.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CustomDropdown
            value={defaultDraft}
            options={registered.map((id) => ({ label: labelFor(id), value: normalizeHarnessId(id) }))}
            onChange={setDefaultDraft}
            disabled={loading || !registered.length}
            placeholder="No registered harness"
            className="min-w-44"
          />
          <Button
            type="button"
            size="sm"
            disabled={
              !config ||
              !agentConfig ||
              loading ||
              savingDefault ||
              !defaultDraft ||
              defaultDraft === agentConfig.agent_provider ||
              !isHarnessRegistered(registered, defaultDraft)
            }
            onClick={() => void saveDefault()}
          >
            {savingDefault ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Save className="size-3.5 mr-1" />} Save default
          </Button>
          <span className="text-[10px] text-muted-foreground">
            Current: {agentConfig?.agent_provider ? labelFor(agentConfig.agent_provider) : 'unknown'}
          </span>
        </div>
        {normalizeHarnessId(agentConfig?.agent_provider ?? '') === 'GEMINI' && (
          <p role="status" className="mt-2 text-[10px] text-muted-foreground">
            The stored Gemini task default is preserved. Gemini is no longer offered for new task runs; select a currently registered harness to replace it.
          </p>
        )}
      </section>
    </div>
  )
}
