/**
 * Cross-platform path arithmetic.
 *
 * A path always belongs to a node, and that node has a platform. `node:path` uses
 * the *host's* rules, which is wrong for every remote path, so all path work goes
 * through these helpers with an explicit platform.
 */
import type { NodePlatform } from './types'

export const sepFor = (platform: NodePlatform): string => (platform === 'win32' ? '\\' : '/')

const WIN_DRIVE = /^[a-zA-Z]:$/
const WIN_DRIVE_ROOT = /^[a-zA-Z]:[\\/]?$/

/** Splits on both separators — Windows accepts `/` and users paste it. */
const splitRaw = (p: string): string[] => p.split(/[\\/]+/)

export function isAbsoluteFor(platform: NodePlatform, p: string): boolean {
  if (platform === 'win32') {
    return WIN_DRIVE_ROOT.test(p.slice(0, 3)) || p.startsWith('\\\\') || p.startsWith('//')
  }
  return p.startsWith('/')
}

export function isRootFor(platform: NodePlatform, p: string): boolean {
  if (platform === 'win32') {
    if (WIN_DRIVE_ROOT.test(p)) return true
    // A UNC share root: \\server\share
    if (p.startsWith('\\\\')) return splitRaw(p.replace(/^\\\\/, '')).filter(Boolean).length <= 2
    return false
  }
  return p === '/'
}

/**
 * Joins segments using the platform's separator. Segments containing separators
 * are re-split, `.` is dropped and `..` pops — so `join('/a/b', '../c')` is `/a/c`.
 */
export function joinFor(platform: NodePlatform, base: string, ...parts: string[]): string {
  const sep = sepFor(platform)
  const isUnc = platform === 'win32' && (base.startsWith('\\\\') || base.startsWith('//'))
  const raw = [base, ...parts].flatMap(splitRaw)

  let prefix = ''
  const segments: string[] = []
  for (const [i, segRaw] of raw.entries()) {
    const seg = segRaw
    if (seg === '' ) {
      // Leading empties come from the root marker; keep only to reconstruct it.
      if (i === 0 && !isUnc && platform !== 'win32') prefix = '/'
      continue
    }
    if (seg === '.') continue
    if (seg === '..') {
      // Never pop past a drive letter, a UNC share root, or POSIX `/`.
      const floor = platform === 'win32' ? (isUnc ? 2 : 1) : 0
      if (segments.length > floor) segments.pop()
      continue
    }
    if (i === 0 && platform === 'win32' && WIN_DRIVE.test(seg)) {
      segments.push(seg)
      continue
    }
    segments.push(seg)
  }

  if (platform === 'win32') {
    if (isUnc) return '\\\\' + segments.join(sep)
    const [first, ...rest] = segments
    if (first !== undefined && WIN_DRIVE.test(first)) {
      return rest.length === 0 ? `${first}\\` : `${first}\\${rest.join(sep)}`
    }
    return segments.join(sep)
  }
  return prefix + segments.join(sep)
}

export function dirnameFor(platform: NodePlatform, p: string): string {
  if (isRootFor(platform, p)) return p
  const sep = sepFor(platform)
  const trimmed = p.replace(/[\\/]+$/, '')
  const segments = splitRaw(trimmed)
  segments.pop()

  if (platform === 'win32') {
    const [first] = segments
    if (segments.length === 0) return trimmed
    if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
      const parts = segments.filter(Boolean)
      return '\\\\' + parts.join(sep)
    }
    if (segments.length === 1 && first !== undefined && WIN_DRIVE.test(first)) return `${first}\\`
    return segments.join(sep)
  }
  const joined = segments.filter(Boolean).join('/')
  return joined === '' ? '/' : '/' + joined
}

export function basenameFor(platform: NodePlatform, p: string): string {
  if (isRootFor(platform, p)) return p
  const segments = splitRaw(p.replace(/[\\/]+$/, '')).filter(Boolean)
  return segments[segments.length - 1] ?? p
}

/** Breadcrumb segments: the root marker followed by each directory name. */
export function segmentsFor(
  platform: NodePlatform,
  p: string
): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = []
  const parts = splitRaw(p.replace(/[\\/]+$/, '')).filter(Boolean)

  if (platform === 'win32') {
    if (p.startsWith('\\\\') || p.startsWith('//')) {
      const [server, share, ...rest] = parts
      if (server === undefined) return out
      const shareRoot = share === undefined ? `\\\\${server}` : `\\\\${server}\\${share}`
      out.push({ label: shareRoot, path: shareRoot })
      let cursor = shareRoot
      for (const seg of rest) {
        cursor = `${cursor}\\${seg}`
        out.push({ label: seg, path: cursor })
      }
      return out
    }
    const [drive, ...rest] = parts
    if (drive === undefined) return out
    let cursor = `${drive}\\`
    out.push({ label: drive, path: cursor })
    for (const seg of rest) {
      cursor = joinFor(platform, cursor, seg)
      out.push({ label: seg, path: cursor })
    }
    return out
  }

  out.push({ label: '/', path: '/' })
  let cursor = ''
  for (const seg of parts) {
    cursor = `${cursor}/${seg}`
    out.push({ label: seg, path: cursor })
  }
  return out
}

/** Lowercase extension without the dot. Dotfiles and directories have none. */
export function extOf(name: string, isDir = false): string {
  if (isDir) return ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** Does this path's shape match the platform that claims to own it? */
export function looksNativeTo(platform: NodePlatform, p: string): boolean {
  if (p === '' || p.includes('\0')) return false
  return isAbsoluteFor(platform, p)
}

const WIN_ILLEGAL = /[\\/:*?"<>|]/g
const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

export interface SanitizeOptions {
  sanitizeWindowsNames: boolean
  normalizeUnicode: boolean
}

/**
 * Makes a single filename safe on the target platform. Only ever applied to a
 * leaf name — never to a whole path.
 */
export function sanitizeLeaf(
  name: string,
  target: NodePlatform,
  opts: SanitizeOptions
): string {
  let out = name
  if (opts.normalizeUnicode) {
    // macOS stores NFD, Windows/Linux expect NFC.
    out = out.normalize(target === 'darwin' ? 'NFD' : 'NFC')
  }
  if (target === 'win32' && opts.sanitizeWindowsNames) {
    out = out.replace(WIN_ILLEGAL, '_').replace(/[. ]+$/, '')
    if (WIN_RESERVED.test(out)) out = `_${out}`
    if (out === '') out = '_'
  }
  return out
}

/** Files the target platform treats as junk from the other OS. */
export function isPlatformJunk(name: string, target: NodePlatform): boolean {
  if (target === 'win32') return name === '.DS_Store' || name.startsWith('._')
  if (target === 'darwin') return name === 'desktop.ini' || name === 'Thumbs.db'
  return false
}

/**
 * Middle-ellipsis truncation. The design mandates this over tail truncation so
 * the root prefix and file extension both survive.
 */
export function middleEllipsis(value: string, max: number): string {
  if (value.length <= max || max < 8) return value
  const keep = max - 3
  const head = Math.ceil(keep * 0.55)
  const tail = keep - head
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`
}

/**
 * Applies a user-configured Windows<->POSIX mapping so the same logical folder
 * resolves on either node. Returns null when no mapping matches.
 */
export function applyMapping(
  path: string,
  from: NodePlatform,
  to: NodePlatform,
  mappings: Array<{ windows: string; posix: string }>
): string | null {
  if (from === to) return null
  const norm = (v: string): string => v.replace(/[\\/]+$/, '').toLowerCase()
  for (const m of mappings) {
    const src = from === 'win32' ? m.windows : m.posix
    const dst = to === 'win32' ? m.windows : m.posix
    if (!src || !dst) continue
    if (norm(path) === norm(src)) return dst
    const prefix = norm(src) + (from === 'win32' ? '\\' : '/')
    if (norm(path).startsWith(prefix)) {
      const rest = path.slice(src.replace(/[\\/]+$/, '').length + 1)
      return joinFor(to, dst, ...rest.split(/[\\/]+/))
    }
  }
  return null
}
