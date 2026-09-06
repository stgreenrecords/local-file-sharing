import { create } from 'zustand'
import type { ConflictPrompt, ConflictResolution, TransferSnapshot } from '@shared/types'
import { api, run } from '../lib/api'

/** Rolling throughput samples for the waveform chart, ~1s apart. */
export interface RateSample {
  at: number
  bps: number
}

const MAX_SAMPLES = 90
const SAMPLE_INTERVAL_MS = 1000

interface TransfersState {
  snapshot: TransferSnapshot
  samples: RateSample[]
  conflict: ConflictPrompt | null
  pause(): Promise<void>
  resume(): Promise<void>
  cancelBatch(batchId: string): Promise<void>
  clearDone(): Promise<void>
  resolve(resolution: ConflictResolution): Promise<void>
}

const emptySnapshot: TransferSnapshot = {
  batches: [],
  jobs: [],
  paused: false,
  bps: 0,
  bytesDone: 0,
  bytesTotal: 0
}

export const useTransfers = create<TransfersState>((set, get) => ({
  snapshot: emptySnapshot,
  samples: [],
  conflict: null,

  async pause() {
    await run(api().transfer.pause())
  },
  async resume() {
    await run(api().transfer.resume())
  },
  async cancelBatch(batchId) {
    await run(api().transfer.cancelBatch(batchId))
  },
  async clearDone() {
    await run(api().transfer.clearDone())
  },
  async resolve(resolution) {
    const prompt = get().conflict
    if (prompt === null) return
    set({ conflict: null })
    await run(api().transfer.resolveConflict(prompt.jobId, resolution))
  }
}))

export function subscribeTransfers(): () => void {
  let lastSampleAt = 0

  const unsubscribeSnapshot = api().on.transfers((snapshot) => {
    const now = Date.now()
    // The engine emits every ~100ms; the chart only needs a point per second.
    if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
      lastSampleAt = now
      useTransfers.setState((state) => ({
        snapshot,
        samples: [...state.samples, { at: now, bps: snapshot.bps }].slice(-MAX_SAMPLES)
      }))
      return
    }
    useTransfers.setState({ snapshot })
  })

  const unsubscribeConflict = api().on.conflict((conflict) =>
    useTransfers.setState({ conflict })
  )

  void run(api().transfer.snapshot()).then((snapshot) => {
    if (snapshot !== null) useTransfers.setState({ snapshot })
  })

  return () => {
    unsubscribeSnapshot()
    unsubscribeConflict()
  }
}

/** Jobs grouped the way the Queue view renders them. */
export function partitionJobs(snapshot: TransferSnapshot): {
  active: TransferSnapshot['jobs']
  pending: TransferSnapshot['jobs']
  completed: TransferSnapshot['jobs']
  failed: TransferSnapshot['jobs']
} {
  return {
    active: snapshot.jobs.filter((j) => j.status === 'active' || j.status === 'awaiting-decision'),
    pending: snapshot.jobs.filter((j) => j.status === 'queued'),
    completed: snapshot.jobs.filter((j) => j.status === 'done' || j.status === 'skipped'),
    failed: snapshot.jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled')
  }
}
