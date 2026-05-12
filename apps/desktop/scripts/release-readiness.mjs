import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const desktopRoot = process.cwd()
const reportsDir = path.resolve(desktopRoot, 'reports')

function normalizeSummary(value) {
  const summary = value && typeof value === 'object' ? value.summary : null
  return {
    failed: Number(summary?.failed ?? 0),
    skipped: Number(summary?.skipped ?? 0),
    failedWorkflowGates: Number(summary?.failed_workflow_gates ?? 0),
    markerFailures: Number(summary?.marker_failures ?? 0),
  }
}

function isPassingReport(report) {
  const summary = normalizeSummary(report)
  return (
    report?.overall_status === 'passed' &&
    summary.failed === 0 &&
    summary.skipped === 0 &&
    summary.failedWorkflowGates === 0 &&
    summary.markerFailures === 0
  )
}

async function loadReport(filePath) {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

async function main() {
  let entries
  try {
    entries = await readdir(reportsDir)
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.log('Release readiness: no reports directory found — skipping (parity reporter is currently disabled).')
      return
    }
    throw err
  }
  const historyJson = entries
    .filter((entry) => /^parity-\d{4}-\d{2}-\d{2}T.*\.json$/.test(entry))
    .sort((a, b) => b.localeCompare(a))

  if (historyJson.length < 1) {
    console.log('Release readiness: no timestamped parity reports found — skipping.')
    return
  }

  const latest = historyJson.slice(0, 1)
  const latestPaths = latest.map((name) => path.resolve(reportsDir, name))
  const reports = await Promise.all(latestPaths.map(loadReport))

  const failed = []
  for (let i = 0; i < reports.length; i += 1) {
    const report = reports[i]
    if (!isPassingReport(report)) {
      failed.push({
        file: latest[i],
        overall: report?.overall_status,
        summary: normalizeSummary(report),
      })
    }
  }

  if (failed.length > 0) {
    console.error('Release readiness failed: latest parity report is not fully passing.')
    for (const entry of failed) {
      console.error(`- ${entry.file}: overall=${entry.overall}, failed=${entry.summary.failed}, skipped=${entry.summary.skipped}, failed_workflow_gates=${entry.summary.failedWorkflowGates}, marker_failures=${entry.summary.markerFailures}`)
    }
    process.exit(1)
  }

  console.log('Release readiness passed: latest timestamped parity report is fully passing.')
  for (let i = 0; i < reports.length; i += 1) {
    console.log(`- ${latest[i]} (${reports[i]?.generated_at ?? 'unknown timestamp'})`)
  }
}

main().catch((error) => {
  console.error(`Release readiness failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
