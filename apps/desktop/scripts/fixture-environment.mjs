import path from 'node:path'

// Fixtures inherit operating-system launch prerequisites, never account settings
// or credentials. A denylist cannot anticipate every provider's secret names.
export function fixtureEnvironment(root, inherited = process.env) {
  const env = {}
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'SYSTEMDRIVE'])
  for (const [key, value] of Object.entries(inherited)) {
    if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value
  }
  return Object.assign(env, {
    HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
    CODEX_HOME: path.join(root, 'home', '.codex'), CLAUDE_CONFIG_DIR: path.join(root, 'home', '.claude'),
    XDG_CONFIG_HOME: path.join(root, 'home', '.config'), XDG_DATA_HOME: path.join(root, 'home', '.local', 'share'),
    XDG_CACHE_HOME: path.join(root, 'home', '.cache'), GH_CONFIG_DIR: path.join(root, 'home', '.config', 'gh'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'home', '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
  })
}
