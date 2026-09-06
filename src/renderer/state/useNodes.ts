/**
 * Peer/node registry mirrored into the renderer, plus daemon status.
 * Subscribes once to the main-process event stream.
 */
import { create } from 'zustand'
import type { DaemonStatus, NodeRef, NodePlatform, Peer } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { api, run } from '../lib/api'

interface NodesState {
  peers: Peer[]
  nodes: NodeRef[]
  status: DaemonStatus | null
  refresh(): Promise<void>
  rescan(): Promise<void>
  pair(nodeId: string, pin: string): Promise<boolean>
  unpair(nodeId: string): Promise<void>
  connectManual(host: string, port: number, pin: string): Promise<boolean>
  rotatePin(): Promise<void>
  nodeName(nodeId: string): string
  platformOf(nodeId: string): NodePlatform
}

export const useNodes = create<NodesState>((set, get) => ({
  peers: [],
  nodes: [],
  status: null,

  async refresh() {
    const [status, peers, nodes] = await Promise.all([
      api().net.status(),
      api().net.peers(),
      api().net.nodes()
    ])
    set({
      ...(status.ok ? { status: status.data } : {}),
      ...(peers.ok ? { peers: peers.data } : {}),
      ...(nodes.ok ? { nodes: nodes.data } : {})
    })
  },

  async rescan() {
    await run(api().net.rescan())
  },

  async pair(nodeId, pin) {
    const result = await run(api().net.pair(nodeId, pin))
    await get().refresh()
    return result !== null
  },

  async unpair(nodeId) {
    await run(api().net.unpair(nodeId))
    await get().refresh()
  },

  async connectManual(host, port, pin) {
    const result = await run(api().net.connectManual(host, port, pin))
    await get().refresh()
    return result !== null
  },

  async rotatePin() {
    await run(api().net.rotatePin())
    await get().refresh()
  },

  nodeName(nodeId) {
    if (nodeId === LOCAL_NODE_ID) {
      return get().status?.identity.displayName ?? 'This machine'
    }
    return get().peers.find((p) => p.id === nodeId)?.name ?? nodeId
  },

  /**
   * Falls back to this machine's platform for an unknown node. Path arithmetic
   * needs *some* answer, and guessing local is right far more often than not.
   */
  platformOf(nodeId) {
    if (nodeId === LOCAL_NODE_ID) {
      return get().status?.identity.platform ?? (window.omni.platform as NodePlatform)
    }
    const peer = get().peers.find((p) => p.id === nodeId)
    return peer?.platform ?? (window.omni.platform as NodePlatform)
  }
}))

/** Called once from App: keeps the store in sync with main-process pushes. */
export function subscribeNodes(): () => void {
  const unsubscribePeers = api().on.peers((peers) => useNodes.setState({ peers }))
  const unsubscribeStatus = api().on.status((status) => useNodes.setState({ status }))
  void useNodes.getState().refresh()
  return () => {
    unsubscribePeers()
    unsubscribeStatus()
  }
}
