// Coalescing cap per xterm.write call: large enough to amortize parse overhead, small enough to
// keep one frame's parse work bounded (Orca drains in ~64 KB batches).
export const OUTPUT_WRITE_MAX_BYTES = 64 * 1024

export type Cancel = () => void
export type Scheduler = (cb: () => void) => Cancel

// rAF gives one write per painted frame; the timer fallback keeps output flowing while the
// window is hidden (rAF is paused) so parked sessions never back up.
const defaultScheduler: Scheduler = cb => {
    let done = false
    const run = () => {
        if (done) return
        done = true
        cancelAnimationFrame(frame)
        clearTimeout(timer)
        cb()
    }
    const frame = requestAnimationFrame(run)
    const timer = setTimeout(run, 50)
    return () => {
        done = true
        cancelAnimationFrame(frame)
        clearTimeout(timer)
    }
}

export interface OutputBatcher {
    push: (chunk: Uint8Array) => void
    /** Write everything queued right now. */
    flush: () => void
    dispose: () => void
}

/**
 * Batches PTY output into one ordered write per frame. Chunks stay binary so multi-byte UTF-8
 * sequences split across WebSocket frames are decoded by xterm, not by us.
 */
export function createOutputBatcher(write: (data: Uint8Array) => void, schedule: Scheduler = defaultScheduler, maxWriteBytes = OUTPUT_WRITE_MAX_BYTES): OutputBatcher {
    let queue: Uint8Array[] = []
    let queued = 0
    let cancel: Cancel | null = null

    const flush = () => {
        cancel?.()
        cancel = null
        if (queued === 0) return
        const chunks = queue
        const total = queued
        queue = []
        queued = 0
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
            merged.set(chunk, offset)
            offset += chunk.byteLength
        }
        for (let start = 0; start < total; start += maxWriteBytes) {
            write(merged.subarray(start, Math.min(total, start + maxWriteBytes)))
        }
    }

    return {
        push(chunk) {
            if (chunk.byteLength === 0) return
            queue.push(chunk)
            queued += chunk.byteLength
            if (!cancel) cancel = schedule(flush)
        },
        flush,
        dispose() {
            cancel?.()
            cancel = null
            queue = []
            queued = 0
        },
    }
}
