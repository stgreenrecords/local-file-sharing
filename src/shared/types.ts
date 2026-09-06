/**
 * Types shared by main, preload and renderer.
 * Keep this file free of `node:` and `electron` imports.
 */

export const PROTOCOL_VERSION = 1
export const LOCAL_NODE_ID = 'local'
export const SERVICE_TYPE = 'omnidirect'

export type NodePlatform = 'win32' | 'darwin' | 'linux'

/** Connection state of a peer, as far as this machine can tell. */
export type PeerState =
  | 'discovered' /* seen via mDNS, reachable, no trust established */
  | 'paired' /* we hold a token and it was accepted */
  | 'pairing' /* pair request in flight */
  | 'unreachable' /* advertised but the probe failed */
  | 'incompatible' /* protocol major version differs */

export interface NodeRef {
  id: string
  name: string
  platform: NodePlatform
}

export interface Peer extends NodeRef {
  host: string
  addresses: string[]
  port: number
  /** First 16 hex chars of SHA-256(node secret). Identity fingerprint. */
  fingerprint: string
  protocolVersion: number
  state: PeerState
  /** Round-trip time of the last /api/hello probe, in ms. */
  rttMs: number | null
  lastSeen: number
  volumes: Volume[]
  error?: string
}

export type VolumeKind = 'fixed' | 'removable' | 'network' | 'home'

export interface Volume {
  /** Native mount path: `C:\` on Windows, `/` or `/Volumes/Data` on macOS. */
  path: string
  label: string
  fs: string
  totalBytes: number
  freeBytes: number
  kind: VolumeKind
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  /** Always 0 for directories — listings never recursively size a folder. */
  size: number
  mtimeMs: number
  /** Lowercase extension without the dot; empty for directories and dotfiles. */
  ext: string
  /** POSIX-style mode string on macOS/Linux, DOS attribute letters on Windows. */
  mode: string
  hidden: boolean
  symlink: boolean
}

/** A path always belongs to a node. This is the unit of navigation. */
export interface PathRef {
  nodeId: string
  path: string
}

/* ── Panes ───────────────────────────────────────────────────────────── */

export type SortColumn = 'name' | 'ext' | 'size' | 'mtime'
export type SortDirection = 'asc' | 'desc'

export interface PaneTab {
  id: string
  nodeId: string
  path: string
  label: string
}

/* ── Transfers ───────────────────────────────────────────────────────── */

export type ConflictPolicy = 'ask' | 'overwrite-if-newer' | 'keep-both' | 'skip-identical'

export type TransferStatus =
  | 'queued'
  | 'active'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'awaiting-decision'

export interface TransferJob {
  id: string
  batchId: string
  source: PathRef
  target: PathRef
  /** Path relative to the batch root, for display. */
  relativePath: string
  totalBytes: number
  transferredBytes: number
  status: TransferStatus
  /** Bytes/sec, exponentially weighted over ~2s. Null until measurable. */
  bps: number | null
  sha256?: string
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface TransferBatch {
  id: string
  sourceNode: NodeRef
  targetNode: NodeRef
  operation: 'copy' | 'move'
  createdAt: number
  totalBytes: number
  totalFiles: number
  /** Set while the recursive walk is still counting. */
  scanning: boolean
}

export interface TransferSnapshot {
  batches: TransferBatch[]
  jobs: TransferJob[]
  paused: boolean
  /** Aggregate throughput across active jobs, bytes/sec. */
  bps: number
  bytesDone: number
  bytesTotal: number
}

export interface ConflictPrompt {
  jobId: string
  source: DirEntry
  target: DirEntry
  targetPath: string
}

export type ConflictResolution = 'overwrite' | 'skip' | 'keep-both' | 'cancel-batch'

/* ── Settings ────────────────────────────────────────────────────────── */

export type TransportProtocol = 'omnidirect' | 'smb' | 'sftp'
export type RowDensity = 'compact' | 'standard'

export interface PathMapping {
  id: string
  windows: string
  posix: string
}

export interface Settings {
  displayName: string
  /** UI */
  rowDensity: RowDensity
  showHidden: boolean
  confirmDelete: boolean
  /** Cross-platform translation */
  sanitizeWindowsNames: boolean
  stripMacMetadata: boolean
  normalizeUnicode: boolean
  pathMappings: PathMapping[]
  /** Transfer engine */
  transport: TransportProtocol
  streamWorkers: number
  bufferWindowBytes: number
  verifyChecksums: boolean
  conflictPolicy: ConflictPolicy
  bandwidthLimitBps: number | null
  /** Network */
  discoveryEnabled: boolean
  port: number
  autoPairKnownPeers: boolean
}

export interface Identity {
  nodeId: string
  displayName: string
  platform: NodePlatform
  fingerprint: string
}

export interface TrustedPeer {
  nodeId: string
  name: string
  platform: NodePlatform
  fingerprint: string
  pairedAt: number
  /** Last endpoint that answered, so a known peer reconnects without mDNS. */
  lastHost?: string
  lastPort?: number
}

/** Live daemon status, polled by the header/status bar. */
export interface DaemonStatus {
  identity: Identity
  serverPort: number
  serverListening: boolean
  discoveryActive: boolean
  interfaceName: string | null
  interfaceAddress: string | null
  /** False when the active address is outside RFC1918 — plaintext warning. */
  privateNetwork: boolean
  /** Currently displayed pairing PIN, or null when pairing is locked out. */
  pairingPin: string | null
  pairingLockedUntil: number | null
  peerCount: number
  pairedCount: number
}

/* ── IPC envelope ────────────────────────────────────────────────────── */

export interface AppError {
  code: string
  message: string
  detail?: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
