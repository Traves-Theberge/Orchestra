export type HarnessDefinition = { id: string; label: string; helpUrl?: string }

// Known app harnesses are choices to configure, not claims that the executable
// is installed or authenticated. The backend's live registry remains the source
// of truth for runnable providers.
export const KNOWN_HARNESSES: readonly HarnessDefinition[] = [
  { id: 'CODEX', label: 'Codex', helpUrl: 'https://learn.chatgpt.com/docs/auth' },
  { id: 'ANTIGRAVITY', label: 'Antigravity', helpUrl: 'https://antigravity.google/docs/cli-overview' },
  { id: 'CLAUDE', label: 'Claude Code', helpUrl: 'https://code.claude.com/docs' },
  { id: 'OPENCODE', label: 'OpenCode', helpUrl: 'https://opencode.ai/docs/cli/' },
  { id: '8GENT', label: '8gent', helpUrl: 'https://github.com/8gi-foundation/8gent-code' },
  { id: 'OMP', label: 'OMP', helpUrl: 'https://omp.sh' },
]

// Commands are presented for the user to run on the backend host. Orchestra
// never executes these from a browser session or treats them as proof of auth.
export const HARNESS_SIGN_IN_COMMANDS: Readonly<Record<string, string>> = {
  CODEX: 'codex login',
  CLAUDE: 'claude auth login',
  OPENCODE: 'opencode auth login',
  OMP: 'omp login',
}

export function normalizeHarnessId(value: string): string {
  return value.trim().toUpperCase()
}

export function getRegisteredCommand(commands: Record<string, string>, harness: string): string {
  const key = Object.keys(commands).find((candidate) => normalizeHarnessId(candidate) === normalizeHarnessId(harness))
  return key ? commands[key] ?? '' : ''
}

export function getCommandKey(commands: Record<string, string>, harness: string): string {
  return Object.keys(commands).find((candidate) => normalizeHarnessId(candidate) === normalizeHarnessId(harness))
    ?? normalizeHarnessId(harness)
}

/**
 * The existing config endpoint merges non-empty command values. Send only the
 * edited key so stale UI state cannot overwrite another provider's command.
 */
export function buildCommandRegistrationPatch(
  commands: Record<string, string>,
  harness: string,
  command: string,
  defaultProvider: string,
): { commands: Record<string, string>; agent_provider: string } {
  return {
    commands: { [getCommandKey(commands, harness)]: command.trim() },
    agent_provider: defaultProvider,
  }
}

export function isHarnessRegistered(registered: readonly string[], harness: string): boolean {
  return registered.some((id) => normalizeHarnessId(id) === normalizeHarnessId(harness))
}
