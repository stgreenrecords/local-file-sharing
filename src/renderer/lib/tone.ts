/**
 * Tailwind's scanner only sees literal class names, so every tone -> class map
 * must be spelled out here rather than interpolated at the call site.
 */
import type { TransferStatus } from '@shared/types'

export const LATENCY_TEXT: Record<'secondary' | 'warning' | 'danger' | 'muted', string> = {
  secondary: 'text-secondary',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-outline'
}

export const STATUS_TEXT: Record<TransferStatus, string> = {
  queued: 'text-on-surface-variant',
  active: 'text-primary',
  done: 'text-secondary',
  failed: 'text-danger',
  skipped: 'text-on-surface-variant',
  cancelled: 'text-outline',
  'awaiting-decision': 'text-warning'
}

export const STATUS_LABEL: Record<TransferStatus, string> = {
  queued: 'Queued',
  active: 'Transferring',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
  'awaiting-decision': 'Needs a decision'
}

/** Icon for a file row, chosen from the extension. */
export function iconForEntry(name: string, ext: string, isDir: boolean): string {
  if (isDir) return 'folder'
  const groups: Record<string, string[]> = {
    movie: ['mov', 'mp4', 'mkv', 'avi', 'mxf', 'prores', 'webm', 'm4v'],
    music_note: ['wav', 'aiff', 'aif', 'mp3', 'flac', 'aac', 'stem', 'm4a'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'webp', 'heic', 'exr', 'dpx'],
    description: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'],
    data_object: ['json', 'yaml', 'yml', 'toml', 'xml', 'plist'],
    code: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'sh', 'ps1'],
    folder_zip: ['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'dmg', 'iso'],
    palette: ['cube', 'lut', 'icc', 'ase'],
    table: ['csv', 'tsv', 'xlsx', 'db', 'sqlite']
  }
  for (const [icon, extensions] of Object.entries(groups)) {
    if (extensions.includes(ext)) return icon
  }
  if (name.startsWith('.')) return 'settings'
  return 'draft'
}

/** Extension-label colour, so a listing scans by type at a glance. */
export function extTone(ext: string): string {
  if (['mov', 'mp4', 'mkv', 'mxf', 'avi', 'webm'].includes(ext)) return 'text-tertiary'
  if (['wav', 'aiff', 'aif', 'mp3', 'flac', 'stem'].includes(ext)) return 'text-secondary'
  if (['png', 'jpg', 'jpeg', 'exr', 'tiff', 'dpx', 'heic'].includes(ext)) return 'text-primary'
  if (['json', 'yaml', 'yml', 'xml', 'toml'].includes(ext)) return 'text-warning'
  return 'text-on-surface-variant'
}
