/**
 * The IPC contract. Channel names live here so main and preload cannot drift,
 * and the Api type is what the renderer sees on `window.omni`.
 */
import type {
  ConflictPrompt,
  ConflictResolution,
  DaemonStatus,
  DirEntry,
  NodeRef,
  PathRef,
  Peer,
  Result,
  Settings,
  TransferSnapshot,
  Volume
} from './types'

export const Channel = {
  /* invoke */
  FS_VOLUMES: 'fs:volumes',
  FS_LIST: 'fs:list',
  FS_STAT: 'fs:stat',
  FS_HOME: 'fs:home',
  FS_MKDIR: 'fs:mkdir',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_REVEAL: 'fs:reveal',
  FS_OPEN: 'fs:open',

  NET_STATUS: 'net:status',
  NET_PEERS: 'net:peers',
  NET_RESCAN: 'net:rescan',
  NET_PAIR: 'net:pair',
  NET_UNPAIR: 'net:unpair',
  NET_CONNECT_MANUAL: 'net:connectManual',
  NET_NODES: 'net:nodes',
  NET_ROTATE_PIN: 'net:rotatePin',

  TRANSFER_ENQUEUE: 'transfer:enqueue',
  TRANSFER_SNAPSHOT: 'transfer:snapshot',
  TRANSFER_PAUSE: 'transfer:pause',
  TRANSFER_RESUME: 'transfer:resume',
  TRANSFER_CANCEL_BATCH: 'transfer:cancelBatch',
  TRANSFER_CLEAR_DONE: 'transfer:clearDone',
  TRANSFER_RESOLVE: 'transfer:resolveConflict',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_EXPORT: 'settings:export',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  /* main -> renderer events */
  EVENT_PEERS: 'event:peers',
  EVENT_STATUS: 'event:status',
  EVENT_TRANSFERS: 'event:transfers',
  EVENT_CONFLICT: 'event:conflict',
  EVENT_DIR_CHANGED: 'event:dirChanged'
} as const

export interface EnqueueRequest {
  sources: PathRef[]
  targetDir: PathRef
  operation: 'copy' | 'move'
}

export interface OmniApi {
  fs: {
    volumes(nodeId: string): Promise<Result<Volume[]>>
    list(ref: PathRef): Promise<Result<DirEntry[]>>
    stat(ref: PathRef): Promise<Result<DirEntry>>
    home(nodeId: string): Promise<Result<string>>
    mkdir(ref: PathRef): Promise<Result<void>>
    remove(nodeId: string, paths: string[]): Promise<Result<void>>
    rename(nodeId: string, from: string, to: string): Promise<Result<void>>
    reveal(ref: PathRef): Promise<Result<void>>
    open(ref: PathRef): Promise<Result<void>>
  }
  net: {
    status(): Promise<Result<DaemonStatus>>
    peers(): Promise<Result<Peer[]>>
    nodes(): Promise<Result<NodeRef[]>>
    rescan(): Promise<Result<void>>
    pair(nodeId: string, pin: string): Promise<Result<Peer>>
    unpair(nodeId: string): Promise<Result<void>>
    connectManual(host: string, port: number, pin: string): Promise<Result<Peer>>
    rotatePin(): Promise<Result<string>>
  }
  transfer: {
    enqueue(req: EnqueueRequest): Promise<Result<string>>
    snapshot(): Promise<Result<TransferSnapshot>>
    pause(): Promise<Result<void>>
    resume(): Promise<Result<void>>
    cancelBatch(batchId: string): Promise<Result<void>>
    clearDone(): Promise<Result<void>>
    resolveConflict(jobId: string, resolution: ConflictResolution): Promise<Result<void>>
  }
  settings: {
    get(): Promise<Result<Settings>>
    set(patch: Partial<Settings>): Promise<Result<Settings>>
    reset(): Promise<Result<Settings>>
    exportConfig(): Promise<Result<string | null>>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on: {
    peers(cb: (peers: Peer[]) => void): () => void
    status(cb: (status: DaemonStatus) => void): () => void
    transfers(cb: (snapshot: TransferSnapshot) => void): () => void
    conflict(cb: (prompt: ConflictPrompt) => void): () => void
    dirChanged(cb: (ref: PathRef) => void): () => void
  }
  platform: NodeJS.Platform
}

export type { ConflictResolution }
