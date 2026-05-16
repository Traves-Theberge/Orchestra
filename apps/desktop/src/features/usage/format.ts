const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

export function formatNumber(n: number): string {
  return NUMBER_FORMAT.format(n)
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return formatNumber(n)
}

export function formatCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a'
  if (n < 0.01) return '$' + n.toFixed(4)
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(2)
}

export function formatUpdatedAt(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Not scanned yet'
  return 'Updated ' + new Date(timestamp).toLocaleString()
}

export function formatSessionTime(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return t.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

