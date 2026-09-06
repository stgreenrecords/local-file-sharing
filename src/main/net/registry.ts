/**
 * The peer table. Plain state with a change listener, so `discovery` (which
 * writes) and `client` (which reads addresses) do not have to import each other.
 */
import type { NodeRef, Peer } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { ErrorCode, OmniError } from '@shared/errors'
import { store } from '../store'

const peers = new Map<string, Peer>()
const listeners = new Set<(peers: Peer[]) => void>()

let notifyScheduled = false

function notify(): void {
  // Discovery fires bursts of events (one per resolved address); coalesce them.
  if (notifyScheduled) return
  notifyScheduled = true
  setImmediate(() => {
    notifyScheduled = false
    const snapshot = list()
    for (const listener of listeners) listener(snapshot)
  })
}

export function onPeersChanged(listener: (peers: Peer[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function list(): Peer[] {
  return [...peers.values()].sort((a, b) => {
    // Paired peers first, then by latency, then by name.
    const rank = (p: Peer): number => (p.state === 'paired' ? 0 : p.state === 'discovered' ? 1 : 2)
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    const byRtt = (a.rttMs ?? Number.MAX_SAFE_INTEGER) - (b.rttMs ?? Number.MAX_SAFE_INTEGER)
    if (byRtt !== 0) return byRtt
    return a.name.localeCompare(b.name)
  })
}

export function get(nodeId: string): Peer | undefined {
  return peers.get(nodeId)
}

/** The peer's best address, preferring one that a probe has already reached. */
export function endpointFor(nodeId: string): { host: string; port: number; token: string } {
  const peer = peers.get(nodeId)
  if (peer === undefined) {
    throw new OmniError(ErrorCode.UNKNOWN_NODE, `No known peer with id ${nodeId}`)
  }
  const token = store().tokenFor(nodeId)
  if (token === null) {
    throw new OmniError(ErrorCode.NOT_PAIRED, `Not paired with ${peer.name}`)
  }
  return { host: peer.host, port: peer.port, token }
}

export function upsert(peer: Peer): void {
  const existing = peers.get(peer.id)
  peers.set(peer.id, existing === undefined ? peer : { ...existing, ...peer })
  notify()
}

export function patch(nodeId: string, changes: Partial<Peer>): void {
  const existing = peers.get(nodeId)
  if (existing === undefined) return
  peers.set(nodeId, { ...existing, ...changes })
  notify()
}

export function drop(nodeId: string): void {
  if (peers.delete(nodeId)) notify()
}

export function clear(): void {
  peers.clear()
  notify()
}

/** Nodes selectable in the UI: this machine plus every paired peer. */
export function selectableNodes(): NodeRef[] {
  const identity = store().identity()
  const self: NodeRef = {
    id: LOCAL_NODE_ID,
    name: `${identity.displayName} (this machine)`,
    platform: identity.platform
  }
  const paired = list()
    .filter((p) => p.state === 'paired')
    .map(({ id, name, platform }): NodeRef => ({ id, name, platform }))
  return [self, ...paired]
}
