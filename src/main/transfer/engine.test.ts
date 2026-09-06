/**
 * Drives the real engine against real directories with the real LocalProvider —
 * so streaming, hashing, `.omnipart` staging, conflict policy and queue
 * bookkeeping are all exercised end to end. Only the HTTP hop is absent; the
 * server's half of that is covered by the protocol contract in docs/PROTOCOL.md.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConflictPrompt, NodeRef, Settings, TransferSnapshot } from '@shared/types'
import type { FsProvider } from '../fs/provider'
import { LocalProvider } from '../fs/local'
import { TransferEngine, type EngineDeps } from './engine'

const platform = process.platform as 'win32' | 'darwin' | 'linux'
const provider = new LocalProvider()

let root: string
let src: string
let dst: string
let settings: Settings

const baseSettings = (): Settings => ({
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
  bufferWindowBytes: 1024 * 1024,
  verifyChecksums: true,
  conflictPolicy: 'ask',
  bandwidthLimitBps: null,
  discoveryEnabled: false,
  port: 47654,
  autoPairKnownPeers: false
})

function makeEngine(): TransferEngine {
  const deps: EngineDeps = {
    // Both "nodes" resolve to this machine's filesystem; the engine cannot tell.
    providerFor: () => provider,
    settings: () => settings,
    nodeRef: (id): NodeRef => ({ id, name: id, platform })
  }
  return new TransferEngine(deps)
}

/** Resolves once no job is queued or running. */
function settled(engine: TransferEngine): Promise<TransferSnapshot> {
  return new Promise((resolve) => {
    // `awaiting-decision` is still in flight — the engine is blocked on an answer.
    const pendingStatuses = new Set(['queued', 'active', 'awaiting-decision'])
    const isDone = (s: TransferSnapshot): boolean =>
      s.jobs.length > 0 && s.jobs.every((j) => !pendingStatuses.has(j.status))
    const stop = engine.onChange((s) => {
      if (isDone(s)) {
        stop()
        resolve(s)
      }
    })
    const now = engine.snapshot()
    if (isDone(now)) {
      stop()
      resolve(now)
    }
  })
}

const sha = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

beforeEach(() => {
  root = join(tmpdir(), `omni-engine-${randomUUID()}`)
  src = join(root, 'src')
  dst = join(root, 'dst')
  mkdirSync(src, { recursive: true })
  mkdirSync(dst, { recursive: true })
  settings = baseSettings()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('TransferEngine', () => {
  it('copies a file and verifies it byte for byte', async () => {
    const payload = Buffer.alloc(3 * 1024 * 1024)
    for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31) % 251
    writeFileSync(join(src, 'clip.bin'), payload)

    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'clip.bin') }], { nodeId: 'b', path: dst }, 'copy')
    const snapshot = await settled(engine)

    expect(snapshot.jobs).toHaveLength(1)
    const job = snapshot.jobs[0]!
    expect(job.status).toBe('done')
    expect(job.error).toBeUndefined()
    expect(job.transferredBytes).toBe(payload.length)
    expect(job.totalBytes).toBe(payload.length)

    const landed = join(dst, 'clip.bin')
    expect(existsSync(landed)).toBe(true)
    expect(readFileSync(landed).equals(payload)).toBe(true)
    // The engine's reported digest must be the real one.
    expect(job.sha256).toBe(sha(landed))
  })

  it('leaves no .omnipart staging files behind', async () => {
    writeFileSync(join(src, 'a.txt'), 'hello')
    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'a.txt') }], { nodeId: 'b', path: dst }, 'copy')
    await settled(engine)
    expect(readdirSync(dst)).toEqual(['a.txt'])
  })

  it('recreates a nested tree, including empty directories', async () => {
    mkdirSync(join(src, 'tree', 'deep'), { recursive: true })
    mkdirSync(join(src, 'tree', 'empty'), { recursive: true })
    writeFileSync(join(src, 'tree', 'root.txt'), 'root')
    writeFileSync(join(src, 'tree', 'deep', 'leaf.txt'), 'leaf')

    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'tree') }], { nodeId: 'b', path: dst }, 'copy')
    const snapshot = await settled(engine)

    expect(snapshot.jobs.every((j) => j.status === 'done')).toBe(true)
    expect(readFileSync(join(dst, 'tree', 'root.txt'), 'utf8')).toBe('root')
    expect(readFileSync(join(dst, 'tree', 'deep', 'leaf.txt'), 'utf8')).toBe('leaf')
    expect(existsSync(join(dst, 'tree', 'empty'))).toBe(true)
  })

  it('knows the exact total before any byte moves', async () => {
    writeFileSync(join(src, 'one.bin'), Buffer.alloc(1000))
    writeFileSync(join(src, 'two.bin'), Buffer.alloc(2500))

    const engine = makeEngine()
    const batchId = await engine.enqueue(
      [
        { nodeId: 'a', path: join(src, 'one.bin') },
        { nodeId: 'a', path: join(src, 'two.bin') }
      ],
      { nodeId: 'b', path: dst },
      'copy'
    )
    // enqueue resolves after the walk, so totals are already final and exact.
    const batch = engine.snapshot().batches.find((b) => b.id === batchId)!
    expect(batch.scanning).toBe(false)
    expect(batch.totalBytes).toBe(3500)
    expect(batch.totalFiles).toBe(2)
    await settled(engine)
  })

  it('reports progress that reaches the total', async () => {
    writeFileSync(join(src, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 7))
    const engine = makeEngine()
    const seen: number[] = []
    engine.onChange((s) => {
      const job = s.jobs[0]
      if (job !== undefined) seen.push(job.transferredBytes)
    })
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'big.bin') }], { nodeId: 'b', path: dst }, 'copy')
    await settled(engine)

    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBe(2 * 1024 * 1024)
    // Progress is monotonic — it never reports moving backwards.
    const sorted = [...seen].sort((a, b) => a - b)
    expect(seen).toEqual(sorted)
  })

  describe('conflict policies', () => {
    beforeEach(() => {
      writeFileSync(join(src, 'f.txt'), 'new-content')
      writeFileSync(join(dst, 'f.txt'), 'old')
    })

    it('skip-identical overwrites when size or mtime differ', async () => {
      settings.conflictPolicy = 'skip-identical'
      const engine = makeEngine()
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('done')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('new-content')
    })

    it('skip-identical skips a same-size, same-mtime file', async () => {
      writeFileSync(join(src, 'same.txt'), 'abc')
      writeFileSync(join(dst, 'same.txt'), 'xyz')
      const when = new Date(1_700_000_000_000)
      utimesSync(join(src, 'same.txt'), when, when)
      utimesSync(join(dst, 'same.txt'), when, when)

      settings.conflictPolicy = 'skip-identical'
      const engine = makeEngine()
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'same.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('skipped')
      // Untouched: the target keeps its own bytes.
      expect(readFileSync(join(dst, 'same.txt'), 'utf8')).toBe('xyz')
    })

    it('keep-both writes a numbered sibling and preserves the original', async () => {
      settings.conflictPolicy = 'keep-both'
      const engine = makeEngine()
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('done')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('old')
      expect(readFileSync(join(dst, 'f (2).txt'), 'utf8')).toBe('new-content')
    })

    it('overwrite-if-newer skips when the target is newer', async () => {
      const old = new Date(1_600_000_000_000)
      const recent = new Date(1_800_000_000_000)
      utimesSync(join(src, 'f.txt'), old, old)
      utimesSync(join(dst, 'f.txt'), recent, recent)

      settings.conflictPolicy = 'overwrite-if-newer'
      const engine = makeEngine()
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('skipped')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('old')
    })

    it('overwrite-if-newer copies when the source is newer', async () => {
      const old = new Date(1_600_000_000_000)
      const recent = new Date(1_800_000_000_000)
      utimesSync(join(dst, 'f.txt'), old, old)
      utimesSync(join(src, 'f.txt'), recent, recent)

      settings.conflictPolicy = 'overwrite-if-newer'
      const engine = makeEngine()
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('done')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('new-content')
    })

    it('ask prompts, and honours the answer', async () => {
      settings.conflictPolicy = 'ask'
      const engine = makeEngine()
      const prompts: ConflictPrompt[] = []
      engine.onConflict((prompt) => {
        prompts.push(prompt)
        engine.resolveConflict(prompt.jobId, 'overwrite')
      })
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)

      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.target.size).toBe(3)
      expect(prompts[0]?.source.size).toBe('new-content'.length)
      expect(snapshot.jobs[0]?.status).toBe('done')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('new-content')
    })

    it('ask honours a skip answer', async () => {
      settings.conflictPolicy = 'ask'
      const engine = makeEngine()
      engine.onConflict((prompt) => engine.resolveConflict(prompt.jobId, 'skip'))
      await engine.enqueue([{ nodeId: 'a', path: join(src, 'f.txt') }], { nodeId: 'b', path: dst }, 'copy')
      const snapshot = await settled(engine)
      expect(snapshot.jobs[0]?.status).toBe('skipped')
      expect(readFileSync(join(dst, 'f.txt'), 'utf8')).toBe('old')
    })
  })

  it('moves a file within one node by copying then removing the source', async () => {
    writeFileSync(join(src, 'move-me.txt'), 'payload')
    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'move-me.txt') }], { nodeId: 'a', path: dst }, 'move')
    const snapshot = await settled(engine)

    expect(snapshot.jobs[0]?.status).toBe('done')
    expect(readFileSync(join(dst, 'move-me.txt'), 'utf8')).toBe('payload')
    expect(existsSync(join(src, 'move-me.txt'))).toBe(false)
  })

  it('refuses a cross-machine move rather than losing the source', async () => {
    writeFileSync(join(src, 'x.txt'), 'x')
    const engine = makeEngine()
    await expect(
      engine.enqueue([{ nodeId: 'a', path: join(src, 'x.txt') }], { nodeId: 'b', path: dst }, 'move')
    ).rejects.toThrow(/not supported yet/)
  })

  it('refuses a selection that spans two machines', async () => {
    writeFileSync(join(src, 'x.txt'), 'x')
    const engine = makeEngine()
    await expect(
      engine.enqueue(
        [
          { nodeId: 'a', path: join(src, 'x.txt') },
          { nodeId: 'b', path: join(src, 'x.txt') }
        ],
        { nodeId: 'c', path: dst },
        'copy'
      )
    ).rejects.toThrow(/cannot mix source machines/)
  })

  it('records a failure without aborting the rest of the batch', async () => {
    writeFileSync(join(src, 'good1.txt'), 'a')
    writeFileSync(join(src, 'bad.txt'), 'b')
    writeFileSync(join(src, 'good2.txt'), 'c')

    // Fail exactly one unit at stream time — the walk still sees all three, so
    // this exercises per-job isolation rather than a walk-time error.
    const failing: FsProvider = {
      ...provider,
      read: (path, range) =>
        path.endsWith('bad.txt')
          ? Promise.reject(new Error('simulated read failure'))
          : provider.read(path, range),
      volumes: () => provider.volumes(),
      list: (p) => provider.list(p),
      stat: (p) => provider.stat(p),
      home: () => provider.home(),
      mkdir: (p) => provider.mkdir(p),
      remove: (p) => provider.remove(p),
      rename: (a, b) => provider.rename(a, b),
      write: (p, body, opts) => provider.write(p, body, opts)
    }
    const engine = new TransferEngine({
      providerFor: () => failing,
      settings: () => settings,
      nodeRef: (id): NodeRef => ({ id, name: id, platform })
    })

    await engine.enqueue(
      [
        { nodeId: 'a', path: join(src, 'good1.txt') },
        { nodeId: 'a', path: join(src, 'bad.txt') },
        { nodeId: 'a', path: join(src, 'good2.txt') }
      ],
      { nodeId: 'b', path: dst },
      'copy'
    )
    const snapshot = await settled(engine)

    const byName = new Map(snapshot.jobs.map((j) => [j.relativePath, j]))
    expect(byName.get('bad.txt')?.status).toBe('failed')
    expect(byName.get('bad.txt')?.error).toBeTruthy()
    // The neighbours still complete, and no partial file is left for the failure.
    expect(byName.get('good1.txt')?.status).toBe('done')
    expect(byName.get('good2.txt')?.status).toBe('done')
    expect(readdirSync(dst).sort()).toEqual(['good1.txt', 'good2.txt'])
  })

  it('holds the queue while paused and drains on resume', async () => {
    writeFileSync(join(src, 'p1.txt'), '1')
    writeFileSync(join(src, 'p2.txt'), '2')

    const engine = makeEngine()
    engine.pause()
    await engine.enqueue(
      [
        { nodeId: 'a', path: join(src, 'p1.txt') },
        { nodeId: 'a', path: join(src, 'p2.txt') }
      ],
      { nodeId: 'b', path: dst },
      'copy'
    )

    expect(engine.snapshot().paused).toBe(true)
    expect(engine.snapshot().jobs.every((j) => j.status === 'queued')).toBe(true)
    expect(readdirSync(dst)).toEqual([])

    engine.resume()
    const snapshot = await settled(engine)
    expect(snapshot.jobs.every((j) => j.status === 'done')).toBe(true)
    expect(readdirSync(dst).sort()).toEqual(['p1.txt', 'p2.txt'])
  })

  it('cancels a queued batch without writing anything', async () => {
    writeFileSync(join(src, 'c1.txt'), '1')
    const engine = makeEngine()
    engine.pause()
    const batchId = await engine.enqueue(
      [{ nodeId: 'a', path: join(src, 'c1.txt') }],
      { nodeId: 'b', path: dst },
      'copy'
    )
    engine.cancelBatch(batchId)
    expect(engine.snapshot().jobs.every((j) => j.status === 'cancelled')).toBe(true)

    engine.resume()
    await new Promise((r) => setTimeout(r, 50))
    expect(readdirSync(dst)).toEqual([])
  })

  it('clearDone drops finished jobs and their batch', async () => {
    writeFileSync(join(src, 'd.txt'), 'd')
    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'd.txt') }], { nodeId: 'b', path: dst }, 'copy')
    await settled(engine)

    expect(engine.snapshot().jobs).toHaveLength(1)
    engine.clearDone()
    expect(engine.snapshot().jobs).toHaveLength(0)
    expect(engine.snapshot().batches).toHaveLength(0)
  })

  it('copies without hashing when verification is off', async () => {
    settings.verifyChecksums = false
    writeFileSync(join(src, 'n.txt'), 'no-hash')
    const engine = makeEngine()
    await engine.enqueue([{ nodeId: 'a', path: join(src, 'n.txt') }], { nodeId: 'b', path: dst }, 'copy')
    const snapshot = await settled(engine)

    expect(snapshot.jobs[0]?.status).toBe('done')
    expect(snapshot.jobs[0]?.sha256).toBeUndefined()
    expect(readFileSync(join(dst, 'n.txt'), 'utf8')).toBe('no-hash')
  })
})
