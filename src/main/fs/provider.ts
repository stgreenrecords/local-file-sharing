import type { Readable } from 'node:stream'
import type { DirEntry, NodePlatform, Volume } from '@shared/types'

export interface ByteRange {
  start: number
  end?: number
}

export interface WriteOptions {
  size: number
  mtimeMs?: number
  /** Source digest; the writer verifies and reports a mismatch. */
  sha256?: string
}

export interface WriteResult {
  bytes: number
  sha256: string
}

/**
 * One filesystem, seen from this machine. `LocalProvider` hits `node:fs`;
 * `PeerProvider` issues HTTP calls. Everything above this interface — the transfer
 * engine, the IPC layer, the UI — is unaware of the difference.
 */
export interface FsProvider {
  readonly nodeId: string
  readonly platform: NodePlatform

  volumes(): Promise<Volume[]>
  list(path: string): Promise<DirEntry[]>
  stat(path: string): Promise<DirEntry>
  home(): Promise<string>
  mkdir(path: string): Promise<void>
  remove(paths: string[]): Promise<void>
  rename(from: string, to: string): Promise<void>
  read(path: string, range?: ByteRange): Promise<Readable>
  write(path: string, body: Readable, options: WriteOptions): Promise<WriteResult>
}
