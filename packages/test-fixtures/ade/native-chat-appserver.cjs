// Deterministic protocol fixture. Never launches an agent, reads credentials, or edits projects.
const readline = require('node:readline')
const crypto = require('node:crypto')
const output = value => process.stdout.write(JSON.stringify(value) + '\n')
let thread = '', turn = '', counter = 0, pending = null
const processID = crypto.randomUUID()
const event = (method, params) => output({ method, params })
const complete = (status = 'completed', text = 'Fixture response: the desktop request reached the native protocol.', lateUsage = false) => {
  let usagePayload
  if (status === 'completed') {
    event('item/agentMessage/delta', { threadId: thread, turnId: turn, itemId: 'answer-' + turn, delta: text })
    const usage = { inputTokens: 10, outputTokens: 12, totalTokens: 22, cachedInputTokens: 0, reasoningOutputTokens: 0 }
    usagePayload = { threadId: thread, turnId: turn, tokenUsage: { last: usage, total: { ...usage, totalTokens: counter * 22, inputTokens: counter * 10, outputTokens: counter * 12 }, modelContextWindow: 10000 } }
    if (!lateUsage) event('thread/tokenUsage/updated', usagePayload)
  }
  event('turn/completed', { threadId: thread, turn: { id: turn, status } })
  if (lateUsage && usagePayload) setTimeout(() => event('thread/tokenUsage/updated', usagePayload), 1500)
  pending = null
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  const reply = result => output({ id: message.id, result })
  switch (message.method) {
    case 'initialize': reply({ userAgent: 'Orchestra isolated UI fixture' }); break
    case 'initialized': break
    case 'account/read': reply({ account: null, requiresOpenaiAuth: false }); break
    case 'model/list': reply({ data: [{ id: 'fixture', model: 'fixture-model', displayName: 'Protocol fixture', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Fixture' }], inputModalities: ['text'] }], nextCursor: null }); break
    case 'thread/start':
    case 'thread/resume':
      thread = message.params.threadId || 'fixture-' + crypto.randomUUID()
      reply({ thread: { id: thread }, model: 'fixture-model', reasoningEffort: 'medium', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } }); break
    case 'turn/start': {
      turn = `fixture-turn-${processID}-${++counter}`
      reply({ turn: { id: turn } })
      event('turn/started', { threadId: thread, turn: { id: turn } })
      const prompt = (message.params.input || []).map(item => item.text || '').join('\n')
      if (prompt.includes('approval')) {
        pending = 'fixture-approval-' + counter
        output({ id: pending, method: 'item/commandExecution/requestApproval', params: { threadId: thread, turnId: turn, itemId: 'command-' + turn, command: 'fixture: no shell command will run', reason: 'Verify the desktop approval boundary' } })
      } else if (prompt.includes('interrupt')) {
        event('item/agentMessage/delta', { threadId: thread, turnId: turn, itemId: 'answer-' + turn, delta: 'Fixture waiting for interruption.' })
      } else complete('completed', 'Fixture response: the desktop request reached the native protocol.', prompt.includes('late usage'))
      break
    }
    case 'turn/interrupt': reply({}); complete('interrupted'); break
    default:
      if (!message.method && message.id === pending) complete('completed', 'Fixture approval received: ' + message.result?.decision + '. No command ran.')
  }
})
