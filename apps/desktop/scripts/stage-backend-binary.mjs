import { access, copyFile, mkdir, chmod } from 'node:fs/promises'
import path from 'node:path'

function backendBinaryName() {
  return process.platform === 'win32' ? 'orchestrad.exe' : 'orchestrad'
}

function backendTargetKey() {
  return `${process.platform}-${process.arch}`
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveSourceBinary() {
  const binaryName = backendBinaryName()
  const override = process.env.ORCHESTRA_BACKEND_BIN
  const candidates = [
    override,
    path.resolve('..', 'backend', binaryName),
    path.resolve('..', 'backend', 'dist', 'orchestra', binaryName),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `Unable to locate ${binaryName}. Build it first (for example: "cd apps/backend && go build -o ${binaryName} ./cmd/orchestrad").`,
  )
}

async function main() {
  const sourcePath = await resolveSourceBinary()
  const targetDir = path.resolve('resources', 'backend', backendTargetKey())
  const targetPath = path.join(targetDir, backendBinaryName())

  await mkdir(targetDir, { recursive: true })
  await copyFile(sourcePath, targetPath)
  if (process.platform !== 'win32') {
    await chmod(targetPath, 0o755)
  }

  console.log(`Staged backend binary: ${sourcePath} -> ${targetPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
