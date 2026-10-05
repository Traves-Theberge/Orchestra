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
  const api = (method, route, body) => win.webContents.executeJavaScript(`(async () => {
    const config = await window.orchestraDesktop.getBackendConfig()
    const response = await fetch(config.baseUrl + ${JSON.stringify(route)}, { method: ${JSON.stringify(method)}, headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''} })
    if (!response.ok) throw new Error('Worktree audit API returned ' + response.status + ' for ' + ${JSON.stringify(route)} + ': ' + await response.text())
    return response.json()
  })()`)
  const run = code => win.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, name) => {
      const deadline = Date.now() + 15000
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 75))
      if (!predicate()) throw new Error('Multi-worktree audit timed out: ' + name)
    }
    const control = name => [...document.querySelectorAll('button, [role="button"]')].find(element => element.getAttribute('aria-label') === name || element.textContent.trim() === name)
    const tools = () => document.querySelector('[aria-label="Workspace tools"]')
    const fileRow = name => [...document.querySelectorAll('[aria-label="Workspace file sidebar"] [role="treeitem"]')].find(element => element.textContent.trim() === name)
    const editorTab = name => tools()?.querySelector('button[title="' + name + '"]')
    const editorText = () => tools()?.querySelector('.monaco-editor .view-lines')?.textContent ?? ''
    const files = async () => {
      (control('Files & editor') ?? control('Files & terminals'))?.click()
      await wait(() => control('Toggle workspace files'), 'files tool surface')
      if (control('Toggle workspace files').getAttribute('aria-pressed') !== 'true') control('Toggle workspace files').click()
      await wait(() => document.querySelector('[aria-label="Workspace file sidebar"]'), 'file tree')
    }
    ${code}
  })()`)
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
    control('Create worktree in Workspace audit').click()
    await wait(() => document.querySelector('[role="dialog"] #worktree-source'), 'real worktree dialog')
    const dialog = document.querySelector('[role="dialog"]')
    const tablist = dialog.querySelector('#worktree-source-tabs')
    for (const name of ['GitHub', 'Branch', 'Name', 'Smart']) {
      const tab = [...tablist.querySelectorAll('[role="tab"]')].find(element => element.textContent.trim().endsWith(name))
      if (!tab) throw new Error('Worktree source mode missing: ' + name)
      tab.click()
      await wait(() => tab.getAttribute('aria-selected') === 'true' && dialog.isConnected, name + ' source mode')
      if (document.body.innerText.includes('failed to render')) throw new Error('Source mode ' + name + ' broke the renderer')
    }
    const setInput = (id, value) => {
      const input = dialog.querySelector('#' + id)
      if (!input) throw new Error('Worktree field missing: ' + id)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setInput('worktree-source', 'smoke-child')
    control('Advanced').click()
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
    return { base: selectedBase, baseDropdownBounds: { left: menuBounds.left, top: menuBounds.top, right: menuBounds.right, bottom: menuBounds.bottom }, baseDropdownWithinViewport: true }
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
    return { bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }, width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, base: document.querySelector('[role="dialog"] #worktree-base button').textContent.trim(), footerButtonBounds: { left: submitBounds.left, top: submitBounds.top, right: submitBounds.right, bottom: submitBounds.bottom }, footerFullyVisible: true, sourceModes: ['Smart', 'GitHub', 'Branch', 'Name'] }
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
      }, 'dialog receipt reconciled and child observed')
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
  let chatResult = 'skipped_no_registered_native_codex'
  if (provider) {
    const rootSession = await api('POST', prefix + '/chat/sessions?workspace_id=' + encodeURIComponent(primary.id), { provider: provider.id, title: 'Root ownership smoke', client_session_id: randomUUID() })
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
    const handle = document.querySelector('[role="separator"][aria-label="Resize workspace files"]')
    if (!handle) throw new Error('File inspector resize control missing')
    const previous = Number(handle.getAttribute('aria-valuenow'))
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    await wait(() => Number(handle.getAttribute('aria-valuenow')) > previous, 'file inspector keyboard resize')
    const resized = Number(handle.getAttribute('aria-valuenow'))
    const controls = document.querySelector('[aria-label="Workspace tool controls"]')
    if (!controls?.closest('header')) throw new Error('Tool controls are not inline with the conversation header')
    if (controls.querySelector('button[title]')) throw new Error('Tool controls still use browser-native title tooltips')
    const bounds = tools().getBoundingClientRect()
    const inspector = tools().querySelector('[aria-label="Workspace file sidebar"]').getBoundingClientRect()
    if (Math.abs(inspector.top - bounds.top) > 1) throw new Error('Inspector still has a duplicate header row')
    document.querySelector('button[aria-label="Files & terminals"]').click()
    await wait(() => !tools() || tools().hidden, 'close workspace tools')
    document.querySelector('button[aria-label="Files & terminals"]').click()
    await wait(() => tools() && !tools().hidden, 'reopen workspace tools')
    if (Number(document.querySelector('[aria-label="Resize workspace files"]').getAttribute('aria-valuenow')) !== resized) throw new Error('Inspector width changed after tools toggle')
    if (document.body.textContent.includes('Usage not observed for this turn')) throw new Error('Absent usage is still rendered as a message')
    if (!control('Choose agent mode')) throw new Error('Agent mode selector missing')
    return { inlineToolControls: true, nativeTitlesRemoved: true, inspectorTopOffset: inspector.top - bounds.top, keyboardWidthBefore: previous, keyboardWidthAfter: resized, retainedAfterToggle: true, absentUsageHidden: true, agentPickerVisible: true }
  `)
  await run(`
    if (control('Refresh workspaces for Workspace audit')) control('Refresh workspaces for Workspace audit').click()
    else {
      control('Project actions for Workspace audit').click()
      await wait(() => control('Refresh workspaces'), 'project refresh action')
      control('Refresh workspaces').click()
    }
    await wait(() => control('Open Workspace audit workspace smoke/child'), 'observed child sidebar card')
    const primaryCard = control('Open Workspace audit workspace ' + ${JSON.stringify(primary.branch || 'Detached')})
    primaryCard.click()
    await wait(() => primaryCard.getAttribute('aria-pressed') === 'true', 'primary selected')
    await files()
    await wait(() => fileRow('root-only.ts') && fileRow('shared.ts'), 'root-owned files')
    if (fileRow('child-only.ts')) throw new Error('Root explorer leaked child file')
    fileRow('root-only.ts').click()
    await wait(() => editorTab('root-only.ts') && editorText().includes('ROOT_ONLY_SENTINEL'), 'root file editor')
    fileRow('shared.ts').click()
    await wait(() => editorTab('shared.ts') && editorText().includes('ROOT_SHARED_SENTINEL'), 'root shared editor')
    control('Open Workspace audit workspace smoke/child').click()
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
    control('Open Workspace audit workspace smoke/child').click()
    await wait(() => control('Open Workspace audit workspace smoke/child').getAttribute('aria-pressed') === 'true', 'child before restoring editor group')
    await files()
    await wait(() => editorTab('child-only.ts') && editorText().includes('CHILD_SHARED_SENTINEL'), 'restored child editor group')
    if (editorTab('root-only.ts')) throw new Error('Restored child group leaked root tab')
  `)
  if (provider) await run(`
    await wait(() => control('Open CODEX conversation Child ownership smoke'), 'child scoped session row')
    control('Open CODEX conversation Child ownership smoke').click()
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
    await wait(() => control('Open CODEX conversation Renamed child ownership smoke'), 'renamed scoped sidebar row')
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
    if (!trigger) return { verified: false, reason: 'production_build_has_previous_toolbar' }
    trigger.click()
    await wait(() => document.querySelector('[role="menu"][aria-label="Add workspace tool"]'), 'tool menu')
    const menu = document.querySelector('[role="menu"][aria-label="Add workspace tool"]')
    if (menu.parentElement !== document.body) throw new Error('Tool menu is not portalled outside the constrained tools pane')
    const bounds = menu.getBoundingClientRect()
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight) throw new Error('Tool menu is clipped by viewport')
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map(element => element.textContent.trim())
    for (const expected of ['File viewer', 'New terminal', 'New markdown document', 'New browser tab']) if (!labels.includes(expected)) throw new Error('Tool menu action missing: ' + expected)
    return { verified: true, actions: labels }
  `)
  if (toolMenu.verified) {
    const menuScreenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    fs.writeFileSync(path.join(fixture, 'workspace-tools-menu.png'), menuScreenshot.toPNG())
    fs.writeFileSync(path.join(reports, 'electron-smoke-workspace-tools-menu.png'), menuScreenshot.toPNG())
    const existingChildFiles = new Set(fs.readdirSync(child))
    const existingRootFiles = new Set(fs.readdirSync(root))
    await run(`
      control('New markdown document').click()
      await wait(() => [...tools().querySelectorAll('button[title]')].some(element => /^Untitled-.*\\.md$/.test(element.title)) && editorText().includes('Untitled'), 'child markdown creation and editor')
    `)
    const documents = fs.readdirSync(child).filter(name => !existingChildFiles.has(name) && /^Untitled-.*\.md$/.test(name))
    if (documents.length !== 1 || fs.readFileSync(path.join(child, documents[0]), 'utf8') !== '# Untitled\n\n') throw new Error('Markdown tool did not persist the expected child-owned document')
    if (fs.readdirSync(root).some(name => !existingRootFiles.has(name))) throw new Error('Child document creation changed root file membership')
    await run(`
      control('Add workspace tool').click()
      await wait(() => control('New browser tab'), 'browser menu action')
      control('New browser tab').click()
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
      control('Open Workspace audit workspace smoke/child').click()
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
    control('Git & pull requests').click()
    await wait(() => document.querySelector('[role="tabpanel"][aria-label="Git & pull requests"]'), 'restore Git review surface')
  `)
  if (fs.readFileSync(path.join(root, 'shared.ts'), 'utf8') !== rootShared) throw new Error('Child audit changed root contents')
  const result = { worktreeJob: 'completed', creation: 'real_dialog_workspace_only', creationSubmissions: submission.calls, dialogDropdown: dropdownLayout, dialogLayout, childWorkspaceID: job.workspace.id, realGitMembership: true, exactSidebarSelection: true, isolatedFileTrees: true, isolatedSameNameEditorBuffers: true, editorGroupsRestored: true, rootContentsRetained: true, nativeSessions: chatResult, conversationRename: provider ? 'server_persisted_child_scope_wrong_scope_rejected_idle_no_turn' : 'skipped_no_registered_native_codex', providerTurns: 0, alignment, toolMenu, inspectorAudit }
  fs.writeFileSync(path.join(reports, 'multi-worktree-smoke-result.json'), JSON.stringify(result, null, 2))
  return result
}

module.exports = { auditMultiWorktree }
