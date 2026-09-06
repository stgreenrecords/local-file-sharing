/**
 * `FsProvider` over `node:fs` for this machine.
 *
 * Writes always land in a `.omnipart` sibling and are renamed on success, so an
 * interrupted transfer never leaves a truncated file at the real path.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fsp, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { PassThrough, type Readable } from 'node:stream'
import type { DirEntry, NodePlatform, Volume } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { ErrorCode, OmniError, fromErrno } from '@shared/errors'
import { extOf, isRootFor, looksNativeTo } from '@shared/paths'
import type { ByteRange, FsProvider, WriteOptions, WriteResult } from './provider'
import { localVolumes, invalidateVolumeCache } from './volumes'

export const PART_SUFFIX = '.omnipart'

const platform = process.platform as NodePlatform

function assertPath(path: string): void {
  if (!looksNativeTo(platform, path)) {
    throw new OmniError(ErrorCode.BAD_PATH, `Not a valid ${platform} absolute path`, path)
  }
}

/** `drwxr-xr-x` on POSIX; DOS-style attribute letters on Windows. */
function modeString(stats: Stats, isDir: boolean, symlink: boolean): string {
  if (platform === 'win32') {
    const attrs: string[] = []
    if (isDir) attrs.push('D')
    // Node cannot read DOS attributes without a native module, so read-only is
    // inferred from the write bit and hidden/system are not reported at all.
    if ((stats.mode & 0o200) === 0) attrs.push('R')
    if (symlink) attrs.push('L')
    if (attrs.length === 0) attrs.push('A')
    return attrs.join('')
  }
  const rwx = (bits: number): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`
  const lead = symlink ? 'l' : isDir ? 'd' : '-'
  const m = stats.mode
  return `${lead}${rwx((m >> 6) & 7)}${rwx((m >> 3) & 7)}${rwx(m & 7)}`
}

function isHidden(name: string): boolean {
  if (name.startsWith('.')) return true
  if (platform === 'win32') return name === 'desktop.ini' || name === '$RECYCLE.BIN'
  return false
}

function toEntry(name: string, path: string, stats: Stats, symlink: boolean): DirEntry {
  const isDir = stats.isDirectory()
  return {
    name,
    path,
    isDir,
    size: isDir ? 0 : stats.size,
    mtimeMs: stats.mtimeMs,
    ext: extOf(name, isDir),
    mode: modeString(stats, isDir, symlink),
    hidden: isHidden(name),
    symlink
  }
}

export class LocalProvider implements FsProvider {
  readonly nodeId = LOCAL_NODE_ID
  readonly platform = platform

  volumes(): Promise<Volume[]> {
    return localVolumes()
  }

  async list(path: string): Promise<DirEntry[]> {
    assertPath(path)
    let dirents
    try {
      dirents = await fsp.readdir(path, { withFileTypes: true })
    } catch (err) {
      throw fromErrno(err, 'Cannot read directory')
    }

    const entries = await Promise.all(
      dirents.map(async (dirent): Promise<DirEntry | null> => {
        const full = join(path, dirent.name)
        const symlink = dirent.isSymbolicLink()
        try {
          // Follow symlinks so a linked folder browses as a folder; fall back to
          // the link itself when the target is gone.
          const stats = symlink
            ? await fsp.stat(full).catch(() => fsp.lstat(full))
            : await fsp.lstat(full)
          return toEntry(dirent.name, full, stats, symlink)
        } catch {
          // A file we cannot stat (permissions, a vanishing temp file) is skipped
          // rather than failing the whole listing.
          return null
        }
      })
    )
    return entries.filter((e): e is DirEntry => e !== null && !e.name.endsWith(PART_SUFFIX))
  }

  async stat(path: string): Promise<DirEntry> {
    assertPath(path)
    try {
      const lstats = await fsp.lstat(path)
      const symlink = lstats.isSymbolicLink()
      const stats = symlink ? await fsp.stat(path) : lstats
      return toEntry(basename(path) || path, path, stats, symlink)
    } catch (err) {
      throw fromErrno(err, 'Cannot stat path')
    }
  }

  async home(): Promise<string> {
    return homedir()
  }

  async mkdir(path: string): Promise<void> {
    assertPath(path)
    try {
      await fsp.mkdir(path, { recursive: true })
    } catch (err) {
      throw fromErrno(err, 'Cannot create directory')
    }
  }

  async remove(paths: string[]): Promise<void> {
    for (const path of paths) {
      assertPath(path)
      if (isRootFor(platform, path)) {
        throw new OmniError(ErrorCode.REFUSE_ROOT, 'Refusing to delete a volume root', path)
      }
    }
    for (const path of paths) {
      try {
        await fsp.rm(path, { recursive: true, force: false })
      } catch (err) {
        throw fromErrno(err, `Cannot delete ${path}`)
      }
    }
    invalidateVolumeCache()
  }

  async rename(from: string, to: string): Promise<void> {
    assertPath(from)
    assertPath(to)
    try {
      await fsp.rename(from, to)
    } catch (err) {
      throw fromErrno(err, 'Cannot rename')
    }
  }

  async read(path: string, range?: ByteRange): Promise<Readable> {
    assertPath(path)
    const stats = await fsp.stat(path).catch((err: unknown) => {
      throw fromErrno(err, 'Cannot open file')
    })
    if (stats.isDirectory()) {
      throw new OmniError(ErrorCode.IS_DIR, 'Cannot read a directory as a file', path)
    }
    return range === undefined
      ? createReadStream(path)
      : createReadStream(path, { start: range.start, ...(range.end === undefined ? {} : { end: range.end }) })
  }

  async write(path: string, body: Readable, options: WriteOptions): Promise<WriteResult> {
    assertPath(path)
    const part = join(dirname(path), `${basename(path)}${PART_SUFFIX}`)
    await fsp.mkdir(dirname(path), { recursive: true })

    const hash = createHash('sha256')
    let bytes = 0
    const meter = new PassThrough()
    meter.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      hash.update(chunk)
    })

    try {
      await pipeline(body, meter, createWriteStream(part, { flags: 'w' }))
    } catch (err) {
      await fsp.rm(part, { force: true })
      throw fromErrno(err, 'Write failed')
    }

    const digest = hash.digest('hex')

    if (bytes !== options.size) {
      await fsp.rm(part, { force: true })
      throw new OmniError(
        ErrorCode.TRUNCATED,
        'Stream ended early',
        `expected ${options.size} bytes, received ${bytes}`
      )
    }
    if (options.sha256 !== undefined && options.sha256 !== digest) {
      await fsp.rm(part, { force: true })
      throw new OmniError(
        ErrorCode.HASH_MISMATCH,
        'Checksum mismatch — the copy was discarded',
        `source ${options.sha256}, target ${digest}`
      )
    }

    try {
      await fsp.rename(part, path)
    } catch (err) {
      await fsp.rm(part, { force: true })
      throw fromErrno(err, 'Cannot finalise file')
    }
    if (options.mtimeMs !== undefined) {
      const when = new Date(options.mtimeMs)
      await fsp.utimes(path, when, when).catch(() => {
        /* mtime is cosmetic; a failure must not fail the transfer */
      })
    }
    invalidateVolumeCache()
    return { bytes, sha256: digest }
  }
}

export const local = new LocalProvider()
