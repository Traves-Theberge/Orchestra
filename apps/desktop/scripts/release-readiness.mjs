import { readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateReport(report, revision, now = Date.now()) {
  if (report?.overall_status !== 'passed') throw new Error('report is not passed')
  for (const key of ['failed', 'skipped', 'failed_workflow_gates', 'marker_failures']) {
    if (report.summary?.[key] !== 0) throw new Error('summary.' + key + ' must explicitly be zero')
  }
  if (!Number.isInteger(report.summary?.passed) || report.summary.passed < 1) throw new Error('report has no passing scenarios')
  if (report.source_revision !== revision) throw new Error('report source_revision does not match the checkout')
  const generated = Date.parse(report.generated_at)
  if (!Number.isFinite(generated) || generated > now + 60_000 || now - generated > 24 * 60 * 60 * 1000) throw new Error('report timestamp is missing, stale or in the future')
}

export async function checkReadiness(reportsDir, revision) {
  const entries = await readdir(reportsDir)
  const latest = entries.filter(entry => /^parity-\d{4}-\d{2}-\d{2}T.*\.json$/.test(entry)).sort().at(-1)
  if (!latest) throw new Error('no timestamped parity reports found')
  const report = JSON.parse(await readFile(path.join(reportsDir, latest), 'utf8'))
  validateReport(report, revision)
  return latest
}

async function main() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const report = await checkReadiness(path.resolve('reports'), revision)
  console.log('Release readiness passed: ' + report + ' matches ' + revision)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Release readiness failed: ' + error.message)
    process.exitCode = 1
  })
}
