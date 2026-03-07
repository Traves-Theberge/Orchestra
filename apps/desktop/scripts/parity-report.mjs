import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const desktopRoot = process.cwd()
const repoRoot = path.resolve(desktopRoot, '..', '..')
const backendRoot = path.resolve(repoRoot, 'apps', 'backend')
const reportsDir = path.resolve(desktopRoot, 'reports')
const requirementsPath = path.resolve(desktopRoot, 'parity-requirements.json')

const checks = [
  {
    id: 'desktop_tests',
    command: 'npm',
    args: ['run', 'test'],
    cwd: desktopRoot,
  },
  {
    id: 'renderer_boot_smoke',
    command: 'npm',
    args: ['run', 'test:smoke-renderer'],
    cwd: desktopRoot,
  },
  {
    id: 'desktop_typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
    cwd: desktopRoot,
  },
  {
    id: 'desktop_build',
    command: 'npm',
    args: ['run', 'build'],
    cwd: desktopRoot,
  },
  {
    id: 'backend_tests',
    command: 'go',
    args: ['test', './...'],
    cwd: backendRoot,
  },
  {
    id: 'smoke_go_open_host',
    command: 'npm',
    args: ['run', 'smoke:ops:go'],
    cwd: desktopRoot,
  },
  {
    id: 'smoke_go_auth_host',
    command: 'npm',
    args: ['run', 'smoke:ops:go:auth'],
    cwd: desktopRoot,
  },
]

const requiredCheckIds = checks.map((check) => check.id)

const requiredMarkersByCheck = {
  renderer_boot_smoke: ['[degraded]', 'DEGRADED_ASSERTION:sse_disconnect_reconnect_lifecycle'],
  smoke_go_open_host: [
    'DEGRADED_ASSERTION:issue_not_found',
    'DEGRADED_ASSERTION:route_not_found',
    'DEGRADED_ASSERTION:method_not_allowed',
    'DEGRADED_ASSERTION:unsupported_media_type',
  ],
  smoke_go_auth_host: [
    'DEGRADED_ASSERTION:unauthorized_refresh',
    'DEGRADED_ASSERTION:unauthorized_migrate',
  ],
}

function runCheck(check) {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()

  return new Promise((resolve) => {
    const child = spawn(check.command, check.args, {
      cwd: check.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      process.stderr.write(text)
    })

    child.on('exit', (code, signal) => {
      const finishedMs = Date.now()
      resolve({
        id: check.id,
        command: `${check.command} ${check.args.join(' ')}`,
        cwd: check.cwd,
        started_at: startedAt,
        duration_ms: finishedMs - startedMs,
        exit_code: code,
        signal,
        status: code === 0 ? 'passed' : 'failed',
        stdout_tail: stdout.slice(-8000),
        stderr_tail: stderr.slice(-4000),
      })
    })
  })
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Desktop/Backend Parity Report')
  lines.push('')
  lines.push(`- Generated: ${report.generated_at}`)
  lines.push(`- Overall: ${report.overall_status}`)
  lines.push(`- Passed: ${report.summary.passed}`)
  lines.push(`- Failed: ${report.summary.failed}`)
  lines.push(`- Skipped: ${report.summary.skipped}`)
  lines.push('')
  lines.push('| Check | Status | Marker Status | Duration (ms) | Exit |')
  lines.push('|---|---|---|---:|---:|')
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.marker_status ?? ''} | ${check.duration_ms} | ${check.exit_code ?? ''} |`)
  }
  lines.push('')
  lines.push('| Workflow Gate | Status | Required Checks |')
  lines.push('|---|---|---|')
  for (const workflow of report.workflow_gates) {
    lines.push(`| ${workflow.id} | ${workflow.status} | ${workflow.required_check_ids.join(', ')} |`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function timestampTag(isoString) {
  return isoString.replace(/[:]/g, '-').replace(/[.]/g, '_')
}

function createSkippedCheck(check, reason) {
  return {
    id: check.id,
    command: `${check.command} ${check.args.join(' ')}`,
    cwd: check.cwd,
    started_at: new Date().toISOString(),
    duration_ms: 0,
    exit_code: null,
    signal: null,
    status: 'skipped',
    skip_reason: reason,
    stdout_tail: '',
    stderr_tail: '',
  }
}

async function main() {
  await mkdir(reportsDir, { recursive: true })

  const requirementsRaw = await readFile(requirementsPath, 'utf-8')
  const requirements = JSON.parse(requirementsRaw)
  const requiredWorkflows = Array.isArray(requirements?.required_workflows) ? requirements.required_workflows : []

  const results = []
  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index]
    // eslint-disable-next-line no-await-in-loop
    const result = await runCheck(check)
    results.push(result)
    if (result.status !== 'passed') {
      for (let rest = index + 1; rest < checks.length; rest += 1) {
        results.push(createSkippedCheck(checks[rest], `blocked by ${result.id}`))
      }
      break
    }
  }

  if (results.length === 0) {
    for (const check of checks) {
      results.push(createSkippedCheck(check, 'no checks executed'))
    }
  }

  const seenIds = new Set(results.map((result) => result.id))
  for (const id of requiredCheckIds) {
    if (!seenIds.has(id)) {
      const check = checks.find((entry) => entry.id === id)
      if (check) {
        results.push(createSkippedCheck(check, 'missing from execution set'))
      }
    }
  }

  for (const result of results) {
    const requiredMarkers = requiredMarkersByCheck[result.id] ?? []
    const output = `${result.stdout_tail}\n${result.stderr_tail}`
    const missingMarkers = requiredMarkers.filter((marker) => !output.includes(marker))
    if (missingMarkers.length > 0) {
      result.missing_markers = missingMarkers
      result.status = 'failed'
      result.marker_status = 'failed'
      if (!result.marker_failure_reason) {
        result.marker_failure_reason = `missing markers: ${missingMarkers.join(', ')}`
      }
    } else if (requiredMarkers.length > 0) {
      result.marker_status = 'passed'
    }
  }

  const passed = results.filter((result) => result.status === 'passed').length
  const failed = results.filter((result) => result.status === 'failed').length
  const skipped = results.filter((result) => result.status === 'skipped').length
  const markerFailures = results.filter((result) => result.marker_status === 'failed').length

  const checkStatusById = new Map(results.map((result) => [result.id, result.status]))
  const workflowGates = requiredWorkflows.map((workflow) => {
    const checkIds = Array.isArray(workflow?.required_check_ids) ? workflow.required_check_ids : []
    const statuses = checkIds.map((id) => checkStatusById.get(id) || 'missing')
    const status = statuses.every((entry) => entry === 'passed') ? 'passed' : 'failed'
    return {
      id: typeof workflow?.id === 'string' ? workflow.id : 'unnamed-workflow',
      description: typeof workflow?.description === 'string' ? workflow.description : '',
      required_check_ids: checkIds,
      check_statuses: statuses,
      status,
    }
  })
  const failedWorkflowGates = workflowGates.filter((workflow) => workflow.status !== 'passed').length

  const overallStatus = failed === 0 && skipped === 0 && failedWorkflowGates === 0 ? 'passed' : 'failed'
  const report = {
    generated_at: new Date().toISOString(),
    overall_status: overallStatus,
    required_check_ids: requiredCheckIds,
    required_workflow_ids: workflowGates.map((workflow) => workflow.id),
    summary: {
      passed,
      failed,
      skipped,
      total: results.length,
      failed_workflow_gates: failedWorkflowGates,
      marker_failures: markerFailures,
    },
    checks: results,
    workflow_gates: workflowGates,
  }

  const tag = timestampTag(report.generated_at)
  const jsonPath = path.resolve(reportsDir, 'parity-latest.json')
  const markdownPath = path.resolve(reportsDir, 'parity-latest.md')
  const jsonHistoryPath = path.resolve(reportsDir, `parity-${tag}.json`)
  const markdownHistoryPath = path.resolve(reportsDir, `parity-${tag}.md`)
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8')
  await writeFile(markdownPath, renderMarkdown(report), 'utf-8')
  await writeFile(jsonHistoryPath, JSON.stringify(report, null, 2), 'utf-8')
  await writeFile(markdownHistoryPath, renderMarkdown(report), 'utf-8')

  console.log(`Parity report written: ${jsonPath}`)
  console.log(`Parity report written: ${markdownPath}`)
  console.log(`Parity report written: ${jsonHistoryPath}`)
  console.log(`Parity report written: ${markdownHistoryPath}`)

  if (overallStatus !== 'passed') {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`Failed to generate parity report: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
