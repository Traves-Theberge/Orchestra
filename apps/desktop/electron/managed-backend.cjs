// Observe immediately after spawn: asynchronous launch errors must not escape
// the startup boundary, even when no process was created.
function observeManagedBackend(child) {
  let failure = null
  let reportFailure
  const failed = new Promise((resolve) => { reportFailure = resolve })
  const recordFailure = (error) => {
    if (!failure) {
      failure = error
      reportFailure(error)
    }
  }
  child.on('error', recordFailure)
  child.once('exit', (code, signal) => {
    recordFailure(new Error(`backend exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
  })
  return { failed, get failure() { return failure } }
}

async function waitForManagedBackendReady(baseUrl, token, child, observation, {
  timeoutMs = 20000,
  pollIntervalMs = 250,
  fetchState = fetch,
} = {}) {
  const controller = new AbortController()
  let timeout
  let pollTimer
  let lastError = 'no response yet'
  const check = async () => {
    while (!controller.signal.aborted) {
      if (observation.failure) throw observation.failure
      if (child.exitCode !== null || child.signalCode != null) {
        throw new Error(`backend exited with ${child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`}`)
      }
      try {
        const response = await fetchState(new URL('/api/v1/state', baseUrl), {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (observation.failure) throw observation.failure
        if (response.ok) return
        lastError = `status ${response.status}`
      } catch (error) {
        if (observation.failure) throw observation.failure
        lastError = error instanceof Error ? error.message : String(error)
      }
      if (!controller.signal.aborted) {
        await new Promise((resolve) => {
          const finish = () => {
            controller.signal.removeEventListener('abort', finish)
            clearTimeout(pollTimer)
            resolve()
          }
          pollTimer = setTimeout(finish, pollIntervalMs)
          controller.signal.addEventListener('abort', finish, { once: true })
        })
      }
    }
  }
  try {
    await Promise.race([
      check(),
      observation.failed.then((error) => { throw error }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`managed backend health check timed out: ${lastError}`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
    clearTimeout(pollTimer)
    controller.abort()
  }
}

const backendStops = new WeakMap()

function stopManagedBackendChild(child, graceMs = 1200, postKillWaitMs = 1000) {
  if (!child) return Promise.resolve()
  const existing = backendStops.get(child)
  if (existing) return existing
  if (!child.pid || child.exitCode !== null || child.signalCode != null) return Promise.resolve()
  const pending = new Promise((resolve, reject) => {
    let timer
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    const onExit = () => finish()
    const waitForExit = (failure) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Give queued child exit notifications a poll turn before deciding
        // that a false signal result meant refusal rather than prior exit.
        setImmediate(() => {
          if (child.exitCode !== null || child.signalCode != null) finish()
          else finish(failure)
        })
      }, postKillWaitMs)
    }
    child.once('exit', onExit)
    timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode != null) {
        finish()
        return
      }
      waitForExit(new Error(`backend ${child.pid} did not exit after SIGKILL within ${postKillWaitMs}ms`))
      try {
        if (!child.kill('SIGKILL') && !settled) {
          waitForExit(new Error(`backend ${child.pid} refused SIGKILL and no exit was observed`))
        }
      } catch (error) { finish(error) }
    }, graceMs)
    try {
      if (!child.kill('SIGTERM') && !settled) {
        waitForExit(new Error(`backend ${child.pid} refused SIGTERM and no exit was observed`))
      }
    } catch (error) { finish(error) }
  })
  backendStops.set(child, pending)
  const forget = () => { backendStops.delete(child) }
  pending.then(forget, forget)
  return pending
}

async function prepareManagedBackend(baseUrl, token, child, observation, options) {
  try {
    await waitForManagedBackendReady(baseUrl, token, child, observation, options)
  } catch (error) {
    try {
      await stopManagedBackendChild(child, options?.graceMs, options?.postKillWaitMs)
    } catch (cleanupError) {
      console.error('Failed to stop backend after startup failure:', cleanupError)
    }
    throw error
  }
}

module.exports = { observeManagedBackend, waitForManagedBackendReady, stopManagedBackendChild, prepareManagedBackend }
