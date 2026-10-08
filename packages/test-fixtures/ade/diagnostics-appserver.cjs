// Local protocol fixture for Diagnostics verification; never executes tools or reads credentials.
const readline = require('node:readline')
const { randomUUID } = require('node:crypto')
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const event = (method, params) => emit({ method, params })
let thread = '', turn = '', count = 0, pending = null
const processID = randomUUID()
function complete(status = 'completed') {
  if (status === 'completed') {
    event('item/agentMessage/delta', { threadId: thread, turnId: turn, itemId: 'answer-' + turn, delta: 'Local diagnostics fixture completed.' })
    const usage = { inputTokens: 10, outputTokens: 12, totalTokens: 22 }
    event('thread/tokenUsage/updated', { threadId: thread, turnId: turn, tokenUsage: { last: usage, total: { inputTokens: count * 10, outputTokens: count * 12, totalTokens: count * 22 }, modelContextWindow: 10000 } })
  }
  event('turn/completed', { threadId: thread, turn: { id: turn, status, ...(status === 'failed' ? { error: { message: 'Controlled fixture failure' } } : {}) } })
  pending = null
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  const reply = result => emit({ id: message.id, result })
  switch (message.method) {
    case 'initialize': reply({ userAgent: 'Local diagnostics fixture' }); break
    case 'initialized': break
    case 'account/read': reply({ account: null, requiresOpenaiAuth: false }); break
    case 'model/list': reply({ data: [{ id: 'fixture', model: 'fixture-model', displayName: 'Local fixture', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Fixture' }], inputModalities: ['text'] }], nextCursor: null }); break
    case 'thread/start':
    case 'thread/resume':
      thread = message.params.threadId || 'fixture-' + randomUUID()
      reply({ thread: { id: thread }, model: 'fixture-model', reasoningEffort: 'medium', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } }); break
    case 'turn/start': {
      turn = `fixture-turn-${processID}-${++count}`
      reply({ turn: { id: turn } })
      event('turn/started', { threadId: thread, turn: { id: turn } })
      const prompt = (message.params.input || []).map(item => item.text || '').join('\n')
      if (prompt.includes('approval')) {
        pending = 'approval-' + turn
        emit({ id: pending, method: 'item/commandExecution/requestApproval', params: { threadId: thread, turnId: turn, itemId: 'command-' + turn, command: 'no execution', reason: 'Local boundary verification' } })
      } else if (prompt.includes('interrupt')) {
        event('item/agentMessage/delta', { threadId: thread, turnId: turn, itemId: 'answer-' + turn, delta: 'Waiting for cancellation.' })
      } else if (prompt.includes('failure')) complete('failed')
      else {
        // Two observed overlapping lifetimes. Timers are fixture actions, never UI synchronization.
        const first = 'tool-a-' + turn, second = 'tool-b-' + turn
        for (const id of [first, second]) event('item/started', { threadId: thread, turnId: turn, item: { id, type: 'commandExecution', status: 'inProgress', command: 'PRIVATE_TOOL_ARGUMENT_SENTINEL' } })
        setTimeout(() => event('item/completed', { threadId: thread, turnId: turn, item: { id: first, type: 'commandExecution', status: 'completed', exitCode: 0, aggregatedOutput: 'PRIVATE_TOOL_RESULT_SENTINEL' } }), 80)
        setTimeout(() => {
          event('item/completed', { threadId: thread, turnId: turn, item: { id: second, type: 'commandExecution', status: 'completed', exitCode: 0 } })
          complete()
        }, 150)
      }
      break
    }
    case 'turn/interrupt': reply({}); complete('interrupted'); break
    default:
      if (!message.method && message.id === pending) complete()
  }
})
