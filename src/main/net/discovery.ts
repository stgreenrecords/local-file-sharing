/**
 * mDNS/Bonjour discovery. Advertises this machine and browses for others, then
 * probes each find over HTTP to confirm it is really reachable and measure RTT.
 *
 * Discovery only tells us a machine exists. Trust is separate (see auth.ts), so a
 * newly discovered peer is listed but cannot read anything until it is paired.
 */
import { networkInterfaces } from 'node:os'
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { PROTOCOL_VERSION, SERVICE_TYPE, type NodePlatform, type Peer } from '@shared/types'
import { store } from '../store'
import { hello } from './client'
import * as registry from './registry'

const REPROBE_MS = 15_000

let bonjour: Bonjour | null = null
let browser: Browser | null = null
let published: Service | null = null
let reprobeTimer: NodeJS.Timeout | null = null

export interface DiscoveryOptions {
  port: number
}

export async function startDiscovery(options: DiscoveryOptions): Promise<void> {
  await stopDiscovery()
  const identity = store().identity()
  bonjour = new Bonjour()

  published = bonjour.publish({
    name: identity.displayName,
    type: SERVICE_TYPE,
    port: options.port,
    txt: {
      id: identity.nodeId,
      name: identity.displayName,
      platform: identity.platform,
      ver: String(PROTOCOL_VERSION),
      fp: identity.fingerprint
    }
  })
  published.on('error', (err: Error) => {
    console.error('[discovery] advertise failed:', err.message)
  })

  browser = bonjour.find({ type: SERVICE_TYPE })
  browser.on('up', (service: Service) => {
    void onServiceUp(service)
  })
  browser.on('down', (service: Service) => {
    const id = txtValue(service, 'id')
    // A peer that we hold trust for is kept in the list as unreachable, so the
    // user sees it went away rather than it silently vanishing.
    if (id === undefined) return
    if (store().tokenFor(id) === null) registry.drop(id)
    else registry.patch(id, { state: 'unreachable', rttMs: null, error: 'Left the network' })
  })

  // Trusted peers are seeded immediately so they render before mDNS answers.
  seedTrustedPeers()
  reprobeTimer = setInterval(() => void reprobeAll(), REPROBE_MS)
  reprobeTimer.unref?.()
}

export async function stopDiscovery(): Promise<void> {
  if (reprobeTimer !== null) {
    clearInterval(reprobeTimer)
    reprobeTimer = null
  }
  browser?.stop()
  browser = null
  if (bonjour !== null) {
    await new Promise<void>((resolve) => {
      // unpublishAll sends goodbye packets so peers drop us promptly.
      bonjour?.unpublishAll(() => resolve())
    })
    bonjour.destroy()
    bonjour = null
  }
  published = null
}

export function rescan(): void {
  browser?.update()
  void reprobeAll()
}

/* ── internals ───────────────────────────────────────────────────────── */

function txtValue(service: Service, key: string): string | undefined {
  const txt = service.txt as Record<string, unknown> | undefined
  const value = txt?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Prefers IPv4 — Node's http client is happier with it on mixed-stack LANs. */
function pickAddress(service: Service): string | undefined {
  const addresses = (service.addresses ?? []).filter((a) => !a.startsWith('fe80'))
  const v4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
  return v4 ?? addresses[0] ?? service.host
}

async function onServiceUp(service: Service): Promise<void> {
  const id = txtValue(service, 'id')
  const identity = store().identity()
  // mDNS echoes our own advertisement back to us.
  if (id === undefined || id === identity.nodeId) return

  const host = pickAddress(service)
  if (host === undefined) return

  const version = Number(txtValue(service, 'ver') ?? '0')
  const base: Peer = {
    id,
    name: txtValue(service, 'name') ?? service.name ?? host,
    platform: (txtValue(service, 'platform') ?? 'linux') as NodePlatform,
    host,
    addresses: service.addresses ?? [host],
    port: service.port,
    fingerprint: txtValue(service, 'fp') ?? '',
    protocolVersion: version,
    state: version === PROTOCOL_VERSION ? 'discovered' : 'incompatible',
    rttMs: null,
    lastSeen: Date.now(),
    volumes: registry.get(id)?.volumes ?? []
  }
  registry.upsert(base)
  if (base.state === 'incompatible') return
  await probe(id)
}

/**
 * Confirms reachability, then — if we already hold a token — loads the peer's
 * volumes so the Discovery view can list its drives without another round trip.
 */
async function probe(nodeId: string): Promise<void> {
  const peer = registry.get(nodeId)
  if (peer === undefined || peer.state === 'incompatible') return
  const token = store().tokenFor(nodeId)

  try {
    const { hello: info, rttMs } = await hello(peer.host, peer.port, token ?? undefined)
    const paired = token !== null && info.paired
    registry.patch(nodeId, {
      name: info.name,
      platform: info.platform,
      fingerprint: info.fp,
      protocolVersion: info.ver,
      rttMs,
      lastSeen: Date.now(),
      state: paired ? 'paired' : 'discovered',
      ...(paired ? {} : { volumes: [] })
    })
    if (paired) await loadVolumes(nodeId)
    else registry.patch(nodeId, { error: undefined })
  } catch (err) {
    registry.patch(nodeId, {
      state: 'unreachable',
      rttMs: null,
      error: err instanceof Error ? err.message : 'Probe failed'
    })
  }
}

export async function loadVolumes(nodeId: string): Promise<void> {
  const peer = registry.get(nodeId)
  if (peer === undefined) return
  const { PeerProvider } = await import('./client')
  try {
    const volumes = await new PeerProvider(nodeId, peer.platform).volumes()
    registry.patch(nodeId, { volumes, error: undefined })
  } catch (err) {
    registry.patch(nodeId, {
      volumes: [],
      error: err instanceof Error ? err.message : 'Could not read volumes'
    })
  }
}

async function reprobeAll(): Promise<void> {
  await Promise.all(registry.list().map((peer) => probe(peer.id)))
}

/**
 * Peers we have paired with before, listed as unreachable until mDNS or a probe
 * proves otherwise. Their address is unknown until then, so they are seeded
 * without one and skipped by the prober.
 */
function seedTrustedPeers(): void {
  for (const trusted of store().trustedPeers()) {
    if (registry.get(trusted.nodeId) !== undefined) continue
    registry.upsert({
      id: trusted.nodeId,
      name: trusted.name,
      platform: trusted.platform,
      host: '',
      addresses: [],
      port: 0,
      fingerprint: trusted.fingerprint,
      protocolVersion: PROTOCOL_VERSION,
      state: 'unreachable',
      rttMs: null,
      lastSeen: 0,
      volumes: [],
      error: 'Waiting for this machine to come online'
    })
  }
}

/** The interface the LAN traffic will actually use, for the status bar. */
export function activeInterface(): {
  name: string | null
  address: string | null
  privateNetwork: boolean
} {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== 'IPv4') continue
      return { name, address: address.address, privateNetwork: isPrivate(address.address) }
    }
  }
  return { name: null, address: null, privateNetwork: false }
}

/** RFC1918 plus link-local and CGNAT — anything else means plaintext on a WAN. */
function isPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  if (a === undefined || b === undefined) return false
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}
