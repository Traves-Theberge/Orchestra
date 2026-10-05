// Real disposable Git/API/preload/editor observations. No provider turn is sent.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')

function ownedPath(root, target) {
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture target is outside disposable root')
  return target
}

async function auditMultiWorktree(win, fixture) {
  let auditStep = 0
  const api = (method, route, body) => win.webContents.executeJavaScript(`(async () => {
    const config = await window.orchestraDesktop.getBackendConfig()
    const response = await fetch(config.baseUrl + ${JSON.stringify(route)}, { method: ${JSON.stringify(method)}, headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''} })
    if (!response.ok) throw new Error('Worktree audit API returned ' + response.status + ' for ' + ${JSON.stringify(route)} + ': ' + await response.text())
    return response.json()
  })()`)
  const run = code => {
    const step = ++auditStep
    const label = code.trim().replace(/\s+/g, ' ').slice(0, 100)
    return win.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, name, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75))
      if (!predicate()) throw new Error('Multi-worktree audit timed out: ' + name)
    }
    const findControl = name => {
      const matches = [...document.querySelectorAll('button, [role="button"]')].filter(element => element.getAttribute('aria-label') === name || element.textContent.trim() === name)
      return matches.find(element => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 }) || matches[0]
    }
    const control = name => findControl(name)
    const requiredControl = name => {
      const target = findControl(name)
      if (!target) throw new Error('Required control not found: ' + name)
      return target
    }
    const clickControl = name => requiredControl(name).click()
    const visible = element => {
      if (!element || element.closest('[hidden]')) return false
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const workspaceTablist = () => [...document.querySelectorAll('[role="tablist"][aria-label="Project workspace"]')].find(visible)
    const workspaceTab = name => [...(workspaceTablist()?.querySelectorAll('[role="tab"]') ?? [])].find(tab => tab.textContent.trim() === name && visible(tab))
    const selectedWorkspaceCard = () => [...document.querySelectorAll('[role="button"][aria-pressed="true"][aria-label^="Open Workspace audit workspace "]')].find(visible)
    const editorGroup = name => [...(tools()?.querySelectorAll('[data-group-id]') ?? [])].find(group => visible(group) && [...group.querySelectorAll('button[title]')].some(tab => tab.title === name && tab.getAttribute('data-active-tab') === 'true'))
    const archiveCatalog = count => {
      const label = 'Archived conversations (' + count + ')'
      return [...document.querySelectorAll('button')].find(button => {
        const bounds = button.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0 && [...button.querySelectorAll('span')].some(span => span.textContent.trim() === label)
      })
    }
    const archivedConversation = title => [...document.querySelectorAll('button[aria-label]')].find(button => button.getAttribute('aria-label') === 'Open archived conversation ' + title)
    const tools = () => {
      const matches = [...document.querySelectorAll('[aria-label="Workspace tools"]')]
      return matches.find(visible)
    }
    const fileSurface = () => [...document.querySelectorAll('[aria-label="Workspace files view"], [aria-label="Workspace file sidebar"]')].find(visible)
    const fileRow = name => [...(fileSurface()?.querySelectorAll('[role="treeitem"]') ?? [])].find(element => element.textContent.trim() === name && visible(element))
    const editorTab = name => [...(tools()?.querySelectorAll('[data-group-id] button[title]') ?? [])].find(tab => tab.title === name && visible(tab))
    const editorText = () => [...(tools()?.querySelectorAll('[data-group-id]') ?? [])]
      .filter(group => visible(group) && group.querySelector('[data-active-tab="true"]'))
      .flatMap(group => [...group.querySelectorAll('.monaco-editor')].filter(visible))
      .map(editor => editor.querySelector('.view-lines')?.textContent ?? '')
      .join('\\n')
    const files = async () => {
      await wait(() => selectedWorkspaceCard() && workspaceTablist() && workspaceTab('Files & terminals'), 'selected workspace context and its active header navigation')
      const showTools = [...document.querySelectorAll('button[aria-label="Show workspace tools"]')].find(visible)
      if (showTools) showTools.click();
      const tablist = workspaceTablist()
      if (!tablist) throw new Error('The active workspace header navigation is not visible')
      const filesTab = workspaceTab('Files & terminals')
      if (!filesTab) throw new Error('Visible Files & terminals workspace tab is missing; nav=' + tablist.outerHTML.slice(0, 500))
      filesTab.click()
      await wait(() => filesTab.getAttribute('aria-selected') === 'true' && workspaceTab('Tasks')?.getAttribute('aria-selected') === 'false', 'active workspace files tab and Tasks tab hidden')
      const fileToggle = () => [...(tools()?.querySelectorAll('button[aria-label="Toggle workspace files"]') ?? [])].find(visible)
      await wait(() => fileToggle(), 'files tool surface')
      await wait(() => tools() && !tools().hidden, 'workspace tools pane visible for selected workspace')
      if (fileToggle().getAttribute('aria-pressed') !== 'true') fileToggle().click()
      await wait(() => fileSurface(), 'file viewer surface')
    }
    try { ${code} } catch (error) { throw new Error('Audit step #' + ${step} + ' [' + ${JSON.stringify(label)} + '] failed: ' + (error?.stack || error?.message || String(error))) }
  })()`)
  }
  const catalog = await api('GET', '/api/v1/projects')
  const projects = Array.isArray(catalog) ? catalog : catalog.projects
  const project = projects.find(row => row.name === 'Workspace audit')
  if (!project) throw new Error('Multi-worktree fixture project missing')
  const root = ownedPath(fixture, project.root_path)
  const git = (...args) => execFileSync('git', args, { cwd: root, env: process.env, timeout: 10000, stdio: 'pipe' })
  const rootShared = '// ROOT_SHARED_SENTINEL\nexport const scope = "root"\n'
  fs.writeFileSync(path.join(root, 'shared.ts'), rootShared)
  git('add', '--', 'shared.ts')
  git('-c', 'user.name=Smoke Fixture', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'Add isolated smoke sentinel')
  const prefix = '/api/v1/projects/' + encodeURIComponent(project.id)
  // Observe the real dialog's single submission without replacing its transport.
  const dropdownLayout = await run(`
    clickControl('Create worktree in Workspace audit')
    await wait(() => document.querySelector('[role="dialog"] #worktree-source'), 'real worktree dialog')
    const dialog = document.querySelector('[role="dialog"]')
    const projectDropdown = dialog.querySelector('#worktree-project button')
    projectDropdown.click()
    await wait(() => dialog.querySelector('[role="listbox"][aria-label="Project"] [role="option"]'), 'project dropdown')
    const projectMenu = dialog.querySelector('[role="listbox"][aria-label="Project"]')
    const projectBounds = projectMenu.getBoundingClientRect()
    if (projectBounds.left < 0 || projectBounds.top < 0 || projectBounds.right > innerWidth || projectBounds.bottom > innerHeight) throw new Error('Project dropdown is clipped by viewport')
    const projectOption = [...projectMenu.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === 'Workspace audit')
    if (!projectOption) throw new Error('Current project is absent from project options')
    projectOption.click()
    const tablist = dialog.querySelector('#worktree-source-tabs')
    for (const name of ['GitHub', 'Branch', 'Name', 'Smart']) {
      const tab = [...tablist.querySelectorAll('[role="tab"]')].find(element => element.textContent.trim().endsWith(name))
      if (!tab) throw new Error('Worktree source mode missing: ' + name)
      tab.click()
      await wait(() => tab.getAttribute('aria-selected') === 'true' && dialog.isConnected, name + ' source mode')
      if (document.body.innerText.includes('failed to render')) throw new Error('Source mode ' + name + ' broke the renderer')
      if (name === 'Branch') {
        const source = dialog.querySelector('#worktree-source button')
        if (!source) throw new Error('Source branch custom dropdown is missing')
        source.click()
        await wait(() => dialog.querySelector('[role="listbox"][aria-label="Source branch"] [role="option"]'), 'source branch dropdown')
        const sourceMenu = dialog.querySelector('[role="listbox"][aria-label="Source branch"]')
        const sourceBounds = sourceMenu.getBoundingClientRect()
        if (sourceBounds.left < 0 || sourceBounds.top < 0 || sourceBounds.right > innerWidth || sourceBounds.bottom > innerHeight) throw new Error('Source branch dropdown is clipped by viewport')
        const sourceOption = [...sourceMenu.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() && !element.textContent.includes('Choose source branch'))
        if (!sourceOption) throw new Error('No observed source branch option is available')
        sourceOption.click()
      }
    }
    const setInput = (id, value) => {
      const input = dialog.querySelector('#' + id)
      if (!input) throw new Error('Worktree field missing: ' + id)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setInput('worktree-source', 'smoke-child')
    clickControl('Advanced')
    await wait(() => dialog.querySelector('#worktree-branch'), 'advanced branch field')
    setInput('worktree-branch', 'smoke/child')
    const dropdownTrigger = id => dialog.querySelector('#' + id + ' button')
    const baseDropdown = dropdownTrigger('worktree-base')
    const selectedBase = baseDropdown.textContent.trim()
    if (!selectedBase || selectedBase === 'Choose base branch') throw new Error('Worktree dialog has no observed base branch')
    baseDropdown.click()
    await wait(() => dialog.querySelector('[role="listbox"][aria-label="Base branch"] [role="option"]'), 'base branch dropdown option')
    const baseMenu = dialog.querySelector('[role="listbox"][aria-label="Base branch"]')
    const baseOption = [...baseMenu.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === selectedBase)
    if (!baseOption) throw new Error('Selected base branch is absent from the observed options')
    const menuBounds = baseMenu.getBoundingClientRect()
    if (menuBounds.left < 0 || menuBounds.top < 0 || menuBounds.right > innerWidth || menuBounds.bottom > innerHeight) throw new Error('Base branch dropdown is clipped by viewport')
    return { projectDropdownWithinViewport: true, sourceBranchDropdownWithinViewport: true, base: selectedBase, baseDropdownBounds: { left: menuBounds.left, top: menuBounds.top, right: menuBounds.right, bottom: menuBounds.bottom }, baseDropdownWithinViewport: true }
  `)
  const dialogDropdownScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  if (dialogDropdownScreenshot.isEmpty()) throw new Error('Electron returned an empty worktree dialog screenshot')
  const reports = path.join(__dirname, '..', 'reports')
  fs.mkdirSync(reports, { recursive: true })
  fs.writeFileSync(path.join(fixture, 'worktree-dialog.png'), dialogDropdownScreenshot.toPNG())
  fs.writeFileSync(path.join(reports, 'electron-smoke-worktree-dialog.png'), dialogDropdownScreenshot.toPNG())
  const dialogLayout = await run(`
    const dialog = document.querySelector('[role="dialog"]')
    const baseOption = dialog.querySelector('[role="listbox"][aria-label="Base branch"] [role="option"][aria-selected="true"]')
    if (!baseOption) throw new Error('Base branch dropdown selection disappeared before dialog submission')
    baseOption.click()
    const dropdownTrigger = id => dialog.querySelector('#' + id + ' button')
    dropdownTrigger('worktree-agent').click()
    await wait(() => [...dialog.querySelectorAll('[role="listbox"][aria-label="Agent"] [role="option"]')].some(element => element.textContent.trim().startsWith('None')), 'workspace-only dropdown option')
    const agentOption = [...dialog.querySelectorAll('[role="listbox"][aria-label="Agent"] [role="option"]')].find(element => element.textContent.trim().startsWith('None'))
    agentOption.click()
    const customDropdowns = ['Base branch', 'Agent']
    const taskTrigger = dropdownTrigger('worktree-task')
    if (taskTrigger) {
      taskTrigger.click()
      await wait(() => dialog.querySelector('[role="listbox"][aria-label="Link an existing task"]'), 'task-link dropdown')
      const taskMenu = dialog.querySelector('[role="listbox"][aria-label="Link an existing task"]')
      const taskBounds = taskMenu.getBoundingClientRect()
      if (taskBounds.left < 0 || taskBounds.top < 0 || taskBounds.right > innerWidth || taskBounds.bottom > innerHeight) throw new Error('Task dropdown is clipped by viewport')
      const taskOption = [...taskMenu.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === 'No task')
      if (!taskOption) throw new Error('No task option is absent from task-link dropdown')
      taskOption.click()
      customDropdowns.push('Link an existing task')
    }
    const providerTrigger = dropdownTrigger('worktree-agent')
    providerTrigger.click()
    await wait(() => dialog.querySelector('[role="listbox"][aria-label="Agent"]'), 'agent dropdown reopened')
    const enabledAgentOption = [...dialog.querySelectorAll('[role="listbox"][aria-label="Agent"] [role="option"]')].find(element => !element.textContent.trim().startsWith('None'))
    if (enabledAgentOption) {
      enabledAgentOption.click()
      await wait(() => dropdownTrigger('worktree-model'), 'model dropdown for observed enabled agent')
      dropdownTrigger('worktree-model').click()
      await wait(() => dialog.querySelector('[role="listbox"][aria-label="Agent model"]'), 'model dropdown')
      const modelMenu = dialog.querySelector('[role="listbox"][aria-label="Agent model"]')
      const modelBounds = modelMenu.getBoundingClientRect()
      if (modelBounds.left < 0 || modelBounds.top < 0 || modelBounds.right > innerWidth || modelBounds.bottom > innerHeight) throw new Error('Model dropdown is clipped by viewport')
      const modelOption = [...modelMenu.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === 'Harness default model') || modelMenu.querySelector('[role="option"]')
      if (!modelOption) throw new Error('Agent model dropdown has no observed option')
      modelOption.click()
      customDropdowns.push('Agent model')
      providerTrigger.click()
      await wait(() => dialog.querySelector('[role="listbox"][aria-label="Agent"] [role="option"]'), 'agent dropdown before resetting to workspace-only')
      const noAgent = [...dialog.querySelectorAll('[role="listbox"][aria-label="Agent"] [role="option"]')].find(element => element.textContent.trim().startsWith('None'))
      if (!noAgent) throw new Error('Workspace-only option disappeared after checking agent model')
      noAgent.click()
    } else {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }
    await wait(() => !dialog.querySelector('button[type="submit"]').disabled, 'observed base and workspace-only submit')
    const form = dialog.querySelector('#worktree-form-fields')
    if (!form) throw new Error('Worktree dialog scroll body is missing')
    form.scrollTop = form.scrollHeight
    const submit = dialog.querySelector('button[type="submit"]')
    await wait(() => {
      const formBounds = dialog.getBoundingClientRect()
      const submitBounds = submit.getBoundingClientRect()
      return submitBounds.top >= formBounds.top && submitBounds.bottom <= formBounds.bottom
    }, 'full create button visible after scrolling the dialog form')
    const bounds = dialog.getBoundingClientRect()
    if (dialog.scrollWidth > dialog.clientWidth || bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) throw new Error('Worktree dialog is clipped by the viewport (bounds=' + JSON.stringify({ left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth, innerWidth, innerHeight }) + ')')
    if (!dialog.querySelector('#worktree-agent button').textContent.trim().startsWith('None')) throw new Error('Worktree dialog did not retain workspace-only agent selection')
    const formBounds = dialog.getBoundingClientRect()
    const submitBounds = submit.getBoundingClientRect()
    if (submitBounds.left < 0 || submitBounds.right > innerWidth || submitBounds.top < formBounds.top || submitBounds.bottom > formBounds.bottom || submitBounds.bottom > innerHeight) throw new Error('Create worktree footer is clipped (form=' + JSON.stringify({ top: formBounds.top, bottom: formBounds.bottom }) + ', submit=' + JSON.stringify({ left: submitBounds.left, top: submitBounds.top, right: submitBounds.right, bottom: submitBounds.bottom }) + ')')
    return { bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }, width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, base: document.querySelector('[role="dialog"] #worktree-base button').textContent.trim(), footerButtonBounds: { left: submitBounds.left, top: submitBounds.top, right: submitBounds.right, bottom: submitBounds.bottom }, footerFullyVisible: true, sourceModes: ['Smart', 'GitHub', 'Branch', 'Name'], advancedBranch: true, customDropdowns }
  `)
  const dialogScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  if (dialogScreenshot.isEmpty()) throw new Error('Electron returned an empty configured worktree dialog screenshot')
  fs.writeFileSync(path.join(fixture, 'worktree-dialog-footer.png'), dialogScreenshot.toPNG())
  fs.writeFileSync(path.join(reports, 'electron-smoke-worktree-dialog-footer.png'), dialogScreenshot.toPNG())
  const submission = await run(`
    const originalFetch = window.fetch.bind(window)
    const observed = { calls: 0 }
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString(), location.href)
      if (url.pathname === ${JSON.stringify(prefix + '/worktree-jobs')} && (init?.method ?? input.method ?? 'GET').toUpperCase() === 'POST') {
        observed.calls++
        observed.request = JSON.parse(init?.body ?? await input.clone().text())
        const response = await originalFetch(input, init)
        observed.response = await response.clone().json()
        return response
      }
      return originalFetch(input, init)
    }
    try {
      document.querySelector('[role="dialog"] button[type="submit"]').click()
      await wait(() => {
        const error = document.querySelector('[role="dialog"] [role="alert"]')
        if (error) throw new Error('Worktree dialog creation failed: ' + error.textContent)
        return observed.response && !document.querySelector('[role="dialog"]') && control('Open Workspace audit workspace smoke/child')
      }, 'dialog receipt reconciled and child observed', 90000)
      if (observed.calls !== 1 || !observed.request?.request_id || observed.request.provider) throw new Error('Worktree dialog repeated creation or selected an agent')
      return observed
    } catch (error) {
      throw new Error(error.message + ' (submission=' + JSON.stringify(observed) + ', dialog=' + document.querySelector('[role="dialog"]')?.textContent.slice(0, 220) + ')')
    } finally { window.fetch = originalFetch }
  `)
  const requestID = submission.request.request_id
  const job = await api('GET', prefix + '/worktree-jobs/' + requestID)
  if (job.status !== 'completed' || !job.workspace?.id) throw new Error('Worktree job did not confirm completion: ' + job.status + ' ' + job.message)
  const child = ownedPath(fixture, job.workspace.path)
  fs.writeFileSync(path.join(root, 'root-only.ts'), '// ROOT_ONLY_SENTINEL\n')
  fs.writeFileSync(path.join(child, 'child-only.ts'), '// CHILD_ONLY_SENTINEL\n')
  fs.writeFileSync(path.join(child, 'shared.ts'), '// CHILD_SHARED_SENTINEL\nexport const scope = "child"\n')
  const observed = await api('GET', prefix + '/git/worktrees')
  const primary = observed.worktrees.find(row => row.primary)
  if (!primary?.id || !observed.worktrees.some(row => row.id === job.workspace.id)) throw new Error('Worktree identities missing from real registry')
  const providers = await api('GET', prefix + '/chat/providers?workspace_id=' + encodeURIComponent(job.workspace.id))
  const provider = providers.providers.find(row => row.enabled && row.conversation_mode === 'native_session' && row.id === 'CODEX')
  let childSession
  let rootSession
  let chatResult = 'skipped_no_registered_native_codex'
  if (provider) {
    rootSession = await api('POST', prefix + '/chat/sessions?workspace_id=' + encodeURIComponent(primary.id), { provider: provider.id, title: 'Root ownership smoke', client_session_id: randomUUID() })
    childSession = await api('POST', prefix + '/chat/sessions?workspace_id=' + encodeURIComponent(job.workspace.id), { provider: provider.id, title: 'Child ownership smoke', client_session_id: randomUUID() })
    const inheritedSession = await api('POST', prefix + '/chat/sessions?workspace_id=' + encodeURIComponent(job.workspace.id), { provider: provider.id, client_session_id: randomUUID() })
    const childList = await api('GET', prefix + '/chat/sessions?workspace_id=' + encodeURIComponent(job.workspace.id))
    if (rootSession.workspace_id !== primary.id || childSession.workspace_id !== job.workspace.id || childList.sessions.some(row => row.id === rootSession.id) || !childList.sessions.some(row => row.id === childSession.id)) throw new Error('Native session scope is not isolated')
    if (inheritedSession.workspace_id !== job.workspace.id || inheritedSession.title !== job.workspace.branch) throw new Error('An empty child conversation title did not inherit its observed worktree label')
    const childDetail = await api('GET', prefix + '/chat/sessions/' + childSession.id + '?workspace_id=' + encodeURIComponent(job.workspace.id))
    const inheritedDetail = await api('GET', prefix + '/chat/sessions/' + inheritedSession.id + '?workspace_id=' + encodeURIComponent(job.workspace.id))
    if (childDetail.messages.length || childDetail.session.provider_thread_id || inheritedDetail.messages.length || inheritedDetail.session.provider_thread_id) throw new Error('Idle session creation unexpectedly started a provider turn')
    chatResult = 'idle_scoped_native_sessions_verified_no_turn_and_child_default_title_inherited'
  }
  const inspectorAudit = await run(`
    await files()
    const visibleFile = fileRow('shared.ts') || fileRow('root-only.ts') || fileRow('child-only.ts')
    if (!visibleFile) throw new Error('No fixture file is available to activate the resizable inspector')
    visibleFile.click()
    await wait(() => document.querySelector('[aria-label="Workspace file sidebar"]') && document.querySelector('[role="separator"][aria-label="Resize workspace files"]'), 'active file and resizable inspector')
    const handle = document.querySelector('[role="separator"][aria-label="Resize workspace files"]')
    if (!handle) throw new Error('File inspector resize control missing')
    const previous = Number(handle.getAttribute('aria-valuenow'))
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    await wait(() => Number(handle.getAttribute('aria-valuenow')) > previous, 'file inspector keyboard resize')
    const resized = Number(handle.getAttribute('aria-valuenow'))
    const controls = document.querySelector('[aria-label="Workspace tool controls"]')
    const pane = tools()
    if (!pane || !controls || !pane.contains(controls)) throw new Error('Tool controls are not inside the workspace tools pane')
    const refresh = controls.querySelector('button[aria-label="Refresh conversations"]')
    if (!refresh || !controls.contains(refresh)) throw new Error('Conversation refresh control is not in the workspace tools toolbar')
    if (controls.querySelector('button[title]')) throw new Error('Tool controls still use browser-native title tooltips')
    const bounds = pane.getBoundingClientRect()
    const inspector = pane.querySelector('[aria-label="Workspace file sidebar"]').getBoundingClientRect()
    const toolbarBounds = controls.getBoundingClientRect()
    const toolbarHeight = toolbarBounds.height
    if (toolbarBounds.top < bounds.top || toolbarBounds.bottom > bounds.bottom || toolbarHeight < 32 || toolbarHeight > 44 || inspector.top < toolbarBounds.bottom - 1) throw new Error('Workspace toolbar or inspector is outside its expected pane layout: ' + JSON.stringify({ pane: { top: bounds.top, bottom: bounds.bottom }, toolbar: { top: toolbarBounds.top, bottom: toolbarBounds.bottom, height: toolbarHeight }, inspector: { top: inspector.top, bottom: inspector.bottom } }))
    document.querySelector('button[aria-label="Hide workspace tools"]').click()
    await wait(() => !tools() || tools().hidden, 'close workspace tools')
    const showTools = control('Show workspace tools')
    if (!showTools) throw new Error('Chat header does not expose Show workspace tools while the pane is closed')
    showTools.click()
    await wait(() => tools() && !tools().hidden, 'reopen workspace tools')
    if (Number(document.querySelector('[aria-label="Resize workspace files"]').getAttribute('aria-valuenow')) !== resized) throw new Error('Inspector width changed after tools toggle')
    if (document.body.textContent.includes('Usage not observed for this turn')) throw new Error('Absent usage is still rendered as a message')
    if (!control('Choose agent mode')) throw new Error('Agent mode selector missing')
    return { toolbarInsideToolsPane: true, refreshControlInsideToolbar: true, nativeTitlesRemoved: true, toolbarHeight, inspectorTopOffset: inspector.top - bounds.top, keyboardWidthBefore: previous, keyboardWidthAfter: resized, retainedAfterToggle: true, absentUsageHidden: true, agentPickerVisible: true }
  `)
  const dragPoint = await run(`const handle = document.querySelector('[aria-label="Resize workspace files"]'); const bounds = handle.getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + Math.min(bounds.height / 2, 100)), width: Number(handle.getAttribute('aria-valuenow')) }`)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: dragPoint.x, y: dragPoint.y })
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: dragPoint.x, y: dragPoint.y })
  win.webContents.sendInputEvent({ type: 'mouseMove', x: dragPoint.x + 32, y: dragPoint.y })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: dragPoint.x + 32, y: dragPoint.y })
  inspectorAudit.nativePointerWidth = await run(`await wait(() => Number(document.querySelector('[aria-label="Resize workspace files"]').getAttribute('aria-valuenow')) > ${dragPoint.width}, 'native file inspector pointer drag'); return Number(document.querySelector('[aria-label="Resize workspace files"]').getAttribute('aria-valuenow'))`)
  const hoverPoint = await run(`const bounds = control('Toggle workspace files').getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }`)
  win.show()
  win.focus()
  win.webContents.sendInputEvent({ type: 'mouseLeave', x: hoverPoint.x, y: hoverPoint.y })
  win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
  await new Promise(resolve => setTimeout(resolve, 650))
  inspectorAudit.tooltip = await run(`const target = control('Toggle workspace files'); if (!target) throw new Error('Native hover target missing'); const targetBounds = target.getBoundingClientRect(); const point = { x: Math.round(targetBounds.left + targetBounds.width / 2), y: Math.round(targetBounds.top + targetBounds.height / 2) }; const hit = document.elementFromPoint(point.x, point.y); const tip = [...document.querySelectorAll('[role="tooltip"]')].find(node => node.textContent.toLowerCase().includes('files')); if (!tip) throw new Error('Native pointer hover did not open the styled Files tooltip after its delay (target=' + JSON.stringify({ left: targetBounds.left, top: targetBounds.top, right: targetBounds.right, bottom: targetBounds.bottom, point, hit: hit?.outerHTML?.slice(0, 240), visibleMatches: [...document.querySelectorAll('[aria-label="Toggle workspace files"]')].map(node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, hidden: !r.width || !r.height } }) }) + ', tooltips=' + JSON.stringify([...document.querySelectorAll('[role="tooltip"]')].map(node => node.textContent.trim())) + ')'); const bounds = tip.getBoundingClientRect(); if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) throw new Error('Tooltip outside viewport'); return { visible: true, viewportContained: true, content: tip.textContent.trim(), target: { left: targetBounds.left, top: targetBounds.top, right: targetBounds.right, bottom: targetBounds.bottom } }`)
  win.hide()
  const filesLayoutAudit = await run(`
    if (control('Refresh workspaces for Workspace audit')) clickControl('Refresh workspaces for Workspace audit')
    else {
      clickControl('Project actions for Workspace audit')
      await wait(() => control('Refresh workspaces'), 'project refresh action')
      clickControl('Refresh workspaces')
    }
    await wait(() => control('Open Workspace audit workspace smoke/child'), 'observed child sidebar card')
    const primaryCard = control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')})
    primaryCard.click()
    await wait(() => primaryCard.getAttribute('aria-pressed') === 'true', 'primary selected')
    await files()
    await wait(() => document.querySelector('[aria-label="Workspace files view"]') && !document.querySelector('[aria-label="Workspace file sidebar"]'), 'full-pane files view before opening a file')
    const filesRegion = document.querySelector('[aria-label="Workspace files view"]')
    const fullTree = filesRegion?.querySelector('[role="tree"]')
    if (!fullTree || fullTree.getBoundingClientRect().width < filesRegion.getBoundingClientRect().width - 24) throw new Error('Files tree does not fill the available tools pane width')
    const fullPaneBounds = filesRegion.getBoundingClientRect()
    const fileTreeBounds = fullTree.getBoundingClientRect()
    await wait(() => fileRow('root-only.ts') && fileRow('shared.ts'), 'root-owned files')
    if (fileRow('child-only.ts')) throw new Error('Root explorer leaked child file')
    fileRow('root-only.ts').click()
    await wait(() => editorTab('root-only.ts') && editorText().includes('ROOT_ONLY_SENTINEL'), 'root file editor')
    await wait(() => document.querySelector('[aria-label="Workspace file sidebar"]') && document.querySelector('[role="separator"][aria-label="Resize workspace files"]'), 'resizable file inspector beside the opened editor')
    const rootFileTab = editorTab('root-only.ts')
    const closeRootFile = rootFileTab?.querySelector('[role="button"]')
    if (!closeRootFile) throw new Error('Root editor tab close control is missing')
    closeRootFile.click()
    await wait(() => !editorTab('root-only.ts') && document.querySelector('[aria-label="Workspace files view"]') && !document.querySelector('[aria-label="Workspace file sidebar"]'), 'full-pane files view restored after closing the last file')
    fileRow('root-only.ts').click()
    await wait(() => editorTab('root-only.ts') && editorText().includes('ROOT_ONLY_SENTINEL') && document.querySelector('[role="separator"][aria-label="Resize workspace files"]'), 'reopened root file with resizable inspector')
    return { fullPaneBeforeFirstOpen: true, fullPaneTreeWidth: Math.round(fileTreeBounds.width), fullPaneWidth: Math.round(fullPaneBounds.width), resizableInspectorAfterOpen: true, fullPaneRestoredAfterClose: true, inspectorRestoredAfterReopen: true }
  `)
  await run(`
    fileRow('shared.ts').click()
    await wait(() => editorTab('shared.ts') && editorText().includes('ROOT_SHARED_SENTINEL'), 'root shared editor')
    clickControl('Open Workspace audit workspace smoke/child')
    await wait(() => control('Open Workspace audit workspace smoke/child').getAttribute('aria-pressed') === 'true', 'child selected')
    await files()
    await wait(() => fileRow('child-only.ts') && fileRow('shared.ts'), 'child-owned files')
    if (fileRow('root-only.ts') || editorTab('root-only.ts')) throw new Error('Child explorer/editor leaked root context')
    fileRow('child-only.ts').click()
    await wait(() => editorTab('child-only.ts') && editorText().includes('CHILD_ONLY_SENTINEL'), 'child file editor')
    fileRow('shared.ts').click()
    await wait(() => editorTab('shared.ts') && editorText().includes('CHILD_SHARED_SENTINEL'), 'same-name child shared editor')
    control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).click()
    await wait(() => control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).getAttribute('aria-pressed') === 'true', 'root before restoring editor group')
    await files()
    await wait(() => editorTab('root-only.ts') && editorTab('shared.ts') && editorText().includes('ROOT_SHARED_SENTINEL'), 'restored root editor group')
    if (editorTab('child-only.ts') || fileRow('child-only.ts')) throw new Error('Restored root context leaked child state')
    clickControl('Open Workspace audit workspace smoke/child')
    await wait(() => control('Open Workspace audit workspace smoke/child').getAttribute('aria-pressed') === 'true', 'child before restoring editor group')
    await files()
    await wait(() => editorTab('child-only.ts') && editorText().includes('CHILD_SHARED_SENTINEL'), 'restored child editor group')
    if (editorTab('root-only.ts')) throw new Error('Restored child group leaked root tab')
  `)
  if (provider) await run(`
    await wait(() => control('Open CODEX native chat Child ownership smoke'), 'child scoped session row')
    clickControl('Open CODEX native chat Child ownership smoke')
    await wait(() => document.querySelector('[aria-label="Workspace chat pane"]')?.textContent.includes('Child ownership smoke'), 'selected child native conversation')
    const rename = control('Rename conversation: Child ownership smoke')
    if (!rename) throw new Error('Selected conversation title is not editable')
    rename.click()
    await wait(() => document.querySelector('[aria-label="Conversation name"]'), 'conversation title editor')
    const titleInput = document.querySelector('[aria-label="Conversation name"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(titleInput, 'Renamed child ownership smoke')
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await wait(() => control('Rename conversation: Renamed child ownership smoke'), 'server-confirmed title in selected chat header')
    await wait(() => control('Open CODEX native chat Renamed child ownership smoke'), 'renamed scoped sidebar row')
    const threadToggle = [...document.querySelectorAll('section[aria-label$="workspace chat"] button[aria-label="Toggle conversations"]')].find(element => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 })
    if (!threadToggle) throw new Error('Visible conversation-list toggle missing in the active workspace chat')
    threadToggle.click()
    await wait(() => document.querySelector('[aria-label="Workspace conversations"]'), 'conversation list open')
    const chat = threadToggle.closest('section')
    chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(() => !document.querySelector('[aria-label="Workspace conversations"]') && document.activeElement === threadToggle, 'conversation list Escape dismissal and focus restoration')
  `)
  if (provider) {
    const renamed = await api('GET', prefix + '/chat/sessions/' + childSession.id + '?workspace_id=' + encodeURIComponent(job.workspace.id))
    if (renamed.session.id !== childSession.id || renamed.session.workspace_id !== job.workspace.id || renamed.session.title !== 'Renamed child ownership smoke' || renamed.messages.length || renamed.session.provider_thread_id) throw new Error('Conversation rename did not persist with exact child scope and idle provider state')
    const wrongScope = await win.webContents.executeJavaScript(`(async () => {
      const config = await window.orchestraDesktop.getBackendConfig()
      const response = await fetch(config.baseUrl + ${JSON.stringify(prefix + '/chat/sessions/' + childSession.id + '/title?workspace_id=' + encodeURIComponent(primary.id))}, { method: 'PATCH', headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Wrong scope rename', expected_title: 'Renamed child ownership smoke' }) })
      return { status: response.status, body: await response.text() }
    })()`)
    if (wrongScope.status < 400) throw new Error('Wrong-worktree conversation rename was accepted: ' + JSON.stringify(wrongScope))
    const afterWrongScope = await api('GET', prefix + '/chat/sessions/' + childSession.id + '?workspace_id=' + encodeURIComponent(job.workspace.id))
    if (afterWrongScope.session.title !== 'Renamed child ownership smoke' || afterWrongScope.messages.length || afterWrongScope.session.provider_thread_id) throw new Error('Wrong-scope rename changed the child conversation')
  }
  const alignment = await run(`
    const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Project workspace"]')].find(element => element.getBoundingClientRect().width > 0)
    const pane = tools()
    if (!tabs || !pane) throw new Error('Workspace column headers missing')
    const header = tabs.closest('header')
    if (!header) throw new Error('Workspace navigation is not embedded in the native conversation header')
    const offset = Math.abs(header.getBoundingClientRect().top - pane.getBoundingClientRect().top)
    if (offset > 3) throw new Error('Workspace tools/header vertical offset: ' + offset)
    const title = header.querySelector('h2')?.getBoundingClientRect()
    const navigation = tabs.getBoundingClientRect()
    const inline = title && navigation.top < title.bottom && navigation.bottom > title.top
    if (!inline) throw new Error('Workspace navigation wrapped below the conversation title at native audit width')
    return { topOffsetPixels: offset, aligned: true, navigationBesideConversationTitle: true }
  `)
  const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  fs.writeFileSync(path.join(fixture, 'multi-worktree.png'), screenshot.toPNG())
  fs.mkdirSync(reports, { recursive: true })
  fs.writeFileSync(path.join(reports, 'electron-smoke-multi-worktree.png'), screenshot.toPNG())
  const toolMenu = await run(`
    const trigger = control('Add workspace tool')
    if (!trigger) throw new Error('Add workspace tool trigger is missing from the workspace toolbar')
    trigger.click()
    await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"]'), 'tool menu')
    const menu = document.querySelector('[role="menu"][aria-label="Add workspace tool"]')
    if (menu.parentElement !== document.body) throw new Error('Tool menu is not portalled outside the constrained tools pane')
    const bounds = menu.getBoundingClientRect()
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight) throw new Error('Tool menu is clipped by viewport')
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map(element => element.textContent.trim())
    for (const expected of ['File viewer', 'New terminal', 'New markdown document', 'New browser tab']) if (!labels.includes(expected)) throw new Error('Tool menu action missing: ' + expected)
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    await wait(() => document.activeElement === items[0], 'tool menu initial focus')
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    if (document.activeElement !== items[1]) throw new Error('Tool menu ArrowDown did not move focus to the next enabled action')
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    if (document.activeElement !== items[items.length - 1]) throw new Error('Tool menu End did not move focus to the final action')
    items[items.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"][aria-label="Add workspace tool"]') && document.activeElement === trigger, 'tool menu Escape dismissal and focus restoration')
    trigger.click()
    await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"]'), 'tool menu reopen for outside dismissal')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"][aria-label="Add workspace tool"]'), 'tool menu outside dismissal')
    return { verified: true, actions: labels, keyboardFocus: true, escapeRestoresTriggerFocus: true, outsideDismisses: true, newTerminalEnabled: !items[1].disabled }
  `)
  if (toolMenu.verified) {
    const menuScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    fs.writeFileSync(path.join(fixture, 'workspace-tools-menu.png'), menuScreenshot.toPNG())
    fs.writeFileSync(path.join(reports, 'electron-smoke-workspace-tools-menu.png'), menuScreenshot.toPNG())
    const existingChildFiles = new Set(fs.readdirSync(child))
    const existingRootFiles = new Set(fs.readdirSync(root))
    await run(`
      clickControl('Add workspace tool')
      await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"] [role="menuitem"]'), 'markdown action menu')
      clickControl('New markdown document')
      await wait(() => [...tools().querySelectorAll('button[title]')].some(element => /^Untitled-.*\\.md$/.test(element.title)) && editorText().includes('Untitled'), 'child markdown creation and editor')
    `)
    const documents = fs.readdirSync(child).filter(name => !existingChildFiles.has(name) && /^Untitled-.*\.md$/.test(name))
    if (documents.length !== 1 || fs.readFileSync(path.join(child, documents[0]), 'utf8') !== '# Untitled\n\n') throw new Error('Markdown tool did not persist the expected child-owned document')
    if (fs.readdirSync(root).some(name => !existingRootFiles.has(name))) throw new Error('Child document creation changed root file membership')
    await run(`
      clickControl('Toggle workspace search')
      await wait(() => tools()?.querySelector('input[placeholder="Search files..."]'), 'workspace search inspector')
      if (document.querySelector('[aria-label="Workspace file sidebar"]')) throw new Error('Search activation left the file viewer inspector open too')
      clickControl('Toggle workspace search')
      await wait(() => !tools()?.querySelector('input[placeholder="Search files..."]'), 'workspace search inspector close')
      clickControl('Add workspace tool')
      await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"] [role="menuitem"]'), 'file viewer menu action')
      clickControl('File viewer')
      await wait(() => document.querySelector('[aria-label="Workspace file sidebar"]'), 'file viewer action from plus menu')
    `)
    toolMenu.fileViewerAction = true
    toolMenu.searchToggle = true
    await run(`
      clickControl('Add workspace tool')
      await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"] [role="menuitem"]'), 'terminal menu action')
      const terminalAction = [...document.querySelectorAll('[role="menu"][aria-label="Add workspace tool"] [role="menuitem"]')].find(item => item.textContent.trim() === 'New terminal')
      if (!terminalAction || terminalAction.disabled) throw new Error('New terminal action is unavailable for the disposable workspace')
      terminalAction.click()
      await wait(() => tools()?.querySelector('button[title="Workspace audit Shell"]'), 'new terminal tab')
      await wait(() => tools()?.querySelector('.xterm-screen')?.textContent.includes('DISCONNECTED FROM BACKEND'), 'honest Windows PTY unavailable result')
      const terminalTab = tools().querySelector('button[title="Workspace audit Shell"]')
      terminalTab.querySelector('[role="button"]')?.click()
      await wait(() => !tools()?.querySelector('button[title="Workspace audit Shell"]'), 'close unsupported terminal tab')
    `)
    toolMenu.newTerminal = 'selected_then_closed_after_windows_backend_reported_pty_unavailable'
    await run(`
      clickControl('Add workspace tool')
      await wait(() => control('New browser tab'), 'browser menu action')
      clickControl('New browser tab')
      await wait(() => tools()?.querySelector('input[placeholder="Enter URL..."]') && tools()?.querySelector('webview'), 'native browser toolbar and guest')
      await wait(() => { try { return tools().querySelector('webview').getWebContentsId() > 0 } catch { return false } }, 'actual Electron webview guest attachment')
      if (!control('Open Workspace audit workspace smoke/child') || control('Open Workspace audit workspace smoke/child').getAttribute('aria-pressed') !== 'true') throw new Error('Browser creation changed child selection')
    `)
    const browserScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    fs.writeFileSync(path.join(reports, 'electron-smoke-child-browser.png'), browserScreenshot.toPNG())
    await run(`
      control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).click()
      await wait(() => control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).getAttribute('aria-pressed') === 'true', 'root after child browser')
      await files()
      await wait(() => editorTab('root-only.ts') && editorText().includes('ROOT_SHARED_SENTINEL'), 'root editor after child browser')
      if (tools().querySelector('webview') || [...tools().querySelectorAll('button[title]')].some(element => /^Untitled-.*\\.md$/.test(element.title))) throw new Error('Root context leaked child browser/document tools')
      clickControl('Open Workspace audit workspace smoke/child')
      await wait(() => control('Open Workspace audit workspace smoke/child').getAttribute('aria-pressed') === 'true', 'child before restoring editor')
      await files()
      await wait(() => editorTab('shared.ts'), 'retained child editor tab')
      editorTab('shared.ts').click()
      await wait(() => editorText().includes('CHILD_SHARED_SENTINEL'), 'restored child editor after browser')
    `)
    toolMenu.childDocumentPersisted = true
    toolMenu.actualNativeBrowserGuest = true
    toolMenu.rootEditorUnaffected = true
  }
  await run(`
    control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).click()
    await wait(() => control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}).getAttribute('aria-pressed') === 'true', 'primary before Git review')
    clickControl('Git & pull requests')
    await wait(() => document.querySelector('[role="tabpanel"][aria-label="Git & pull requests"]'), 'restore Git review surface')
  `)
  let archiveAudit = 'skipped_no_registered_native_codex'
  if (rootSession) {
    await run(`
      clickControl('Refresh workspaces for Workspace audit')
      await wait(() => control('Archive conversation Root ownership smoke'), 'root conversation archive control')
      clickControl('Archive conversation Root ownership smoke')
      await wait(() => document.querySelector('[role="dialog"][aria-labelledby]'), 'archive dialog')
      clickControl('Archive conversation')
      await wait(() => !document.querySelector('[role="dialog"]'), 'confirmed conversation archive')
      await wait(() => archiveCatalog(1), 'retained archive catalog button')
      if (!archiveCatalog(1)) throw new Error('Required control not found: Archived conversations (1)')
      archiveCatalog(1).click()
      await wait(() => archivedConversation('Root ownership smoke'), 'archived conversation row after expanding history')
      if (!archivedConversation('Root ownership smoke')) throw new Error('Archived history is expanded without the expected row: ' + document.querySelector('[aria-label="Workspace chat pane"]')?.innerHTML.slice(-1800))
      archivedConversation('Root ownership smoke').click()
      await wait(() => control('Restore conversation') && !control('Restore conversation').disabled, 'readable archive and restore control')
      clickControl('Restore conversation')
      await wait(() => !document.querySelector('[role="dialog"]'), 'confirmed conversation restore')
    `)
    const restored = await api('GET', prefix + '/chat/sessions/' + rootSession.id + '?workspace_id=' + encodeURIComponent(primary.id))
    if (restored.session.archived || restored.session.lifecycle_version !== 2 || restored.session.provider !== rootSession.provider || restored.session.provider_thread_id) throw new Error('Archive/restore lost idle provider identity or started a provider')
    archiveAudit = 'native_dialog_archive_history_restore_confirmed_no_provider_turn'
  }
  const primaryMenuPoint = await run(`const trigger = control('Workspace actions for Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}); if (!trigger) throw new Error('Primary workspace actions trigger missing'); const bounds = trigger.getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }`)
  win.webContents.sendInputEvent({ type: 'mouseMove', ...primaryMenuPoint })
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...primaryMenuPoint })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...primaryMenuPoint })
  await run(`
    await wait(() => document.querySelector('[role="menu"]'), 'primary workspace menu')
    const primaryTrigger = control('Workspace actions for Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')})
    const protectedRemove = document.querySelector('[role="menuitem"][aria-label^="Remove worktree unavailable:"]')
    if (!protectedRemove?.disabled) throw new Error('Primary removal is not protected')
    const primaryMenu = document.querySelector('[role="menu"]')
    await wait(() => document.activeElement === primaryMenu.querySelector('[role="menuitem"]:not(:disabled)'), 'primary actions initial focus')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"]') && document.activeElement === primaryTrigger, 'primary actions Escape and focus restore')
    primaryTrigger.click()
    await wait(() => document.querySelector('[role="menu"]'), 'primary actions reopen for outside dismissal')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"]'), 'primary actions outside dismissal')
    const childTrigger = control('Workspace actions for Workspace audit workspace smoke/child')
    childTrigger.click()
    await wait(() => document.querySelector('[role="menu"]'), 'child workspace menu')
    const childRemove = document.querySelector('[role="menuitem"][aria-label="Remove worktree"]')
    if (!childRemove || childRemove.disabled) throw new Error('Child worktree removal action is missing or unexpectedly disabled')
    const childMenu = document.querySelector('[role="menu"]')
    await wait(() => document.activeElement === childMenu.querySelector('[role="menuitem"]:not(:disabled)'), 'child actions initial focus')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"]') && document.activeElement === childTrigger, 'child actions Escape and focus restore')
    childTrigger.click()
    await wait(() => document.querySelector('[role="menu"]'), 'child actions reopen for outside dismissal')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wait(() => !document.querySelector('[role="menu"]'), 'child actions outside dismissal')
  `)
  const primaryMenuPointAfterSubmenus = await run(`const trigger = control('Workspace actions for Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')}); const bounds = trigger.getBoundingClientRect(); return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }`)
  win.webContents.sendInputEvent({ type: 'mouseMove', ...primaryMenuPointAfterSubmenus })
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...primaryMenuPointAfterSubmenus })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...primaryMenuPointAfterSubmenus })
  await run(`
    await wait(() => document.querySelector('[role="menu"]'), 'primary workspace menu reopened for close')
    const protectedRemove = document.querySelector('[role="menuitem"][aria-label^="Remove worktree unavailable:"]')
    clickControl('Close workspace view')
    await wait(() => control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')})?.getAttribute('aria-pressed') !== 'true', 'closed primary workspace view')
    clickControl('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')})
    await files()
    await wait(() => editorTab('root-only.ts') && editorTab('shared.ts'), 'editor tabs retained across close and reopen')
    editorTab('shared.ts').click()
    await wait(() => editorGroup('shared.ts'), 'shared.ts is active in its visible editor group')
    const bufferDeadline = Date.now() + 15000
    while (!editorText().includes('ROOT_SHARED_SENTINEL') && Date.now() < bufferDeadline) await new Promise(resolve => setTimeout(resolve, 75))
    if (!editorText().includes('ROOT_SHARED_SENTINEL')) {
      const ancestors = element => {
        const chain = []
        for (let node = element, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
          const bounds = node.getBoundingClientRect()
          chain.push({ tag: node.tagName, role: node.getAttribute('role'), label: node.getAttribute('aria-label'), groupId: node.getAttribute('data-group-id'), activeTabId: node.getAttribute('data-active-tab-id'), className: typeof node.className === 'string' ? node.className.slice(0, 120) : '', hidden: node.hasAttribute('hidden'), bounds: { width: bounds.width, height: bounds.height } })
        }
        return chain
      }
      const editors = [...(tools()?.querySelectorAll('.monaco-editor') ?? [])].map(editor => {
        const bounds = editor.getBoundingClientRect()
        return { bounds: { width: bounds.width, height: bounds.height }, hidden: !!editor.closest('[hidden]'), text: (editor.querySelector('.view-lines')?.textContent ?? '').slice(0, 240), group: editor.closest('[data-group-id]')?.getAttribute('data-group-id'), selectedTab: editor.closest('[data-group-id]')?.querySelector('[data-active-tab="true"]')?.title, ancestors: ancestors(editor) }
      })
      const toolsPane = tools()
      const workspaceTabs = [...(workspaceTablist()?.querySelectorAll('[role="tab"]') ?? [])].map(tab => ({ name: tab.textContent.trim(), selected: tab.getAttribute('aria-selected'), visible: visible(tab) }))
      throw new Error('Editor buffer is not visible after close and reopen: ' + JSON.stringify({ tab: editorTab('shared.ts')?.outerHTML, activeGroup: editorGroup('shared.ts')?.getAttribute('data-group-id'), editors, workspaceTabs, tools: toolsPane ? { hidden: toolsPane.hasAttribute('hidden'), visible: visible(toolsPane), bounds: { width: toolsPane.getBoundingClientRect().width, height: toolsPane.getBoundingClientRect().height } } : null }))
    }
    clickControl('Git & pull requests')
    await wait(() => document.querySelector('[role="tabpanel"][aria-label="Git & pull requests"]'), 'Git review restored after close')
  `)
  const retained = await api('GET', prefix + '/git/worktrees')
  if (!retained.worktrees.some(row => row.id === primary.id) || !retained.worktrees.some(row => row.id === job.workspace.id)) throw new Error('Closing a view removed a real checkout')
  if (fs.readFileSync(path.join(root, 'shared.ts'), 'utf8') !== rootShared) throw new Error('Child audit changed root contents')
  const result = { worktreeJob: 'completed', creation: 'real_dialog_workspace_only', creationSubmissions: submission.calls, dialogDropdown: dropdownLayout, dialogLayout, filesLayoutAudit, childWorkspaceID: job.workspace.id, realGitMembership: true, exactSidebarSelection: true, isolatedFileTrees: true, isolatedSameNameEditorBuffers: true, editorGroupsRestored: true, rootContentsRetained: true, nativeSessions: chatResult, conversationRename: provider ? 'server_persisted_child_scope_wrong_scope_rejected_idle_no_turn' : 'skipped_no_registered_native_codex', providerTurns: 0, alignment, toolMenu, inspectorAudit, archiveAudit, primaryMenuActivatedByNativePointer: true, primaryChildMenuKeyboardAndOutsideDismissal: true, closeViewAudit: 'primary_protected_close_reopen_retains_editors_and_checkouts' }
  fs.writeFileSync(path.join(reports, 'multi-worktree-smoke-result.json'), JSON.stringify(result, null, 2))
  return result
}

module.exports = { auditMultiWorktree }
