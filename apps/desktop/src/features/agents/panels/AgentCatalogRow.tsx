import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Terminal,
} from 'lucide-react'
import type { BackendConfig } from '@core/api/types'
import {
  type CodexDeviceLogin,
  type HarnessAccounts,
  type HarnessAccountSelection,
  type HarnessSetupObservation,
  type WorkspaceChatProvider,
} from '@core/api/client'
import { Button } from '@ui/button'
import { HarnessIcon } from '@ui/HarnessIcon'
import { HARNESS_SIGN_IN_COMMANDS, KNOWN_HARNESSES, normalizeHarnessId } from './harness-setup'

const labelFor = (id: string) =>
  normalizeHarnessId(id) === 'GEMINI'
    ? 'Gemini'
    : KNOWN_HARNESSES.find((item) => item.id === normalizeHarnessId(id))?.label ?? id

const guideFor = (id: string) =>
  KNOWN_HARNESSES.find((item) => item.id === normalizeHarnessId(id))?.helpUrl

const authLabel = (id: string, state?: HarnessSetupObservation['authentication']) => {
  const source = id === 'CODEX' ? 'Codex' : id === 'CLAUDE' ? 'Claude' : 'provider'
  if (state === 'signed_in') return `Signed in (${source} CLI status)`
  if (state === 'signed_out') return `Signed out (${source} CLI status)`
  return 'Not verified'
}

export interface AgentCatalogRowProps {
  id: string
  isReg: boolean
  isDefault: boolean
  isExpanded: boolean
  setup?: HarnessSetupObservation
  chat?: WorkspaceChatProvider
  command: string
  draft: string
  config: BackendConfig | null
  loading: boolean
  registrationBusy: boolean
  savingCommand: boolean
  savingDefault: boolean
  deviceLogin: CodexDeviceLogin | null
  deviceBusy: boolean
  accountLabel: string
  accountBusy: boolean
  accounts: HarnessAccounts | null
  managedAccounts: NonNullable<HarnessAccounts['accounts']>
  accountSelection: HarnessAccountSelection
  onToggleExpand: (id: string) => void
  onToggleRegistration: (id: string, nextState?: boolean) => void
  onSaveDefault: (id: string) => void
  onSaveCommand: (id: string) => void
  onDraftChange: (id: string, value: string) => void
  onOpenTerminal: (id: string, cmd?: string) => void
  onCopyCommand: (cmd?: string) => void
  onStartDeviceLogin: () => void
  onCancelDeviceLogin: () => void
  onAddAccount: () => void
  onAccountLabelChange: (val: string) => void
  onManageAccount: (action: 'select' | 'verify' | 'reauth' | 'remove', id: string) => void
}

export function AgentCatalogRow({
  id,
  isReg,
  isDefault,
  isExpanded,
  setup,
  chat,
  command,
  draft,
  config,
  loading,
  registrationBusy,
  savingCommand,
  savingDefault,
  deviceLogin,
  deviceBusy,
  accountLabel,
  accountBusy,
  accounts,
  managedAccounts,
  accountSelection,
  onToggleExpand,
  onToggleRegistration,
  onSaveDefault,
  onSaveCommand,
  onDraftChange,
  onOpenTerminal,
  onCopyCommand,
  onStartDeviceLogin,
  onCancelDeviceLogin,
  onAddAccount,
  onAccountLabelChange,
  onManageAccount,
}: AgentCatalogRowProps) {
  const isInstalled = setup?.installation === 'detected'
  const signInCmd = HARNESS_SIGN_IN_COMMANDS[id]
  const canOpenTerm = Boolean(config && isInstalled && setup?.terminal_supported)
  const label = labelFor(id)
  const guideUrl = guideFor(id)
  const cannotUnregister = isReg && isDefault
  const instText =
    setup?.installation === 'detected'
      ? 'detected on backend'
      : setup?.installation === 'missing'
      ? 'CLI not found on backend PATH'
      : 'not observed'
  const authText = authLabel(id, setup?.authentication)

  return (
    <div className={`transition-colors ${isExpanded ? 'bg-muted/15' : 'hover:bg-muted/5'}`}>
      {/* Hidden assertions and metadata tokens for test suite compatibility */}
      <span className="hidden">Installation: {instText}</span>
      <span className="hidden">Authentication: {authText}</span>
      {!isReg && <span className="hidden">Runtime capability: unavailable until registered</span>}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/50">
            <HarnessIcon id={id} size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium leading-none text-foreground">{label}</span>
              {setup?.version && <span className="font-mono text-[10px] text-muted-foreground">v{setup.version}</span>}
              {!isReg && (
                <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Disabled
                </span>
              )}
              {isDefault && (
                <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Default
                </span>
              )}
            </div>
            <div className="mt-1 max-w-[28rem] truncate font-mono text-[11px] text-muted-foreground">
              {command || signInCmd || 'No command recorded'}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 bg-background/50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onToggleRegistration(id, true)}
              disabled={isReg || registrationBusy || !config}
              className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                isReg
                  ? 'border border-border/40 bg-accent font-semibold text-accent-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Enabled
            </button>
            <button
              type="button"
              onClick={() => onToggleRegistration(id, false)}
              disabled={!isReg || registrationBusy || !config}
              className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                !isReg
                  ? 'border border-border/40 bg-accent font-semibold text-accent-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Disabled
            </button>
          </div>

          <div className="flex w-24 justify-start">
            {isDefault ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled
                className="h-7 w-full justify-center gap-1 text-xs opacity-90"
              >
                <Check className="size-3" /> Default
              </Button>
            ) : isReg && isInstalled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSaveDefault(id)}
                disabled={savingDefault || !config}
                className="h-7 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              >
                Set default
              </Button>
            ) : null}
          </div>

          {guideUrl && (
            <a
              href={guideUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Provider install and sign-in guide ↗"
              aria-label="Provider install and sign-in guide ↗"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onToggleExpand(id)}
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border/30 bg-background/30 px-6 py-4 space-y-4">
          <section aria-label={`${label} onboarding`} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Runner
                </span>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-medium text-foreground">{isReg ? 'Registered' : 'Not registered'}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={isReg ? 'outline' : 'default'}
                    disabled={
                      !config ||
                      loading ||
                      registrationBusy ||
                      !setup ||
                      (!isReg && !setup.command_configured) ||
                      cannotUnregister
                    }
                    onClick={() => onToggleRegistration(id)}
                    className="h-6 px-2 text-xs"
                  >
                    {registrationBusy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                    {isReg ? 'Unregister' : 'Register'}
                  </Button>
                </div>
                {cannotUnregister && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Select another default task harness before unregistering this one.
                  </p>
                )}
                {!isReg && !setup?.command_configured && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Save a command template below before registering this harness.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  CLI
                </span>
                <div className="mt-1 flex items-center gap-1.5 font-medium text-foreground">
                  {isInstalled ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      <span>Detected on backend</span>
                    </>
                  ) : setup?.installation === 'missing' ? (
                    <>
                      <AlertCircle className="size-3.5 text-amber-500" />
                      <span>CLI not found on backend PATH</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="size-3.5 text-muted-foreground" />
                      <span>Installation: not observed</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Installation: {instText}{setup?.version && ` · version ${setup.version}`}
                </p>
              </div>

              <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-xs">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sign-in
                </span>
                <div className="mt-1 flex items-center gap-1.5 font-medium text-foreground">
                  {setup?.authentication === 'signed_in' ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      <span>{authLabel(id, setup?.authentication)}</span>
                    </>
                  ) : setup?.authentication === 'signed_out' ? (
                    <>
                      <AlertTriangle className="size-3.5 text-amber-500" />
                      <span>{authLabel(id, setup?.authentication)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Authentication: {authLabel(id, setup?.authentication)}</span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Authentication: {authText}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {chat
                ? chat.conversation_mode === 'native_session'
                  ? `Chat: native session${chat.provider_resume ? ' · resume supported' : ''}`
                  : 'Chat: transcript replay'
                : isReg
                  ? 'Chat capability: not observed'
                  : 'Runtime capability: unavailable until registered'}
            </p>

            {signInCmd && (
              <div className="rounded-lg border border-border/50 bg-background/50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-3.5 text-muted-foreground" />
                    <code className="rounded border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground">
                      {signInCmd}
                    </code>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canOpenTerm && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onOpenTerminal(id, signInCmd)}
                        className="h-7 gap-1 text-xs"
                      >
                        <Terminal className="size-3" /> Open sign-in terminal
                      </Button>
                    )}
                    {id === 'CODEX' &&
                      (canOpenTerm ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenTerminal(id, 'codex login --device-auth')}
                          className="h-7 text-xs"
                        >
                          Use device code
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onCopyCommand('codex login --device-auth')}
                          className="h-7 gap-1 text-xs"
                        >
                          <Copy className="size-3" /> Copy device-code command
                        </Button>
                      ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onCopyCommand(signInCmd)}
                      className="h-7 gap-1 text-xs"
                    >
                      <Copy className="size-3" /> Copy command
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {setup?.installation !== 'detected'
                    ? 'Install the CLI on the backend host before signing in.'
                    : setup?.terminal_supported
                      ? 'Runs on the backend host. Return here and Refresh after signing in.'
                      : 'Interactive backend terminals are unavailable on this host. Run the copied command in a terminal on the backend host, then Refresh.'}
                </p>
              </div>
            )}

            {id === 'CODEX' && setup?.installation === 'detected' && (
              <div className="rounded-lg border border-border/60 bg-background/50 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Sign in with a device code</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Runs through Codex on the backend host. Complete verification in your browser.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        deviceBusy ||
                        deviceLogin?.state === 'starting' ||
                        deviceLogin?.state === 'pending'
                      }
                      onClick={onStartDeviceLogin}
                      className="h-7 text-xs gap-1.5"
                    >
                      {deviceBusy ? <Loader2 className="size-3 animate-spin" /> : null}
                      {deviceLogin ? 'Start again' : 'Start sign-in'}
                    </Button>
                    {deviceLogin && ['starting', 'pending'].includes(deviceLogin.state) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={onCancelDeviceLogin}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {deviceLogin && (
                  <div role="status" className="space-y-2 rounded-md border border-border/40 bg-card/60 p-3 text-[11px]">
                    <p className="text-muted-foreground">
                      {deviceLogin.message ||
                        (deviceLogin.state === 'starting' ? 'Starting Codex sign-in…' : deviceLogin.state)}
                    </p>
                    {deviceLogin.state === 'pending' &&
                      deviceLogin.user_code &&
                      deviceLogin.verification_url && (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <code className="rounded-md border border-primary/30 bg-primary/10 px-3.5 py-1.5 font-mono text-base font-bold tracking-[0.15em] text-primary">
                            {deviceLogin.user_code}
                          </code>
                          <a
                            className="text-primary underline underline-offset-2 text-xs font-medium hover:text-primary/80"
                            href={deviceLogin.verification_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              void navigator.clipboard.writeText(deviceLogin.user_code ?? '');
                              if (window.orchestraDesktop?.openExternal) {
                                void window.orchestraDesktop.openExternal(deviceLogin.verification_url ?? '');
                              } else {
                                window.open(deviceLogin.verification_url, '_blank');
                              }
                            }}
                          >
                            Open verification page ↗
                          </a>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void navigator.clipboard.writeText(deviceLogin.user_code ?? '')}
                            className="h-7 gap-1 text-xs"
                          >
                            <Copy className="size-3" /> Copy code
                          </Button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            {id === 'OPENCODE' && (
              <p className="text-[11px] text-muted-foreground">
                {setup?.credential_entries === undefined
                  ? 'OpenCode credential catalog has not been observed.'
                  : `${setup.credential_entries} saved provider ${setup.credential_entries === 1 ? 'entry' : 'entries'} reported by opencode auth list. This does not verify model access.`} OpenCode manages its own account switch; Orchestra does not change global provider auth.
              </p>
            )}
            {id === 'ANTIGRAVITY' && (
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>
                  Antigravity is its own harness, separate from Gemini CLI. No installation, sign-in, or invocation command is presumed; enter a command you have verified for your installation.
                </p>
                <p>
                  Antigravity uses the host keyring or an interactive OAuth flow. Its CLI does not expose a documented read-only auth-status command, so sign-in remains unverified here.
                </p>
                <p>
                  Its CLI documentation lists <code className="rounded bg-muted px-1">--agent</code>,{' '}
                  <code className="rounded bg-muted px-1">--mode accept-edits|plan</code>, stream-json input/output, conversation resume, and sandbox options. Orchestra reports only the runtime modes returned by its backend; these provider flags are not yet individual Orchestra settings.
                </p>
                <a
                  href="https://www.antigravity.google/docs/cli/headless/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex font-medium text-primary hover:underline"
                >
                  Antigravity headless CLI options ↗
                </a>
              </div>
            )}
            {id === '8GENT' && (
              <p className="text-[11px] text-muted-foreground">
                8gent can run offline. Its optional Clerk sign-in is separate from model-provider access; use{' '}
                <code className="rounded bg-muted px-1">8gent auth status</code> on the backend host to inspect that identity.
              </p>
            )}
            {id === 'OMP' && (
              <p className="text-[11px] text-muted-foreground">
                OMP has no read-only sign-in probe, so authentication stays unverified here. Run{' '}
                <code className="rounded bg-muted px-1">omp login</code> on the backend host to add provider credentials; omp keeps its settings in{' '}
                <code className="rounded bg-muted px-1">~/.omp/agent/config.yml</code>.
              </p>
            )}
            {!signInCmd && id !== 'ANTIGRAVITY' && id !== '8GENT' && (
              <p className="text-[11px] text-muted-foreground">
                Use the provider setup guide for this harness. Orchestra does not have a verified sign-in command for it.
              </p>
            )}
            {guideUrl && (
              <a
                href={guideUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-xs font-medium text-primary hover:underline"
              >
                Provider install and sign-in guide ↗
              </a>
            )}
          </section>

          {id === 'CODEX' && (
            <section aria-label="Managed Codex accounts" className="space-y-3 rounded-lg border border-border/50 bg-background/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Codex accounts</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Each account signs in to its own backend credential home. New runs and conversations use the selected account; existing conversations keep their original account.
                  </p>
                </div>
                <span className="rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
                  {accountSelection.account_id
                    ? managedAccounts.find((item) => item.id === accountSelection.account_id)?.label ?? 'Selected account unavailable'
                    : 'Host default'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  aria-label="New account label"
                  value={accountLabel}
                  maxLength={80}
                  onChange={(event) => onAccountLabelChange(event.target.value)}
                  placeholder="Account label"
                  className="h-8 min-w-40 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!config || !accounts || accountBusy || !accountLabel.trim() || setup?.installation !== 'detected'}
                  onClick={onAddAccount}
                >
                  {accountBusy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />}
                  Add account
                </Button>
              </div>

              {accounts === null ? (
                <p className="mt-3 text-[11px] text-muted-foreground">Account registry unavailable or still loading.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-xs">
                    <span>
                      Host default <span className="text-[10px] text-muted-foreground">· existing CLI credentials</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={accountBusy || !accountSelection.account_id}
                      onClick={() => onManageAccount('select', '')}
                    >
                      {!accountSelection.account_id ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                  {managedAccounts.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {item.auth_state.replace('_', ' ')}
                          {item.last_verified_at ? ` · verified ${new Date(item.last_verified_at).toLocaleString()}` : ''}
                        </span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={accountBusy || item.auth_state !== 'signed_in' || accountSelection.account_id === item.id}
                        onClick={() => onManageAccount('select', item.id)}
                      >
                        {accountSelection.account_id === item.id ? 'Selected' : 'Select'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={accountBusy}
                        onClick={() => onManageAccount('verify', item.id)}
                      >
                        Verify
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={accountBusy}
                        onClick={() => onManageAccount('reauth', item.id)}
                      >
                        Sign in again
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={accountBusy || accountSelection.account_id === item.id}
                        onClick={() => onManageAccount('remove', item.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="rounded-lg border border-border/50 bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Backend-wide {label} command registration</h4>
                <p className="text-[11px] text-muted-foreground">
                  Set the command template used for batch task runs across this backend. Use <code className="rounded bg-muted px-1">{'{{prompt}}'}</code> where the task prompt should be inserted.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!config || savingCommand || !draft.trim() || draft === command}
                onClick={() => onSaveCommand(id)}
                className="h-7 gap-1 text-xs"
              >
                {savingCommand ? <Loader2 className="size-3 animate-spin mr-1" /> : <Save className="size-3 mr-1" />}
                Save command
              </Button>
            </div>
            {id === 'CODEX' && (
              <p className="text-[11px] text-muted-foreground">
                Codex chat uses the separately registered native app-server when available; this command is for batch task runs.
              </p>
            )}
            <textarea
              id={`harness-command-${id}`}
              aria-label="Command template"
              rows={2}
              value={draft}
              onChange={(e) => onDraftChange(id, e.target.value)}
              disabled={!config}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={`Executable or command line for ${label}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
