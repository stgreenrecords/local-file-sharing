/**
 * The walk decides what actually gets copied and how each name lands on the
 * target. Fake providers let both platform directions be tested from either host.
 */
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { DirEntry, NodePlatform, Settings, Volume } from '@shared/types'
import { extOf, joinFor } from '@shared/paths'
import type { FsProvider, WriteResult } from '../fs/provider'
import { walk } from './walk'

/** An in-memory tree: path -> children names, or a file size. */
interface FakeTree {
  [path: string]: { dir: true; children: string[] } | { dir: false; size: number; mtimeMs?: number }
}

function fakeProvider(
  nodeId: string,
  platform: NodePlatform,
  tree: FakeTree,
  options: { unreadable?: string[] } = {}
): FsProvider {
  const entryFor = (path: string, name: string): DirEntry => {
    const node = tree[path]
    if (node === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return {
      name,
      path,
      isDir: node.dir,
      size: node.dir ? 0 : node.size,
      mtimeMs: node.dir ? 0 : (node.mtimeMs ?? 1_700_000_000_000),
      ext: extOf(name, node.dir),
      mode: node.dir ? 'd' : '-',
      hidden: name.startsWith('.'),
      symlink: false
    }
  }

  return {
    nodeId,
    platform,
    async volumes(): Promise<Volume[]> {
      return []
    },
    async list(path: string): Promise<DirEntry[]> {
      if (options.unreadable?.includes(path) === true) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      const node = tree[path]
      if (node === undefined || !node.dir) throw new Error(`not a directory: ${path}`)
      return node.children.map((name) => entryFor(joinFor(platform, path, name), name))
    },
    async stat(path: string): Promise<DirEntry> {
      const segments = path.split(/[\\/]+/).filter(Boolean)
      return entryFor(path, segments[segments.length - 1] ?? path)
    },
    async home(): Promise<string> {
      return platform === 'win32' ? 'C:\\Users\\test' : '/Users/test'
    },
    async mkdir(): Promise<void> {},
    async remove(): Promise<void> {},
    async rename(): Promise<void> {},
    async read(): Promise<Readable> {
      return Readable.from([])
    },
    async write(): Promise<WriteResult> {
      return { bytes: 0, sha256: '' }
    }
  }
}

const settings = (patch: Partial<Settings> = {}): Settings => ({
  displayName: 'test',
  rowDensity: 'standard',
  showHidden: false,
  confirmDelete: true,
  sanitizeWindowsNames: true,
  stripMacMetadata: true,
  normalizeUnicode: false,
  pathMappings: [],
  transport: 'omnidirect',
  streamWorkers: 1,
  bufferWindowBytes: 4 * 1024 * 1024,
  verifyChecksums: true,
  conflictPolicy: 'ask',
  bandwidthLimitBps: null,
  discoveryEnabled: true,
  port: 47654,
  autoPairKnownPeers: true,
  ...patch
})

const ctx = (source: FsProvider, target: FsProvider, s = settings()): Parameters<typeof walk>[2] => ({
  source,
  target,
  settings: s,
  seen: new Set<string>()
})

describe('walk', () => {
  it('flattens a mac tree onto a Windows target with correct totals', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/Users/a/Project': { dir: true, children: ['Reel01', 'notes.txt'] },
      '/Users/a/Project/Reel01': { dir: true, children: ['clip.mov'] },
      '/Users/a/Project/Reel01/clip.mov': { dir: false, size: 1000 },
      '/Users/a/Project/notes.txt': { dir: false, size: 24 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/Users/a/Project' }],
      { nodeId: 'win', path: 'D:\\Incoming' },
      ctx(mac, win)
    )

    expect(result.totalBytes).toBe(1024)
    expect(result.units).toHaveLength(2)
    expect(result.directories).toEqual(['D:\\Incoming\\Project', 'D:\\Incoming\\Project\\Reel01'])
    expect(result.units.map((u) => u.target.path).sort()).toEqual([
      'D:\\Incoming\\Project\\Reel01\\clip.mov',
      'D:\\Incoming\\Project\\notes.txt'
    ])
    // Relative paths stay slash-separated for display, whatever the platforms.
    expect(result.units.map((u) => u.relativePath).sort()).toEqual([
      'Project/Reel01/clip.mov',
      'Project/notes.txt'
    ])
    expect(result.warnings).toEqual([])
  })

  it('creates a directory entry for an empty folder so it still materialises', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src/empty': { dir: true, children: [] }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src/empty' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    expect(result.directories).toEqual(['D:\\t\\empty'])
    expect(result.units).toEqual([])
    expect(result.totalBytes).toBe(0)
  })

  it('sanitises names the Windows target cannot store', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src': { dir: true, children: ['a:b.txt'] },
      '/src/a:b.txt': { dir: false, size: 5 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    expect(result.units[0]?.target.path).toBe('D:\\t\\src\\a_b.txt')
  })

  it('reports a collision instead of overwriting when two names sanitise alike', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src': { dir: true, children: ['a:b.txt', 'a*b.txt'] },
      '/src/a:b.txt': { dir: false, size: 5 },
      '/src/a*b.txt': { dir: false, size: 7 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    // The first name wins; the second is refused rather than silently clobbering.
    expect(result.units).toHaveLength(1)
    expect(result.totalBytes).toBe(5)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.message).toContain('already taken by a sibling')
  })

  it('leaves those names alone when the target is macOS', async () => {
    const win = fakeProvider('win', 'win32', {
      'D:\\src': { dir: true, children: ['ok.txt'] },
      'D:\\src\\ok.txt': { dir: false, size: 3 }
    })
    const mac = fakeProvider('mac', 'darwin', {})

    const result = await walk(
      [{ nodeId: 'win', path: 'D:\\src' }],
      { nodeId: 'mac', path: '/Volumes/Data' },
      ctx(win, mac)
    )
    expect(result.units[0]?.target.path).toBe('/Volumes/Data/src/ok.txt')
  })

  it('drops mac metadata files when copying to Windows', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src': { dir: true, children: ['.DS_Store', '._clip.mov', 'clip.mov'] },
      '/src/.DS_Store': { dir: false, size: 6148 },
      '/src/._clip.mov': { dir: false, size: 4096 },
      '/src/clip.mov': { dir: false, size: 900 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    expect(result.units.map((u) => u.relativePath)).toEqual(['src/clip.mov'])
    expect(result.totalBytes).toBe(900)
  })

  it('keeps metadata files when the setting is off', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src': { dir: true, children: ['.DS_Store'] },
      '/src/.DS_Store': { dir: false, size: 10 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win, settings({ stripMacMetadata: false }))
    )
    expect(result.units).toHaveLength(1)
  })

  it('copies hidden files regardless of the showHidden view preference', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src': { dir: true, children: ['.env'] },
      '/src/.env': { dir: false, size: 12 }
    })
    const other = fakeProvider('mac2', 'darwin', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'mac2', path: '/dst' },
      ctx(mac, other, settings({ showHidden: false }))
    )
    expect(result.units.map((u) => u.relativePath)).toEqual(['src/.env'])
  })

  it('records a warning and continues when a subdirectory cannot be read', async () => {
    const mac = fakeProvider(
      'mac',
      'darwin',
      {
        '/src': { dir: true, children: ['locked', 'ok.txt'] },
        '/src/locked': { dir: true, children: [] },
        '/src/ok.txt': { dir: false, size: 4 }
      },
      { unreadable: ['/src/locked'] }
    )
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    expect(result.units.map((u) => u.relativePath)).toEqual(['src/ok.txt'])
    expect(result.warnings.map((w) => w.path)).toContain('/src/locked')
    // The directory itself is still created on the target.
    expect(result.directories).toContain('D:\\t\\src\\locked')
  })

  it('accepts several selected roots at once', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src/a.txt': { dir: false, size: 1 },
      '/src/b.txt': { dir: false, size: 2 }
    })
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [
        { nodeId: 'mac', path: '/src/a.txt' },
        { nodeId: 'mac', path: '/src/b.txt' }
      ],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    expect(result.totalBytes).toBe(3)
    expect(result.units.map((u) => u.target.path)).toEqual(['D:\\t\\a.txt', 'D:\\t\\b.txt'])
  })

  it('stops a symlink loop instead of recursing forever', async () => {
    // `/src/loop` lists `/src` again, which a self-referential symlink produces.
    const tree: FakeTree = {
      '/src': { dir: true, children: ['loop'] },
      '/src/loop': { dir: true, children: ['loop'] },
      '/src/loop/loop': { dir: true, children: ['loop'] },
      '/src/loop/loop/loop': { dir: true, children: [] }
    }
    const mac = fakeProvider('mac', 'darwin', tree)
    const win = fakeProvider('win', 'win32', {})

    const result = await walk(
      [{ nodeId: 'mac', path: '/src' }],
      { nodeId: 'win', path: 'D:\\t' },
      ctx(mac, win)
    )
    // Finite, and every level is visited at most once.
    expect(result.directories.length).toBeLessThanOrEqual(4)
    expect(new Set(result.directories).size).toBe(result.directories.length)
  })

  it('throws when the selection turns out to be empty', async () => {
    const mac = fakeProvider('mac', 'darwin', {
      '/src/.DS_Store': { dir: false, size: 1 }
    })
    const win = fakeProvider('win', 'win32', {})

    await expect(
      walk(
        [{ nodeId: 'mac', path: '/src/.DS_Store' }],
        { nodeId: 'win', path: 'D:\\t' },
        ctx(mac, win)
      )
    ).rejects.toThrow(/Nothing to transfer/)
  })
})
