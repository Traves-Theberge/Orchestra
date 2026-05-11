import { useEffect } from 'react'
import { useAppStore } from '@core/store'

/**
 * Publish a panel's dirty state to the global agent hub registry
 * so the dashboard can intercept navigation with a confirm dialog.
 *
 * Call this with the panel's local `dirty` boolean.
 */
export function usePublishDirty(dirty: boolean) {
  const setAgentHubDirty = useAppStore((s) => s.setAgentHubDirty)
  useEffect(() => {
    setAgentHubDirty(dirty)
    return () => {
      setAgentHubDirty(false)
    }
  }, [dirty, setAgentHubDirty])
}
