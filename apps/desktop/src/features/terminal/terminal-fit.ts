export interface GridSize {
    cols: number
    rows: number
}

export interface StableFitDeps {
    /** FitAddon.proposeDimensions(); undefined when the container cannot be measured. */
    propose: () => GridSize | undefined
    /** Current xterm grid. */
    current: () => GridSize
    /** Fit the xterm grid to the container. */
    fit: () => void
    /** False while the container is hidden or zero-sized. */
    isMeasurable: () => boolean
    raf?: (cb: () => void) => number
    cancelRaf?: (id: number) => void
    maxFrames?: number
}

export interface StableFit {
    request: () => void
    cancel: () => void
}

const sameSize = (a: GridSize | undefined, b: GridSize | undefined) => a?.cols === b?.cols && a?.rows === b?.rows

/**
 * Orca's requestStablePaneFit: wait until the proposed grid stops changing between animation frames
 * (bounded) before fitting once. Layout churn from panel drags or scrollbar wobble then costs a single
 * PTY resize instead of a SIGWINCH storm that makes TUIs redraw ghost frames.
 */
export function createStableFit(deps: StableFitDeps): StableFit {
    const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(cb))
    const cancelRaf = deps.cancelRaf ?? ((id: number) => cancelAnimationFrame(id))
    const maxFrames = deps.maxFrames ?? 8
    let pending: number | null = null

    const settle = () => {
        pending = null
        if (deps.isMeasurable()) deps.fit()
    }

    const request = () => {
        if (pending !== null || !deps.isMeasurable()) return
        let previous = deps.propose()
        let frames = 0
        const wait = () => {
            pending = raf(() => {
                if (!deps.isMeasurable()) {
                    pending = null
                    return
                }
                const next = deps.propose()
                frames += 1
                // Equal to the live grid, unmeasurable, or stable for one frame: done.
                if (!next || sameSize(next, deps.current()) || sameSize(previous, next) || frames >= maxFrames) {
                    settle()
                    return
                }
                previous = next
                wait()
            })
        }
        wait()
    }

    const cancel = () => {
        if (pending !== null) cancelRaf(pending)
        pending = null
    }

    return { request, cancel }
}

/** Forwards grid sizes to the PTY only when they actually changed. */
export function createSizeReporter(send: (size: GridSize) => void) {
    let last: GridSize | null = null
    return {
        report(size: GridSize) {
            if (size.cols < 2 || size.rows < 1 || sameSize(last ?? undefined, size)) return
            last = { cols: size.cols, rows: size.rows }
            send(last)
        },
        /** Forget the last size so the next report is sent (new socket, new PTY). */
        reset() {
            last = null
        },
    }
}
