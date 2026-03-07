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
  const entries = await readdir(reportsDir)
  const historyJson = entries
    .filter((entry) => /^parity-\d{4}-\d{2}-\d{2}T.*\.json$/.test(entry))
    .sort((a, b) => b.localeCompare(a))

  if (historyJson.length < 2) {
    console.error('Release readiness failed: need at least two timestamped parity JSON reports.')
    process.exit(1)
  }

  const latestTwo = historyJson.slice(0, 2)
  const latestTwoPaths = latestTwo.map((name) => path.resolve(reportsDir, name))
  const reports = await Promise.all(latestTwoPaths.map(loadReport))

  const failed = []
  for (let i = 0; i < reports.length; i += 1) {
    const report = reports[i]
    if (!isPassingReport(report)) {
      failed.push({
        file: latestTwo[i],
        overall: report?.overall_status,
        summary: normalizeSummary(report),
      })
    }
  }

  if (failed.length > 0) {
    console.error('Release readiness failed: latest two parity reports are not both fully passing.')
    for (const entry of failed) {
      console.error(`- ${entry.file}: overall=${entry.overall}, failed=${entry.summary.failed}, skipped=${entry.summary.skipped}, failed_workflow_gates=${entry.summary.failedWorkflowGates}, marker_failures=${entry.summary.markerFailures}`)
    }
    process.exit(1)
  }

  console.log('Release readiness passed: latest two timestamped parity reports are fully passing.')
  for (let i = 0; i < reports.length; i += 1) {
    console.log(`- ${latestTwo[i]} (${reports[i]?.generated_at ?? 'unknown timestamp'})`)
  }
}

main().catch((error) => {
  console.error(`Release readiness failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
