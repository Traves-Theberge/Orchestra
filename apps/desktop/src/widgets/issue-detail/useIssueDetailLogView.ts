import { useEffect, useMemo, useRef, useState } from 'react'

export function useIssueDetailLogView({ logs }: { logs: string }) {
  const [logFilter, setLogFilter] = useState('')
  const [followLogs, setFollowLogs] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs
    return logs
      .split('\n')
      .filter((line) => line.toLowerCase().includes(logFilter.toLowerCase()))
      .join('\n')
  }, [logs, logFilter])

  useEffect(() => {
    if (followLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [filteredLogs, followLogs])

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50
    if (!isAtBottom && followLogs) {
      setFollowLogs(false)
    }
  }

  return {
    logFilter,
    setLogFilter,
    followLogs,
    setFollowLogs,
    logContainerRef,
    filteredLogs,
    handleLogScroll,
  }
}
