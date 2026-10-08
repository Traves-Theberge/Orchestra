import { describe, expect, it, vi } from 'vitest'
import { createSizeReporter, createStableFit, type GridSize } from './terminal-fit'

function harness(opts: { proposals: Array<GridSize | undefined>; current?: GridSize; measurable?: () => boolean; maxFrames?: number }) {
    const frames: Array<() => void> = []
    let proposalIndex = 0
    const fit = vi.fn()
    const stable = createStableFit({
        propose: () => opts.proposals[Math.min(proposalIndex++, opts.proposals.length - 1)],
        current: () => opts.current ?? { cols: 80, rows: 24 },
        fit,
        isMeasurable: opts.measurable ?? (() => true),
        raf: cb => frames.push(cb),
        cancelRaf: () => { frames.length = 0 },
        maxFrames: opts.maxFrames,
    })
    const step = () => frames.shift()?.()
    return { stable, fit, step, frames }
}

describe('createStableFit', () => {
    it('fits once after the proposed grid stops changing', () => {
        const a = { cols: 100, rows: 30 }
        const b = { cols: 120, rows: 30 }
        // initial propose=a, frame1 -> b (changed), frame2 -> b (stable)
        const h = harness({ proposals: [a, b, b] })
        h.stable.request()
        h.step()
        expect(h.fit).not.toHaveBeenCalled()
        h.step()
        expect(h.fit).toHaveBeenCalledTimes(1)
        expect(h.frames).toHaveLength(0)
    })

    it('coalesces overlapping requests', () => {
        const g = { cols: 100, rows: 30 }
        const h = harness({ proposals: [g] })
        h.stable.request()
        h.stable.request()
        h.stable.request()
        expect(h.frames).toHaveLength(1)
        h.step()
        expect(h.fit).toHaveBeenCalledTimes(1)
    })

    it('stops waiting after the frame budget', () => {
        let n = 90
        const h = harness({ proposals: Array.from({ length: 20 }, () => ({ cols: n++, rows: 30 })), maxFrames: 3 })
        h.stable.request()
        for (let i = 0; i < 10; i++) h.step()
        expect(h.fit).toHaveBeenCalledTimes(1)
    })

    it('does nothing for hidden or zero-size containers', () => {
        let measurable = false
        const h = harness({ proposals: [{ cols: 100, rows: 30 }], measurable: () => measurable })
        h.stable.request()
        expect(h.frames).toHaveLength(0)
        measurable = true
        h.stable.request()
        measurable = false
        h.step()
        expect(h.fit).not.toHaveBeenCalled()
    })

    it('cancel drops the pending fit', () => {
        const h = harness({ proposals: [{ cols: 100, rows: 30 }] })
        h.stable.request()
        h.stable.cancel()
        h.step()
        expect(h.fit).not.toHaveBeenCalled()
    })
})

describe('createSizeReporter', () => {
    it('only reports changed, sane sizes and resends after reset', () => {
        const send = vi.fn()
        const r = createSizeReporter(send)
        r.report({ cols: 80, rows: 24 })
        r.report({ cols: 80, rows: 24 })
        r.report({ cols: 100, rows: 24 })
        r.report({ cols: 1, rows: 24 })
        expect(send.mock.calls.map(c => c[0])).toEqual([{ cols: 80, rows: 24 }, { cols: 100, rows: 24 }])
        r.reset()
        r.report({ cols: 100, rows: 24 })
        expect(send).toHaveBeenCalledTimes(3)
    })
})
