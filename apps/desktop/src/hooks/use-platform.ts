import { useState, useEffect } from 'react'

export function usePlatform() {
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    setIsMac(navigator.userAgent.toLowerCase().includes('mac'))
  }, [])

  return { isMac }
}
