import { useEffect, useState } from 'react'

const EVENT = 'orchestra:agents-changed'

/** Tells every agent list (Agents page, composer picker, automations) to refetch. */
export function notifyAgentsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

/** A counter that increments whenever agents are created, edited or deleted; use it as an effect dependency. */
export function useAgentsRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const bump = () => setRevision(value => value + 1)
    window.addEventListener(EVENT, bump)
    return () => window.removeEventListener(EVENT, bump)
  }, [])
  return revision
}
