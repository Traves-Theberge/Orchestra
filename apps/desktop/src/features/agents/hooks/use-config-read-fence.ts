import { useCallback, useLayoutEffect, useRef } from 'react'

// A read belongs to its backend credentials, provider and configuration scope.
// Invalidate pending work at commit, before the next scope's fetch effect runs.
export function useConfigReadFence(target: string) {
  const currentTarget = useRef(target)
  const sequence = useRef(0)
  useLayoutEffect(() => {
    currentTarget.current = target
    return () => { sequence.current += 1 }
  }, [target])
  return useCallback(() => {
    const request = ++sequence.current
    return () => currentTarget.current === target && sequence.current === request
  }, [target])
}
