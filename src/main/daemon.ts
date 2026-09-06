/**
 * Daemon lifecycle: bind the server, start advertising, and report status.
 * Kept separate from `index.ts` so the IPC layer can read status without
 * importing Electron's app bootstrap.
 */
import type { DaemonStatus } from '@shared/types'
import { pairingLockedUntil, pairingPin } from './net/auth'
import {
  activeInterface,
  startDiscovery,
  startPeerMaintenance,
  stopDiscovery,
  stopPeerMaintenance
} from './net/discovery'
import { refreshRouteAddress } from './net/interfaces'
import * as registry from './net/registry'
import { startServer, type ServerHandle } from './net/server'
import { store } from './store'

let handle: ServerHandle | null = null
let discovering = false

export async function startDaemon(): Promise<void> {
  // Warm the route lookup so the very first status report names the real NIC
  // rather than falling back to adapter-name heuristics.
  await refreshRouteAddress()
  const settings = store().settings()
  handle = await startServer(settings.port)

  // The bound port can differ from the preferred one (second instance, or a
  // conflict); persist what we actually got so the next launch is stable.
  if (handle.port !== settings.port) store().patchSettings({ port: handle.port })

  // Reconnecting to known machines does not depend on the beacon, so this runs
  // whether or not mDNS is enabled.
  startPeerMaintenance()

  if (settings.discoveryEnabled) {
    try {
      await startDiscovery({ port: handle.port })
      discovering = true
    } catch (err) {
      // No mDNS (blocked UDP 5353, no permission) still leaves manual IP pairing.
      console.error('[daemon] discovery unavailable:', (err as Error).message)
      discovering = false
    }
  }
}

export async function stopDaemon(): Promise<void> {
  stopPeerMaintenance()
  await stopDiscovery()
  discovering = false
  await handle?.close()
  handle = null
}

/** Applies a settings change that the daemon cares about. */
export async function reconfigureDaemon(): Promise<void> {
  await stopDaemon()
  registry.clear()
  await startDaemon()
}

export function serverPort(): number {
  return handle?.port ?? store().settings().port
}

export function daemonStatus(): DaemonStatus {
  const iface = activeInterface()
  const peers = registry.list()
  return {
    identity: store().identity(),
    serverPort: serverPort(),
    serverListening: handle !== null,
    discoveryActive: discovering,
    interfaceName: iface.name,
    interfaceAddress: iface.address,
    privateNetwork: iface.privateNetwork,
    pairingPin: pairingPin(),
    pairingLockedUntil: pairingLockedUntil(),
    peerCount: peers.length,
    pairedCount: peers.filter((p) => p.state === 'paired').length
  }
}
