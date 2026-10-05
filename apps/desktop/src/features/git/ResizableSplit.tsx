import { useState, useRef, useEffect, useCallback } from 'react'

export interface ResizableSplitProps {
  left: React.ReactNode
  right: React.ReactNode
  defaultLeftWidth?: number
  minLeftWidth?: number
  maxLeftWidth?: number
  minRightWidth?: number
  stackBelowWidth?: number
  storageKey?: string
}

function readStoredWidth(key: string, fallback: number): number {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) {
      const parsed = Number(stored)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  } catch {
    // localStorage unavailable
  }
  return fallback
}

export function ResizableSplit({
  left,
  right,
  defaultLeftWidth = 300,
  minLeftWidth = 200,
  maxLeftWidth = 500,
  minRightWidth = 320,
  stackBelowWidth = 720,
  storageKey = 'git-tab-split-width',
}: ResizableSplitProps) {
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredWidth(storageKey, defaultLeftWidth),
  )
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const stacked = containerWidth > 0 && containerWidth < stackBelowWidth
  const availableLeft = containerWidth > 0 ? Math.max(minLeftWidth, containerWidth - minRightWidth - 1) : maxLeftWidth
  const effectiveLeftWidth = Math.max(minLeftWidth, Math.min(leftWidth, maxLeftWidth, availableLeft))

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) {
        dragging.current = false
        setContainerWidth(width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
  }, [])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      let newWidth = e.clientX - rect.left
      newWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, rect.width > 0 ? rect.width - minRightWidth - 1 : maxLeftWidth, newWidth))
      setLeftWidth(newWidth)
    }

    function onMouseUp() {
      if (!dragging.current) return
      dragging.current = false
      // persist on release
      try {
        localStorage.setItem(storageKey, String(leftWidth))
      } catch {
        // localStorage unavailable
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [minLeftWidth, maxLeftWidth, minRightWidth, storageKey, leftWidth])

  return (
    <div ref={containerRef} data-layout={stacked ? 'stacked' : 'side-by-side'} className={`flex flex-1 overflow-hidden min-h-0 min-w-0 ${stacked ? 'flex-col' : ''}`}>
      <div
        data-panel="left"
        className="shrink-0 overflow-auto min-h-0 min-w-0"
        style={stacked ? { width: '100%', height: '42%' } : { width: `${effectiveLeftWidth}px` }}
      >
        {left}
      </div>

      <div
        role="separator"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        className={stacked ? 'h-px w-full shrink-0 bg-border/40' : 'w-px shrink-0 bg-border/40 hover:bg-primary/40 cursor-col-resize transition-colors'}
        onMouseDown={stacked ? undefined : onMouseDown}
      />

      <div data-panel="right" className="flex-1 overflow-auto min-w-0 min-h-0">
        {right}
      </div>
    </div>
  )
}
