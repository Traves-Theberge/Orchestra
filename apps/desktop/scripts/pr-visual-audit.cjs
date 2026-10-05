// Read-only renderer fixtures for the isolated production Electron smoke.
// This is native layout evidence, not a hosted GitHub/API reliability canary.
const fs = require('node:fs')
const path = require('node:path')

const visualFixture = {
  pr: {
    number: 9001, title: 'feat: coordinate issue-backed worktrees', body: 'A single workspace agent coordinates project tasks and preserves each worktree identity.\n\nVisual audit fixture — no hosted GitHub operation is performed.',
    state: 'closed', merged_at: '2026-10-04T18:00:00Z', draft: false,
    html_url: 'https://github.com/visual-fixture/orchestra/pull/9001', diff_url: 'https://github.com/visual-fixture/orchestra/pull/9001.diff',
    head: { ref: 'feat/worktree-control', label: 'visual-fixture:feat/worktree-control', sha: 'a'.repeat(40) },
    base: { ref: 'main', label: 'visual-fixture:main', sha: 'b'.repeat(40) },
    user: { login: 'audit-author', avatar_url: '' }, created_at: '2026-10-04T16:00:00Z',
  },
  diff: 'diff --git a/src/orchestrator.ts b/src/orchestrator.ts\n--- a/src/orchestrator.ts\n+++ b/src/orchestrator.ts\n@@ -1,2 +1,4 @@\n export function coordinate(task) {\n+  const workspace = task.workspaceId\n+  return dispatch(workspace, task.issueId)\n }\ndiff --git a/public/worktree.png b/public/worktree.png\nBinary files a/public/worktree.png and b/public/worktree.png differ',
  reviews: [{ id: 10, user: { login: 'audit-reviewer' }, body: 'Workspace identity is preserved across dispatch.', state: 'APPROVED', submitted_at: '2026-10-04T17:30:00Z' }],
  comments: [
    { id: 100, body: 'Keep this dispatch anchored to the issue-backed worktree.', path: 'src/orchestrator.ts', line: 3, original_line: 3, user: { login: 'audit-reviewer' }, created_at: '2026-10-04T17:00:00Z', html_url: 'https://github.com/visual-fixture/orchestra/pull/9001#discussion_r100' },
    { id: 101, in_reply_to_id: 100, body: 'Confirmed: workspace and issue identities travel together.', path: 'src/orchestrator.ts', line: 3, user: { login: 'audit-author' }, created_at: '2026-10-04T17:10:00Z', html_url: 'https://github.com/visual-fixture/orchestra/pull/9001#discussion_r101' },
  ],
}

async function installPRVisualFixture(win) {
  await win.webContents.executeJavaScript(`(() => {
    const fixture = ${JSON.stringify(visualFixture)}
    const originalFetch = window.fetch.bind(window)
    const projects = new Set()
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString(), location.href)
      const method = (init?.method ?? input.method ?? 'GET').toUpperCase()
      if (method === 'GET' && url.pathname === '/api/v1/projects') {
        const response = await originalFetch(input, init)
        if (!response.ok) return response
        const payload = await response.json()
        // The production API returns null before the first project exists;
        // preserve that legitimate empty-catalog response for the client.
        if (payload === null) return json(null)
        const rows = Array.isArray(payload) ? payload : payload.projects
        if (!Array.isArray(rows)) throw new Error('Unexpected project catalog in visual audit')
        const decorated = rows.map(project => {
          if (!project.root_path?.includes('orchestra-electron-smoke-')) return project
          projects.add(project.id)
          return { ...project, github_owner: 'visual-fixture', github_repo: 'orchestra' }
        })
        return json(Array.isArray(payload) ? decorated : { ...payload, projects: decorated })
      }
      const match = url.pathname.match(/^\\/api\\/v1\\/projects\\/([^/]+)\\/github\\/(.*)$/)
      if (!match || !projects.has(decodeURIComponent(match[1]))) return originalFetch(input, init)
      if (method !== 'GET') throw new Error('GitHub mutation forbidden in read-only PR visual fixture')
      const resource = match[2]
      if (resource === 'pulls') return json({ pulls: [fixture.pr], has_more: false })
      if (resource === 'issues') return json({ issues: [], has_more: false })
      if (resource === 'pulls/9001/snapshot') return json({ pr: fixture.pr, diff: fixture.diff })
      if (resource === 'pulls/9001/reviews') return json(fixture.reviews)
      if (resource === 'pulls/9001/comments') return json(fixture.comments)
      throw new Error('Unimplemented PR visual read: ' + resource)
    }
  })()`)
}

async function auditPRVisual(win, reportDirectory) {
  const run = code => win.webContents.executeJavaScript(`(async () => {
    const wait = async predicate => {
      const deadline = Date.now() + 10000
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      if (!predicate()) throw new Error('PR visual audit timed out')
    }
    const button = (name, scope = document) => [...scope.querySelectorAll('button')].find(element => element.textContent.trim() === name || element.getAttribute('aria-label') === name)
    ${code}
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter(element => element.getBoundingClientRect().width > 0)
    if (alerts.some(element => /failed to fetch section data|cannot read properties|section failed/i.test(element.textContent))) throw new Error('Section error during PR visual audit: ' + alerts.map(element => element.textContent).join('; '))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })()`)
  await run(`
    button('PRs').click()
    const row = () => [...document.querySelectorAll('button')].find(element => element.textContent.includes(${JSON.stringify(visualFixture.pr.title)}))
    await wait(row)
    row().click()
    await wait(() => document.querySelector('[role="tablist"][aria-label="Pull request"]'))
    await wait(() => document.body.textContent.includes('Reviewing commit aaaaaaaaaaaa'))
    const panel = document.querySelector('[role="tablist"][aria-label="Pull request"]').parentElement
    for (const name of ['Approve', 'Request changes', 'Merge']) {
      if (!button(name, panel)?.disabled) throw new Error('Merged visual fixture permits ' + name)
    }
    button('Summary', panel).click()
    await wait(() => panel.textContent.includes('Review conversations'))
    if (!panel.textContent.includes('Confirmed: workspace and issue identities travel together.')) throw new Error('Conversation reply missing')
  `)
  fs.mkdirSync(reportDirectory, { recursive: true })
  const capture = async name => {
    const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    if (screenshot.isEmpty()) throw new Error('Empty PR visual screenshot')
    fs.writeFileSync(path.join(reportDirectory, name), screenshot.toPNG())
  }
  await capture('pr-visual-summary.png')
  await run(`
    const panel = document.querySelector('[role="tablist"][aria-label="Pull request"]').parentElement
    button('Timeline', panel).click()
    await wait(() => panel.textContent.includes('pull request merged'))
    if (!panel.textContent.includes('Workspace identity is preserved across dispatch.')) throw new Error('Actual review event missing')
  `)
  await capture('pr-visual-timeline.png')
  await run(`
    const panel = document.querySelector('[role="tablist"][aria-label="Pull request"]').parentElement
    button('Code', panel).click()
    await wait(() => panel.textContent.includes('Binary file changed. Text diff unavailable.'))
    if (!panel.textContent.includes('Keep this dispatch anchored to the issue-backed worktree.')) throw new Error('File conversation missing')
  `)
  await capture('pr-visual-code.png')
  win.setSize(1280, 800)
  await run(`
    const tools = document.querySelector('[aria-label="Workspace tools"]')
    const right = tools.getBoundingClientRect().right
    for (const name of ['Approve', 'Request changes', 'Merge']) {
      const bounds = button(name, tools).getBoundingClientRect()
      if (bounds.right > right + 1 || bounds.width <= 0) throw new Error('Narrow PR action clipped: ' + name)
    }
  `)
  await capture('pr-visual-code-narrow.png')
  return { fixture: 'intercepted read-only merged PR', tabs: ['Summary', 'Timeline', 'Code'], immutableHead: visualFixture.pr.head.sha, hostedGitHubVerified: false }
}

module.exports = { installPRVisualFixture, auditPRVisual, visualFixture }
