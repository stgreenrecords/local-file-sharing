/**
 * mDNS/Bonjour discovery. Advertises this machine and browses for others, then
 * probes each find over HTTP to confirm it is really reachable and measure RTT.
 *
 * Discovery only tells us a machine exists. Trust is separate (see auth.ts), so a
 * newly discovered peer is listed but cannot read anything until it is paired.
 */
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { PROTOCOL_VERSION, SERVICE_TYPE, type NodePlatform, type Peer } from '@shared/types'
import { store } from '../store'
import { hello } from './client'
import * as registry from './registry'
import { rankPeerAddresses } from './interfaces'
export { activeInterface } from './interfaces'

/** Refresh cadence for a peer that is answering. */
const REPROBE_MS = 15_000
/** How often the scheduler wakes to see whose turn it is. */
const TICK_MS = 1500
/** First retry delay after a failure; doubles up to REPROBE_MS. */
const RETRY_BASE_MS = 2000
/** Failures tolerated before the raw network error is shown to the user. */
const QUIET_FAILURES = 3

let bonjour: Bonjour | null = null
let browser: Browser | null = null
let published: Service | null = null
let reprobeTimer: NodeJS.Timeout | null = null

/** Per-peer retry bookkeeping, so a peer that is down is not hammered. */
const schedule = new Map<string, { failures: number; nextAt: number; inFlight: boolean }>()

export interface DiscoveryOptions {
  port: number
}

export async function startDiscovery(options: DiscoveryOptions): Promise<void> {
  await stopDiscovery()
  const identity = store().identity()
  bonjour = new Bonjour()

  published = bonjour.publish({
    // The mDNS instance name must be unique on the subnet or the advertisement is
    // rejected outright. Two machines sharing a hostname is common (two fresh
    // installs, or two dev instances), so the fingerprint disambiguates. The
    // human-facing name travels in the TXT record instead.
    name: `${identity.displayName}-${identity.fingerprint.slice(0, 6)}`,
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

}

/**
 * Seeds known machines and keeps every peer's reachability fresh.
 *
 * Deliberately independent of mDNS: trust and the last working endpoint are both
 * persisted, so a paired machine reconnects even when the beacon is switched off
 * or multicast is blocked on the network.
 */
export function startPeerMaintenance(): void {
  stopPeerMaintenance()
  seedTrustedPeers()
  // A short tick with per-peer backoff: a machine that comes online is picked up
  // in a couple of seconds rather than after a fixed 15s window, while one that
  // is genuinely off is retried progressively less often.
  reprobeTimer = setInterval(() => void tick(), TICK_MS)
  reprobeTimer.unref?.()
  void tick()
}

export function stopPeerMaintenance(): void {
  if (reprobeTimer !== null) {
    clearInterval(reprobeTimer)
    reprobeTimer = null
  }
  schedule.clear()
}

async function tick(): Promise<void> {
  const now = Date.now()
  const due = registry.list().filter((peer) => {
    if (peer.state === 'incompatible' || peer.port === 0) return false
    const entry = schedule.get(peer.id)
    if (entry === undefined) return true
    return !entry.inFlight && now >= entry.nextAt
  })
  await Promise.all(due.map((peer) => probe(peer.id)))
}

export async function stopDiscovery(): Promise<void> {
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

/**
 * Every address the peer advertised, best first. A machine announces all of its
 * interfaces, and virtual ones (WSL, Docker, VM hosts) often sort first, so the
 * naive "first IPv4" pick lands on an address no other machine can route to.
 */
function candidateAddresses(service: Service, fallbackHost?: string): string[] {
  const advertised = service.addresses ?? []
  const ranked = rankPeerAddresses(advertised)
  // `service.host` is the .local name — a usable last resort if every literal
  // address is filtered out or unreachable.
  const extras = [service.host, fallbackHost].filter(
    (h): h is string => typeof h === 'string' && h !== '' && !ranked.includes(h)
  )
  return [...ranked, ...extras]
}

async function onServiceUp(service: Service): Promise<void> {
  const id = txtValue(service, 'id')
  const identity = store().identity()
  // mDNS echoes our own advertisement back to us.
  if (id === undefined || id === identity.nodeId) return

  const known = registry.get(id)
  const candidates = candidateAddresses(service, known?.host)
  const host = candidates[0]
  if (host === undefined) return

  const version = Number(txtValue(service, 'ver') ?? '0')
  const base: Peer = {
    id,
    name: txtValue(service, 'name') ?? service.name ?? host,
    platform: (txtValue(service, 'platform') ?? 'linux') as NodePlatform,
    host,
    addresses: candidates,
    port: service.port,
    fingerprint: txtValue(service, 'fp') ?? '',
    protocolVersion: version,
    state: version === PROTOCOL_VERSION ? 'discovered' : 'incompatible',
    rttMs: null,
    lastSeen: Date.now(),
    volumes: known?.volumes ?? []
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
  if (peer.port === 0) return
  const token = store().tokenFor(nodeId)

  const entry = schedule.get(nodeId) ?? { failures: 0, nextAt: 0, inFlight: false }
  if (entry.inFlight) return
  entry.inFlight = true
  schedule.set(nodeId, entry)

  // Try the current address first, then the rest of what the peer advertised.
  // One machine can announce a virtual adapter that no peer can route to, so a
  // single failure says nothing about whether the machine is reachable.
  const attempts = [peer.host, ...peer.addresses].filter(
    (host, index, all) => host !== '' && all.indexOf(host) === index
  )

  let lastError = 'Probe failed'
  for (const host of attempts) {
    try {
      const { hello: info, rttMs } = await hello(host, peer.port, token ?? undefined)
      const paired = token !== null && info.paired
      registry.patch(nodeId, {
        // Remember the address that answered so later calls go straight there.
        host,
        name: info.name,
        platform: info.platform,
        fingerprint: info.fp,
        protocolVersion: info.ver,
        rttMs,
        lastSeen: Date.now(),
        state: paired ? 'paired' : 'discovered',
        error: undefined,
        ...(paired ? {} : { volumes: [] })
      })
      if (paired) {
        // Keep the working endpoint so the next launch reconnects on its own.
        store().rememberEndpoint(nodeId, host, peer.port)
        await loadVolumes(nodeId)
      }
      schedule.set(nodeId, { failures: 0, nextAt: Date.now() + REPROBE_MS, inFlight: false })
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Probe failed'
    }
  }

  const failures = entry.failures + 1
  schedule.set(nodeId, {
    failures,
    nextAt: Date.now() + Math.min(RETRY_BASE_MS * 2 ** (failures - 1), REPROBE_MS),
    inFlight: false
  })

  // A machine we have paired with is usually just booting or asleep. Saying
  // "reconnecting" for the first few attempts avoids alarming the user during a
  // normal startup race; after that, show what actually went wrong.
  const trusted = store().tokenFor(nodeId) !== null
  const detail = attempts.length > 1 ? `${lastError} (tried ${attempts.join(', ')})` : lastError
  registry.patch(nodeId, {
    state: 'unreachable',
    rttMs: null,
    error: trusted && failures <= QUIET_FAILURES ? 'Reconnecting…' : detail
  })
}

/**
 * Finds an address that answers, updating the registry, and returns it. Pairing
 * uses this so the PIN is not spent on an address that cannot be reached.
 */
export async function resolveEndpoint(nodeId: string): Promise<string | null> {
  await probe(nodeId)
  const peer = registry.get(nodeId)
  if (peer === undefined || peer.state === 'unreachable') return null
  return peer.host === '' ? null : peer.host
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
  // Manual rescan: clear the backoff so every peer is retried at once.
  for (const [id, entry] of schedule) schedule.set(id, { ...entry, nextAt: 0 })
  await Promise.all(registry.list().map((peer) => probe(peer.id)))
}

/**
 * Machines we have already paired with. Trust and the last working endpoint both
 * survive a restart, so these are seeded and probed immediately — a known peer
 * reconnects on its own without waiting for mDNS or asking for a PIN again.
 */
function seedTrustedPeers(): void {
  const reconnect = store().settings().autoPairKnownPeers
  for (const trusted of store().trustedPeers()) {
    if (registry.get(trusted.nodeId) !== undefined) continue
    const host = trusted.lastHost ?? ''
    const port = trusted.lastPort ?? 0
    registry.upsert({
      id: trusted.nodeId,
      name: trusted.name,
      platform: trusted.platform,
      host,
      addresses: host === '' ? [] : [host],
      port,
      fingerprint: trusted.fingerprint,
      protocolVersion: PROTOCOL_VERSION,
      state: 'unreachable',
      rttMs: null,
      lastSeen: 0,
      volumes: [],
      error:
        host === ''
          ? 'Waiting for this machine to come online'
          : 'Reconnecting…'
    })
    // probe() promotes it to 'paired' and loads its drives if it answers.
    if (reconnect && host !== '' && port !== 0) void probe(trusted.nodeId)
  }
}
