export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never'
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDuration(fromIso: string, toIso: string | null, now = Date.now()) {
  const seconds = Math.max(0, Math.round(((toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`
}
