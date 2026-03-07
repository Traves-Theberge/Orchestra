export function getNextSidebarIndex(key: string, currentIndex: number, total: number): number | null {
  if (total <= 0) {
    return null
  }

  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return total - 1
  }

  if (key === 'ArrowDown') {
    return (currentIndex + 1) % total
  }

  if (key === 'ArrowUp') {
    return (currentIndex - 1 + total) % total
  }

  return null
}
