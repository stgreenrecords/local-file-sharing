/**
 * Volume enumeration, per platform, with no native dependencies.
 *
 * Sizes always come from `fs.statfs`. Labels and filesystem names come from a
 * cheap platform shell-out that is allowed to fail — a volume with an unknown
 * label still lists, it just shows its mount path.
 */
import { execFile } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { NodePlatform, Volume, VolumeKind } from '@shared/types'

const exec = promisify(execFile)

/** Volume metadata changes rarely; sizes change constantly but not per-keystroke. */
const CACHE_MS = 4000
let cache: { at: number; volumes: Volume[] } | null = null

export async function localVolumes(): Promise<Volume[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.volumes
  const platform = process.platform as NodePlatform
  const volumes =
    platform === 'win32'
      ? await windowsVolumes()
      : platform === 'darwin'
        ? await macVolumes()
        : await linuxVolumes()
  cache = { at: Date.now(), volumes }
  return volumes
}

export function invalidateVolumeCache(): void {
  cache = null
}

async function sizeOf(path: string): Promise<{ totalBytes: number; freeBytes: number }> {
  try {
    const s = await fsp.statfs(path)
    const block = Number(s.bsize)
    return {
      totalBytes: Number(s.blocks) * block,
      // `bavail` is what a non-root user can actually use.
      freeBytes: Number(s.bavail) * block
    }
  } catch {
    return { totalBytes: 0, freeBytes: 0 }
  }
}

/* ── Windows ─────────────────────────────────────────────────────────── */

const WIN_DRIVE_TYPE: Record<number, VolumeKind> = {
  2: 'removable',
  3: 'fixed',
  4: 'network',
  5: 'removable' /* optical — treated as removable media */
}

interface WinDisk {
  DeviceID?: string
  VolumeName?: string
  FileSystem?: string
  DriveType?: number
}

async function windowsDiskMeta(): Promise<Map<string, WinDisk>> {
  const out = new Map<string, WinDisk>()
  try {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance -ClassName Win32_LogicalDisk | ' +
          'Select-Object DeviceID,VolumeName,FileSystem,DriveType | ConvertTo-Json -Compress'
      ],
      { timeout: 5000, windowsHide: true }
    )
    const parsed = JSON.parse(stdout) as WinDisk | WinDisk[]
    for (const disk of Array.isArray(parsed) ? parsed : [parsed]) {
      if (disk.DeviceID) out.set(disk.DeviceID.toUpperCase(), disk)
    }
  } catch {
    /* No WMI, no labels. Sizes still work. */
  }
  return out
}

async function windowsVolumes(): Promise<Volume[]> {
  const meta = await windowsDiskMeta()
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const found = await Promise.all(
    letters.map(async (letter): Promise<Volume | null> => {
      const root = `${letter}:\\`
      if (!existsSync(root)) return null
      const disk = meta.get(`${letter}:`)
      const { totalBytes, freeBytes } = await sizeOf(root)
      // An empty optical/card reader slot exists but reports zero capacity.
      if (totalBytes === 0 && disk?.DriveType !== 4) return null
      return {
        path: root,
        label: disk?.VolumeName?.trim() || `Local Disk (${letter}:)`,
        fs: disk?.FileSystem ?? 'unknown',
        totalBytes,
        freeBytes,
        kind: WIN_DRIVE_TYPE[disk?.DriveType ?? 3] ?? 'fixed'
      }
    })
  )

  const home = homedir()
  const homeSize = await sizeOf(home)
  return [
    {
      path: home,
      label: `Home (${basename(home)})`,
      fs: 'ntfs',
      ...homeSize,
      kind: 'home'
    },
    ...found.filter((v): v is Volume => v !== null)
  ]
}

/* ── macOS ───────────────────────────────────────────────────────────── */

/** Parses `mount` output: `/dev/disk3s1s1 on / (apfs, sealed, local, read-only)`. */
async function unixMountTypes(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const { stdout } = await exec('/sbin/mount', [], { timeout: 5000 })
    for (const line of stdout.split('\n')) {
      const match = /^(\S+) on (.+?) \(([^,)]+)/.exec(line.trim())
      if (match?.[2] && match[3]) out.set(match[2], match[3])
    }
  } catch {
    /* fs type unknown */
  }
  return out
}

async function macVolumes(): Promise<Volume[]> {
  const types = await unixMountTypes()
  const volumes: Volume[] = []

  const rootSize = await sizeOf('/')
  volumes.push({
    path: '/',
    label: 'Macintosh HD',
    fs: types.get('/') ?? 'apfs',
    ...rootSize,
    kind: 'fixed'
  })

  const home = homedir()
  volumes.push({
    path: home,
    label: `Home (${basename(home)})`,
    fs: types.get('/') ?? 'apfs',
    ...rootSize,
    kind: 'home'
  })

  try {
    const entries = await fsp.readdir('/Volumes', { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const path = join('/Volumes', entry.name)
      // `/Volumes/Macintosh HD` is a symlink back to `/` on modern macOS.
      const real = await fsp.realpath(path).catch(() => path)
      if (real === '/') continue
      const size = await sizeOf(path)
      if (size.totalBytes === 0) continue
      const fs = types.get(path) ?? 'unknown'
      volumes.push({
        path,
        label: entry.name,
        fs,
        ...size,
        kind: fs === 'smbfs' || fs === 'nfs' || fs === 'afpfs' ? 'network' : 'removable'
      })
    }
  } catch {
    /* No /Volumes access. */
  }
  return volumes
}

/* ── Linux (dev convenience; not a shipped target) ───────────────────── */

async function linuxVolumes(): Promise<Volume[]> {
  const types = new Map<string, string>()
  try {
    const content = await fsp.readFile('/proc/mounts', 'utf8')
    for (const line of content.split('\n')) {
      const [, mount, fs] = line.split(' ')
      if (mount && fs) types.set(mount.replace(/\\040/g, ' '), fs)
    }
  } catch {
    /* ignore */
  }

  const interesting = ['/', homedir(), '/media', '/mnt']
  const volumes: Volume[] = []
  for (const path of interesting) {
    if (!existsSync(path)) continue
    const size = await sizeOf(path)
    if (size.totalBytes === 0) continue
    volumes.push({
      path,
      label: path === homedir() ? `Home (${basename(path)})` : path,
      fs: types.get(path) ?? 'unknown',
      ...size,
      kind: path === homedir() ? 'home' : 'fixed'
    })
  }
  return volumes
}
