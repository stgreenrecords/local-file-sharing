/** Display formatting. Kept in shared so main-side logs match the UI. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/** Binary-prefixed sizes with decimal-looking labels, matching the designs. */
export function formatBytes(bytes: number, digits?: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--'
  if (bytes === 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  const places = digits ?? (i === 0 ? 0 : value >= 100 ? 0 : 1)
  return `${value.toFixed(places)} ${UNITS[i]}`
}

/** Splits a size so the unit can be styled separately from the number. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const formatted = formatBytes(bytes)
  const gap = formatted.lastIndexOf(' ')
  if (gap < 0) return { value: formatted, unit: '' }
  return { value: formatted.slice(0, gap), unit: formatted.slice(gap + 1) }
}

export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return '--'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** `HH:MM:SS`, used by the queue's countdown. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function formatEta(bytesRemaining: number, bps: number | null): string {
  if (bps === null || bps <= 0) return '--:--:--'
  return formatDuration(bytesRemaining / bps)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Nov 14, 2024`, or `Yesterday 18:24` / `14:02` for recent entries. */
export function formatMtime(mtimeMs: number, now = Date.now()): string {
  if (!mtimeMs) return '--'
  const d = new Date(mtimeMs)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000
  if (mtimeMs >= startOfToday.getTime()) return time
  if (mtimeMs >= startOfToday.getTime() - dayMs) return `Yesterday ${time}`
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`
}

export function formatLatency(rttMs: number | null): string {
  if (rttMs === null) return '--'
  return rttMs < 10 ? `${rttMs.toFixed(1)} ms` : `${Math.round(rttMs)} ms`
}

/** Latency colour bands from the design: green <20ms, amber <100ms, rose above. */
export function latencyTone(rttMs: number | null): 'secondary' | 'warning' | 'danger' | 'muted' {
  if (rttMs === null) return 'muted'
  if (rttMs < 20) return 'secondary'
  if (rttMs < 100) return 'warning'
  return 'danger'
}

export function formatPin(pin: string | null): string {
  if (!pin) return '------'
  return pin.length === 6 ? `${pin.slice(0, 3)}-${pin.slice(3)}` : pin
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (done / total) * 100))
}
