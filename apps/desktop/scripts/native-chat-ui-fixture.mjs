// Owned, account-isolated backend for the collaborative-browser native chat audit.
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { fixtureEnvironment } from './fixture-environment.mjs'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const root = path.join(os.tmpdir(), 'orchestra-native-chat-ui-fixture')
const server = net.createServer()
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4010, '127.0.0.1', () => server.close(resolve)) })
for (const directory of ['home', 'appdata', 'localappdata', 'tmp', 'project', 'state']) await mkdir(path.join(root, directory), { recursive: true })
await writeFile(path.join(root, 'WORKFLOW.md'), 'Protocol fixture only. No scheduled task execution.\n')
const env = fixtureEnvironment(root)
Object.assign(env, {
  HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
  TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), CODEX_HOME: path.join(root, 'home', '.codex'), CLAUDE_CONFIG_DIR: path.join(root, 'home', '.claude'),
  XDG_CONFIG_HOME: path.join(root, 'home', '.config'), XDG_DATA_HOME: path.join(root, 'home', '.local'), XDG_CACHE_HOME: path.join(root, 'home', '.cache'),
  ORCHESTRA_SERVER_HOST: '127.0.0.1', ORCHESTRA_SERVER_PORT: '4010', ORCHESTRA_API_TOKEN: 'dev-token',
  ORCHESTRA_WORKSPACE_ROOT: path.join(root, 'state'), ORCHESTRA_PROJECT_ROOTS: path.join(root, 'project'),
  ORCHESTRA_WORKFLOW_FILE: path.join(root, 'WORKFLOW.md'), ORCHESTRA_TRACKER_TYPE: 'sqlite', ORCHESTRA_TELEMETRY_PROVIDERS: 'none',
  ORCHESTRA_AGENT_COMMAND_CODEX: `"${process.execPath}" "${path.join(repo, 'packages/test-fixtures/ade/native-chat-appserver.cjs')}"`,
  ORCHESTRA_NATIVE_COMMAND_CODEX: `"${process.execPath}" "${path.join(repo, 'packages/test-fixtures/ade/native-chat-appserver.cjs')}"`,
})
const child = spawn(path.join(repo, 'apps/backend', process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad'), [], { cwd: root, env, stdio: 'inherit', windowsHide: true })
const stop = () => child.kill()
process.on('SIGINT', stop); process.on('SIGTERM', stop)
child.on('exit', code => process.exit(code ?? 0))
console.log(JSON.stringify({ fixture: true, root, port: 4010, ownedPid: child.pid, signedInProviderUsed: false }))
