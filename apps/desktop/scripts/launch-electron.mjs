import { spawn } from 'node:child_process'
import electron from 'electron'

// Electron treats even an empty ELECTRON_RUN_AS_NODE as Node mode on Windows.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, process.argv.slice(2), { env, stdio: 'inherit' })
child.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', code => { process.exitCode = code ?? 1 })
