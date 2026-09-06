/**
 * Regression: a transfer that fails part-way must not strand its streams.
 *
 * A rejected `target.write` used to leave the source read stream still piped
 * into the metering Transform, with nothing draining it. The descriptor stayed
 * open and a full `bufferWindowBytes` stayed reachable, so a batch that failed
 * repeatedly — a peer resetting the connection mid-copy — leaked one buffer
 * window per file until the machine ran out of memory.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeRef, Settings, TransferSnapshot } from '@shared/types'
import type { FsProvider, WriteResult } from '../fs/provider'
import { LocalProvider } from '../fs/local'
import { TransferEngine, type EngineDeps } from './engine'

const platform = process.platform as 'win32' | 'darwin' | 'linux'
const real = new LocalProvider()
const WINDOW = 1024 * 1024

const settings = (): Settings => ({
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
  bufferWindowBytes: WINDOW,
  verifyChecksums: true,
  conflictPolicy: 'overwrite-if-newer',
  bandwidthLimitBps: null,
  discoveryEnabled: false,
  port: 47654,
  autoPairKnownPeers: false
})

let root: string

beforeEach(() => {
  root = join(tmpdir(), `omni-cleanup-${randomUUID()}`)
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'dst'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Wraps the real provider so writes can be made to fail like a reset peer. */
function harness(failWrite: boolean): {
  provider: FsProvider
  opened: Readable[]
  bodies: Readable[]
} {
  const opened: Readable[] = []
  const bodies: Readable[] = []
  const provider: FsProvider = {
    nodeId: 'local',
    platform,
    volumes: () => real.volumes(),
    list: (p) => real.list(p),
    stat: (p) => real.stat(p),
    home: () => real.home(),
    mkdir: (p) => real.mkdir(p),
    remove: (p) => real.remove(p),
    rename: (a, b) => real.rename(a, b),
    async read(p, range) {
      const stream = await real.read(p, range)
      opened.push(stream)
      return stream
    },
    async write(p, body, options): Promise<WriteResult> {
      bodies.push(body)
      if (failWrite) throw new Error('socket hang up')
      return real.write(p, body, options)
    }
  }
  return { provider, opened, bodies }
}

function engineFor(provider: FsProvider): TransferEngine {
  const deps: EngineDeps = {
    providerFor: () => provider,
    settings,
    nodeRef: (id): NodeRef => ({ id, name: id, platform })
  }
  return new TransferEngine(deps)
}

function settled(engine: TransferEngine): Promise<TransferSnapshot> {
  const busy = new Set(['queued', 'active', 'awaiting-decision'])
  return new Promise((resolve) => {
    const stop = engine.onChange((s) => {
      if (s.jobs.length > 0 && s.jobs.every((j) => !busy.has(j.status))) {
        stop()
        resolve(s)
      }
    })
  })
}

async function runOneFile(failWrite: boolean): Promise<ReturnType<typeof harness>> {
  const h = harness(failWrite)
  const file = join(root, 'src', 'big.bin')
  writeFileSync(file, Buffer.alloc(8 * WINDOW, 7))

  const engine = engineFor(h.provider)
  const done = settled(engine)
  await engine.enqueue(
    [{ nodeId: 'local', path: file }],
    { nodeId: 'local', path: join(root, 'dst') },
    'copy'
  )
  await done
  // The teardown runs in the `finally` after the job is patched.
  await new Promise((r) => setTimeout(r, 50))
  return h
}

describe('stream teardown', () => {
  it('destroys the source stream and the meter when the write fails', async () => {
    const { opened, bodies } = await runOneFile(true)

    expect(opened).toHaveLength(1)
    expect(opened[0]?.destroyed, 'source read stream leaked its descriptor').toBe(true)
    expect(bodies[0]?.destroyed, 'metering transform leaked its buffer window').toBe(true)
    // Nothing may still be sitting in the meter's readable side.
    expect((bodies[0] as unknown as { readableLength: number }).readableLength).toBe(0)
  })

  it('leaves nothing behind on a successful transfer either', async () => {
    const { opened, bodies } = await runOneFile(false)

    expect(opened[0]?.destroyed).toBe(true)
    expect(bodies[0]?.destroyed).toBe(true)
  })
})
