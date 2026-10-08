import { describe, expect, it, vi } from 'vitest'
import { createOutputBatcher, type Scheduler } from './terminal-output'

function manualScheduler() {
    const jobs: Array<() => void> = []
    const schedule: Scheduler = cb => {
        jobs.push(cb)
        return () => { const i = jobs.indexOf(cb); if (i >= 0) jobs.splice(i, 1) }
    }
    return { schedule, jobs, run: () => jobs.splice(0).forEach(j => j()) }
}

const bytes = (...n: number[]) => Uint8Array.from(n)

describe('createOutputBatcher', () => {
    it('coalesces chunks into one ordered write per frame', () => {
        const write = vi.fn()
        const s = manualScheduler()
        const b = createOutputBatcher(write, s.schedule)
        b.push(bytes(1, 2))
        b.push(bytes(3))
        b.push(bytes(4, 5))
        expect(s.jobs).toHaveLength(1)
        expect(write).not.toHaveBeenCalled()
        s.run()
        expect(write).toHaveBeenCalledTimes(1)
        expect([...write.mock.calls[0][0]]).toEqual([1, 2, 3, 4, 5])
    })

    it('keeps split multi-byte UTF-8 sequences intact across chunks', () => {
        const write = vi.fn()
        const s = manualScheduler()
        const b = createOutputBatcher(write, s.schedule)
        const euro = new TextEncoder().encode('€')
        b.push(euro.subarray(0, 1))
        b.push(euro.subarray(1))
        s.run()
        expect(new TextDecoder().decode(write.mock.calls[0][0])).toBe('€')
    })

    it('splits oversized batches at the write cap, preserving order', () => {
        const write = vi.fn()
        const s = manualScheduler()
        const b = createOutputBatcher(write, s.schedule, 4)
        b.push(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
        s.run()
        expect(write.mock.calls.map(c => [...c[0]])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]])
    })

    it('flush writes immediately and cancels the scheduled frame', () => {
        const write = vi.fn()
        const s = manualScheduler()
        const b = createOutputBatcher(write, s.schedule)
        b.push(bytes(9))
        b.flush()
        expect(write).toHaveBeenCalledTimes(1)
        expect(s.jobs).toHaveLength(0)
        b.flush()
        expect(write).toHaveBeenCalledTimes(1)
    })

    it('ignores empty chunks and drops queued data on dispose', () => {
        const write = vi.fn()
        const s = manualScheduler()
        const b = createOutputBatcher(write, s.schedule)
        b.push(new Uint8Array(0))
        expect(s.jobs).toHaveLength(0)
        b.push(bytes(1))
        b.dispose()
        s.run()
        expect(write).not.toHaveBeenCalled()
    })
})
