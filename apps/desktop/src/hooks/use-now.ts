import { useEffect, useState } from 'react'

/**
 * Returns the client-mount timestamp. Starts at 0 (matching SSR/initial render)
 * then updates to Date.now() after mount and on the provided interval, avoiding
 * hydration mismatches caused by Date.now()/new Date() during render.
 */
export function useNow(intervalMs?: number): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    if (!intervalMs) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
