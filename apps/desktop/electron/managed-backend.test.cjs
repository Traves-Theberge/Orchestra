const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const { tmpdir } = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { observeManagedBackend, prepareManagedBackend, stopManagedBackendChild } = require('./managed-backend.cjs')

function fakeChild(pid = 123) {
  const child = new EventEmitter()
  Object.assign(child, { pid, exitCode: null, signalCode: null, signals: [] })
  child.kill = (signal) => {
    child.signals.push(signal)
    queueMicrotask(() => {
      child.signalCode = signal
      child.emit('exit', null, signal)
    })
    return true
  }
  return child
}

test('denied launch retains the exact native error even before readiness starts', async () => {
  const child = fakeChild(undefined)
  child.pid = undefined
  const observation = observeManagedBackend(child)
  const denied = Object.assign(new Error('An Application Control policy has blocked this file.'), { code: 'EACCES' })
  child.emit('error', denied)
  await assert.rejects(prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: () => assert.fail('must not request health after denied spawn'),
  }), (error) => error === denied)
  assert.deepEqual(child.signals, [])
})

test('real nonexistent executable rejects with ENOENT without an unhandled child error', async () => {
  const child = spawn(path.join(tmpdir(), `orchestra-missing-${crypto.randomUUID()}.exe`), [], { stdio: 'ignore' })
  const observation = observeManagedBackend(child)
  await assert.rejects(prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: () => new Promise(() => {}), timeoutMs: 1000,
  }), (error) => error === observation.failure && error.code === 'ENOENT')
})

test('an error during a hung health request aborts it and stops the owned child', async () => {
  const child = fakeChild()
  const observation = observeManagedBackend(child)
  const denied = new Error('spawn denied')
  let requestSignal
  const pending = prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: (_url, options) => {
      requestSignal = options.signal
      return new Promise(() => {})
    }, timeoutMs: 1000,
  })
  child.emit('error', denied)
  await assert.rejects(pending, (error) => error === denied)
  assert.equal(requestSignal.aborted, true)
  assert.deepEqual(child.signals, ['SIGTERM'])
})

test('health timeout aborts a hung request and terminates only the owned child', async () => {
  const child = fakeChild()
  const observation = observeManagedBackend(child)
  let requestSignal
  await assert.rejects(prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: (_url, options) => {
      requestSignal = options.signal
      return new Promise(() => {})
    }, timeoutMs: 10,
  }), /managed backend health check timed out/)
  assert.equal(requestSignal.aborted, true)
  assert.deepEqual(child.signals, ['SIGTERM'])
})

test('early signal exit rejects readiness without waiting for the health timeout', async () => {
  const child = fakeChild()
  const observation = observeManagedBackend(child)
  const pending = prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: () => new Promise(() => {}), timeoutMs: 1000,
  })
  child.signalCode = 'SIGTERM'
  child.emit('exit', null, 'SIGTERM')
  await assert.rejects(pending, /backend exited with signal SIGTERM/)
  assert.deepEqual(child.signals, [])
})

test('healthy backend returns successfully and is not terminated', async () => {
  const child = fakeChild()
  const observation = observeManagedBackend(child)
  await prepareManagedBackend('http://localhost:1', 'test', child, observation, {
    fetchState: async (url, options) => {
      assert.equal(url.pathname, '/api/v1/state')
      assert.equal(options.headers.Authorization, 'Bearer test')
      return { ok: true }
    },
  })
  assert.deepEqual(child.signals, [])
})

test('stop escalates after grace and removes its exit observer', async () => {
  const child = fakeChild()
  child.kill = (signal) => {
    child.signals.push(signal)
    if (signal === 'SIGKILL') {
      setTimeout(() => {
        child.signalCode = signal
        child.emit('exit', null, signal)
      }, 10)
    }
    return true
  }
  const before = child.listenerCount('exit')
  await stopManagedBackendChild(child, 10, 100)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.signalCode, 'SIGKILL')
  assert.equal(child.listenerCount('exit'), before)
})

test('cleanup failure does not replace the original startup error', async (t) => {
  const child = fakeChild()
  child.kill = () => { throw new Error('kill denied') }
  const observation = observeManagedBackend(child)
  const failure = new Error('original launch failure')
  child.emit('error', failure)
  const log = t.mock.method(console, 'error', () => {})
  await assert.rejects(prepareManagedBackend('http://localhost:1', 'test', child, observation), (error) => error === failure)
  assert.equal(log.mock.calls.length, 1)
  assert.equal(child.listenerCount('exit'), 1)
})

test('a false termination result is reported as cleanup failure', async () => {
  const child = fakeChild()
  child.kill = () => false
  await assert.rejects(stopManagedBackendChild(child, 10, 10), /refused SIGTERM/)
  assert.equal(child.listenerCount('exit'), 0)
})

test('a refused force kill reports failure without claiming exit', async () => {
  const child = fakeChild()
  child.kill = (signal) => signal !== 'SIGKILL'
  await assert.rejects(stopManagedBackendChild(child, 10, 10), /refused SIGKILL/)
  assert.equal(child.exitCode, null)
  assert.equal(child.signalCode, null)
  assert.equal(child.listenerCount('exit'), 0)
})

test('a child that accepts signals but never exits fails within the post-kill budget', async () => {
  const child = fakeChild()
  child.kill = (signal) => { child.signals.push(signal); return true }
  await assert.rejects(stopManagedBackendChild(child, 10, 10), /did not exit after SIGKILL within 10ms/)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('failed termination preserves the original startup error and reports cleanup failure', async (t) => {
  const child = fakeChild()
  child.kill = () => false
  const observation = observeManagedBackend(child)
  const failure = new Error('original denied launch')
  child.emit('error', failure)
  const log = t.mock.method(console, 'error', () => {})
  await assert.rejects(prepareManagedBackend('http://localhost:1', 'test', child, observation), (error) => error === failure)
  assert.match(log.mock.calls[0].arguments[1].message, /refused SIGTERM/)
})

test('real owned Node child shutdown returns only after observed process exit', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  let observedExit = false
  child.once('exit', () => { observedExit = true })
  await stopManagedBackendChild(child, 100, 1000)
  assert.equal(observedExit, true)
  assert.ok(child.exitCode !== null || child.signalCode !== null)
})

test('concurrent stop callers share one operation and settled stop is idempotent', async () => {
  const child = fakeChild()
  child.kill = (signal) => {
    child.signals.push(signal)
    setImmediate(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
    })
    return true
  }
  const first = stopManagedBackendChild(child, 100, 100)
  const second = stopManagedBackendChild(child, 100, 100)
  assert.equal(first, second)
  await Promise.all([first, second])
  await stopManagedBackendChild(child, 100, 100)
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('false SIGTERM waits for an already pending exit instead of reporting refusal', async () => {
  const child = fakeChild()
  child.kill = (signal) => {
    child.signals.push(signal)
    setImmediate(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
    })
    return false
  }
  await stopManagedBackendChild(child, 10, 100)
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(child.exitCode, 0)
})

test('false SIGKILL waits for pending exit and does not send duplicate signals', async () => {
  const child = fakeChild()
  child.kill = (signal) => {
    child.signals.push(signal)
    if (signal === 'SIGTERM') return true
    setImmediate(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
    })
    return false
  }
  await Promise.all([stopManagedBackendChild(child, 10, 100), stopManagedBackendChild(child, 10, 100)])
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.exitCode, 0)
})
