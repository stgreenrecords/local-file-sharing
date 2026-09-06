/**
 * The transfer queue.
 *
 * One serial worker today (see docs/ROADMAP.md phase 4). Each unit streams
 * source -> metering Transform -> target, with the Transform feeding a byte counter
 * a SHA-256 hash, so progress and verification cost one pass over the data.
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { Transform, type Readable } from 'node:stream'
import type {
  ConflictPrompt,
  ConflictResolution,
  DirEntry,
  NodeRef,
  PathRef,
  Settings,
  TransferBatch,
  TransferJob,
  TransferSnapshot
} from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { ErrorCode, OmniError, toAppError } from '@shared/errors'
import { basenameFor, dirnameFor, joinFor } from '@shared/paths'
import type { FsProvider } from '../fs/provider'
import { walk, type WalkUnit } from './walk'

/**
 * Everything the engine needs from the rest of the app. Injected rather than
 * imported so the engine can be driven against plain local directories in a
 * test, with no Electron and no network.
 */
export interface EngineDeps {
  providerFor(nodeId: string): FsProvider
  settings(): Settings
  nodeRef(nodeId: string): NodeRef
}

const PROGRESS_INTERVAL_MS = 100
/** Time constant of the throughput EWMA, in ms. */
const RATE_TAU_MS = 2000

type Listener = (snapshot: TransferSnapshot) => void
type ConflictListener = (prompt: ConflictPrompt) => void

interface QueuedUnit extends WalkUnit {
  jobId: string
  batchId: string
}

export class TransferEngine {
  constructor(private readonly deps: EngineDeps) {}

  private batches = new Map<string, TransferBatch>()
  private jobs = new Map<string, TransferJob>()
  private pending: QueuedUnit[] = []
  private cancelledBatches = new Set<string>()

  private running = false
  private paused = false
  private activeAbort: (() => void) | null = null

  private listeners = new Set<Listener>()
  private conflictListeners = new Set<ConflictListener>()
  private pendingDecisions = new Map<string, (resolution: ConflictResolution) => void>()

  private emitTimer: NodeJS.Timeout | null = null
  private emitDue = false

  /* ── subscriptions ──────────────────────────────────────────────── */

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onConflict(listener: ConflictListener): () => void {
    this.conflictListeners.add(listener)
    return () => this.conflictListeners.delete(listener)
  }

  /** Coalesces bursts so a fast local copy cannot flood the renderer. */
  private emit(immediate = false): void {
    if (immediate) {
      if (this.emitTimer !== null) {
        clearTimeout(this.emitTimer)
        this.emitTimer = null
      }
      this.emitDue = false
      const snapshot = this.snapshot()
      for (const listener of this.listeners) listener(snapshot)
      return
    }
    this.emitDue = true
    if (this.emitTimer !== null) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      if (this.emitDue) this.emit(true)
    }, PROGRESS_INTERVAL_MS)
  }

  /* ── public API ─────────────────────────────────────────────────── */

  snapshot(): TransferSnapshot {
    const jobs = [...this.jobs.values()]
    const bytesDone = jobs.reduce((sum, j) => sum + j.transferredBytes, 0)
    const bytesTotal = jobs.reduce((sum, j) => sum + j.totalBytes, 0)
    const bps = jobs
      .filter((j) => j.status === 'active')
      .reduce((sum, j) => sum + (j.bps ?? 0), 0)
    return {
      batches: [...this.batches.values()].sort((a, b) => b.createdAt - a.createdAt),
      jobs,
      paused: this.paused,
      bps,
      bytesDone,
      bytesTotal
    }
  }

  async enqueue(
    sources: PathRef[],
    targetDir: PathRef,
    operation: 'copy' | 'move'
  ): Promise<string> {
    if (sources.length === 0) {
      throw new OmniError(ErrorCode.NOT_FOUND, 'Nothing selected to transfer')
    }
    const sourceNodeId = sources[0]?.nodeId ?? LOCAL_NODE_ID
    if (sources.some((s) => s.nodeId !== sourceNodeId)) {
      throw new OmniError(ErrorCode.PROTOCOL, 'A transfer cannot mix source machines')
    }
    if (operation === 'move' && sourceNodeId !== targetDir.nodeId) {
      // Cross-node move needs copy + verify + delete; not wired up yet.
      throw new OmniError(
        ErrorCode.PROTOCOL,
        'Moving between machines is not supported yet — copy, then delete'
      )
    }

    const source = this.deps.providerFor(sourceNodeId)
    const target = this.deps.providerFor(targetDir.nodeId)
    const settings = this.deps.settings()

    const batchId = randomUUID()
    const batch: TransferBatch = {
      id: batchId,
      sourceNode: this.deps.nodeRef(sourceNodeId),
      targetNode: this.deps.nodeRef(targetDir.nodeId),
      operation,
      createdAt: Date.now(),
      totalBytes: 0,
      totalFiles: 0,
      scanning: true
    }
    this.batches.set(batchId, batch)
    this.emit(true)

    let result
    try {
      result = await walk(sources, targetDir, { source, target, settings, seen: new Set() })
    } catch (err) {
      this.batches.delete(batchId)
      this.emit(true)
      throw err
    }

    // Create the directory skeleton up front so empty folders still appear.
    for (const dir of result.directories) {
      await target.mkdir(dir).catch(() => undefined)
    }

    for (const unit of result.units) {
      const jobId = randomUUID()
      this.jobs.set(jobId, {
        id: jobId,
        batchId,
        source: unit.source,
        target: unit.target,
        relativePath: unit.relativePath,
        totalBytes: unit.size,
        transferredBytes: 0,
        status: 'queued',
        bps: null
      })
      this.pending.push({ ...unit, jobId, batchId })
    }

    this.batches.set(batchId, {
      ...batch,
      totalBytes: result.totalBytes,
      totalFiles: result.units.length,
      scanning: false
    })
    this.emit(true)

    void this.pump()
    return batchId
  }

  pause(): void {
    this.paused = true
    this.emit(true)
  }

  resume(): void {
    this.paused = false
    this.emit(true)
    void this.pump()
  }

  cancelBatch(batchId: string): void {
    this.cancelledBatches.add(batchId)
    this.pending = this.pending.filter((unit) => {
      if (unit.batchId !== batchId) return true
      this.patchJob(unit.jobId, { status: 'cancelled' })
      return false
    })
    // If the active job belongs to this batch, tear its streams down.
    const active = [...this.jobs.values()].find((j) => j.status === 'active')
    if (active?.batchId === batchId) this.activeAbort?.()
    for (const [jobId, resolve] of this.pendingDecisions) {
      if (this.jobs.get(jobId)?.batchId === batchId) {
        resolve('cancel-batch')
        this.pendingDecisions.delete(jobId)
      }
    }
    this.emit(true)
  }

  clearDone(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'done' || job.status === 'skipped' || job.status === 'cancelled') {
        this.jobs.delete(id)
      }
    }
    for (const [id, batch] of this.batches) {
      const remaining = [...this.jobs.values()].filter((j) => j.batchId === id)
      if (remaining.length === 0 && !batch.scanning) this.batches.delete(id)
    }
    this.emit(true)
  }

  resolveConflict(jobId: string, resolution: ConflictResolution): void {
    const resolve = this.pendingDecisions.get(jobId)
    if (resolve === undefined) return
    this.pendingDecisions.delete(jobId)
    resolve(resolution)
  }

  /* ── the worker ─────────────────────────────────────────────────── */

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.length > 0 && !this.paused) {
        const unit = this.pending.shift()
        if (unit === undefined) break
        if (this.cancelledBatches.has(unit.batchId)) {
          this.patchJob(unit.jobId, { status: 'cancelled' })
          continue
        }
        await this.runUnit(unit)
      }
    } finally {
      this.running = false
      this.emit(true)
    }
    // A resume or a new enqueue during the drain needs another pass.
    if (this.pending.length > 0 && !this.paused) void this.pump()
  }

  private async runUnit(unit: QueuedUnit): Promise<void> {
    const settings = this.deps.settings()
    const source = this.deps.providerFor(unit.source.nodeId)
    const target = this.deps.providerFor(unit.target.nodeId)

    let targetPath = unit.target.path
    const existing = await target.stat(targetPath).catch(() => null)

    if (existing !== null) {
      const decision = await this.decideConflict(unit, existing, settings)
      if (decision === 'skip') {
        this.patchJob(unit.jobId, { status: 'skipped', finishedAt: Date.now() })
        return
      }
      if (decision === 'cancel-batch') {
        this.cancelBatch(unit.batchId)
        return
      }
      if (decision === 'keep-both') {
        targetPath = await uniquePath(target, targetPath)
        this.patchJob(unit.jobId, { target: { nodeId: unit.target.nodeId, path: targetPath } })
      }
    }

    this.patchJob(unit.jobId, {
      status: 'active',
      startedAt: Date.now(),
      transferredBytes: 0,
      bps: null
    })

    const hash = createHash('sha256')

    let transferred = 0
    let lastSampleAt = Date.now()
    let lastSampleBytes = 0
    let bps: number | null = null
    let lastEmitAt = 0

    /**
     * Counting must happen *inside* the pipeline, not from a `'data'` listener:
     * attaching one puts the stream into flowing mode immediately, so bytes get
     * consumed and discarded before the writer is attached. A Transform sees
     * every chunk, passes it along, and preserves backpressure.
     */
    const meter = new Transform({
      highWaterMark: settings.bufferWindowBytes,
      transform: (chunk: Buffer, _encoding, callback): void => {
        transferred += chunk.length
        if (settings.verifyChecksums) hash.update(chunk)

        const now = Date.now()
        const elapsed = now - lastSampleAt
        if (elapsed >= PROGRESS_INTERVAL_MS) {
          const instant = ((transferred - lastSampleBytes) * 1000) / elapsed
          // EWMA so the displayed rate does not flicker on bursty I/O.
          const alpha = 1 - Math.exp(-elapsed / RATE_TAU_MS)
          bps = bps === null ? instant : bps + alpha * (instant - bps)
          lastSampleAt = now
          lastSampleBytes = transferred
        }
        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
          lastEmitAt = now
          this.patchJob(unit.jobId, { transferredBytes: transferred, bps }, false)
        }
        callback(null, chunk)
      }
    })

    let aborted = false
    let readable: Readable | null = null
    try {
      // `stream` is the narrowed handle the closures capture; `readable` is the
      // copy the `finally` uses to tear it down on every exit path.
      const stream = await source.read(unit.source.path)
      readable = stream
      this.activeAbort = () => {
        aborted = true
        stream.destroy(new OmniError(ErrorCode.CANCELLED, 'Cancelled'))
        meter.destroy(new OmniError(ErrorCode.CANCELLED, 'Cancelled'))
      }
      stream.on('error', (err) => meter.destroy(err))
      stream.pipe(meter)

      const result = await target.write(targetPath, meter, {
        size: unit.size,
        mtimeMs: unit.mtimeMs
      })

      const digest = settings.verifyChecksums ? hash.digest('hex') : undefined
      if (digest !== undefined && result.sha256 !== digest) {
        throw new OmniError(
          ErrorCode.HASH_MISMATCH,
          'Checksum mismatch — the copy was discarded',
          `source ${digest}, target ${result.sha256}`
        )
      }

      // A move deletes the source only after the copy is verified, and before the
      // job is reported done — otherwise a watcher sees 'done' while the original
      // is still there. A failed deletion leaves a duplicate, so say so rather
      // than swallowing it: the copy itself did succeed.
      let moveNote: string | undefined
      if (this.batches.get(unit.batchId)?.operation === 'move') {
        try {
          await source.remove([unit.source.path])
        } catch (err) {
          moveNote = `Copied, but the original could not be removed: ${toAppError(err).message}`
        }
      }

      this.patchJob(unit.jobId, {
        status: 'done',
        transferredBytes: result.bytes,
        finishedAt: Date.now(),
        bps,
        ...(digest === undefined ? {} : { sha256: digest }),
        ...(moveNote === undefined ? {} : { error: moveNote })
      })
    } catch (err) {
      this.patchJob(unit.jobId, {
        status: aborted ? 'cancelled' : 'failed',
        finishedAt: Date.now(),
        bps: null,
        error: aborted ? 'Cancelled' : toAppError(err).message
      })
    } finally {
      this.activeAbort = null
      // Release the descriptor and the buffered window on *every* exit path.
      // A rejected `target.write` used to leave the source still piped into a
      // meter that nobody drains: the fd stayed open and a full
      // `bufferWindowBytes` stayed reachable for the life of the process, so a
      // batch that failed part-way — a peer resetting the connection, say —
      // leaked a window per file until the machine ran out of memory.
      readable?.destroy()
      meter.destroy()
    }
  }

  /** Applies the configured policy, prompting the user only when asked to. */
  private async decideConflict(
    unit: QueuedUnit,
    existing: DirEntry,
    settings: Settings
  ): Promise<Exclude<ConflictResolution, never>> {
    switch (settings.conflictPolicy) {
      case 'overwrite-if-newer':
        return unit.mtimeMs > existing.mtimeMs ? 'overwrite' : 'skip'
      case 'keep-both':
        return 'keep-both'
      case 'skip-identical':
        // Same size and mtime within filesystem granularity: treat as identical.
        return unit.size === existing.size && Math.abs(unit.mtimeMs - existing.mtimeMs) < 2000
          ? 'skip'
          : 'overwrite'
      case 'ask':
      default:
        return this.prompt(unit, existing)
    }
  }

  private prompt(unit: QueuedUnit, existing: DirEntry): Promise<ConflictResolution> {
    this.patchJob(unit.jobId, { status: 'awaiting-decision' })
    const source: DirEntry = {
      name: basenameFor(this.deps.providerFor(unit.source.nodeId).platform, unit.source.path),
      path: unit.source.path,
      isDir: false,
      size: unit.size,
      mtimeMs: unit.mtimeMs,
      ext: '',
      mode: '',
      hidden: false,
      symlink: false
    }
    const prompt: ConflictPrompt = {
      jobId: unit.jobId,
      source,
      target: existing,
      targetPath: unit.target.path
    }
    return new Promise<ConflictResolution>((resolve) => {
      this.pendingDecisions.set(unit.jobId, resolve)
      for (const listener of this.conflictListeners) listener(prompt)
    })
  }

  /**
   * `immediate` is opt-in: `snapshot()` copies every job and batch, so emitting
   * one per job transition made a batch cost O(files^2) in allocation and shipped
   * the whole job list over IPC thousands of times. Queue state is not worth a
   * sub-100 ms guarantee; the throttle in `emit` coalesces the bursts, and
   * `pump` still emits immediately once the queue drains.
   */
  private patchJob(jobId: string, changes: Partial<TransferJob>, immediate = false): void {
    const job = this.jobs.get(jobId)
    if (job === undefined) return
    this.jobs.set(jobId, { ...job, ...changes })
    this.emit(immediate)
  }
}

/** `clip.mov` -> `clip (2).mov`, probing the target until a free name is found. */
async function uniquePath(
  target: { stat(path: string): Promise<DirEntry>; platform: 'win32' | 'darwin' | 'linux' },
  path: string
): Promise<string> {
  const dir = dirnameFor(target.platform, path)
  const name = basenameFor(target.platform, path)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  for (let n = 2; n < 1000; n += 1) {
    const candidate = joinFor(target.platform, dir, `${stem} (${n})${ext}`)
    const exists = await target.stat(candidate).then(
      () => true,
      () => false
    )
    if (!exists) return candidate
  }
  throw new OmniError(ErrorCode.EXISTS, 'Could not find a free filename', path)
}
