/**
 * Picking the address this machine is actually reachable on.
 *
 * Naively taking the first non-internal IPv4 address is wrong on any machine
 * with WSL, Docker, a VM host or a VPN installed: those virtual adapters often
 * enumerate before the real NIC, and advertising one shows the user an address
 * no peer can reach.
 *
 * Deliberately free of `electron` imports so the selection logic is testable.
 */
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'

/** Adapter names that are virtual rather than a path onto the LAN. */
const VIRTUAL_ADAPTER =
  /wsl|hyper-v|vethernet|virtualbox|vmware|vmnet|docker|loopback|tailscale|zerotier|tap-|utun|bridge\d|llw\d|awdl/i

export interface InterfaceCandidate {
  name: string
  address: string
}

export interface ActiveInterface {
  name: string | null
  address: string | null
  privateNetwork: boolean
}

/** RFC1918 plus link-local and CGNAT. Anything else means plaintext on a WAN. */
export function isPrivateAddress(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return false
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * Chooses among candidates, preferring the one that owns the default route,
 * then the first non-virtual adapter, then whatever is left.
 */
export function chooseInterface(
  candidates: InterfaceCandidate[],
  routedAddress: string | null
): ActiveInterface {
  const routed =
    routedAddress === null ? undefined : candidates.find((c) => c.address === routedAddress)
  const physical = candidates.find((c) => !VIRTUAL_ADAPTER.test(c.name))
  const chosen = routed ?? physical ?? candidates[0]

  if (chosen === undefined) return { name: null, address: null, privateNetwork: false }
  return {
    name: chosen.name,
    address: chosen.address,
    privateNetwork: isPrivateAddress(chosen.address)
  }
}

export function listCandidates(): InterfaceCandidate[] {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((a) => !a.internal && a.family === 'IPv4')
      .map((a) => ({ name, address: a.address }))
  )
}

const ROUTE_TTL_MS = 10_000
const ROUTE_TIMEOUT_MS = 1000

let cache: { at: number; address: string | null } = { at: 0, address: null }
let inFlight: Promise<string | null> | null = null

/**
 * Asks the kernel which source address it would use for outbound traffic.
 *
 * `connect` on a UDP socket sends no packet — it only applies the routing table
 * and binds a source address, which names the default-route interface directly.
 * That beats guessing from adapter names, and it follows a VPN when one owns the
 * default route.
 *
 * The bind happens asynchronously, so the address is only readable from the
 * connect callback; callers that need a synchronous answer read the cache.
 */
export function refreshRouteAddress(): Promise<string | null> {
  if (inFlight !== null) return inFlight
  inFlight = new Promise<string | null>((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const done = (address: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      const clean = address === '0.0.0.0' || address === '::' ? null : address
      cache = { at: Date.now(), address: clean }
      inFlight = null
      resolve(clean)
    }
    const timer = setTimeout(() => done(null), ROUTE_TIMEOUT_MS)
    timer.unref?.()

    socket.once('error', () => done(null))
    try {
      // 192.0.2.0/24 is the RFC5737 documentation range: present in the routing
      // table, never actually reachable, and nothing is sent to it.
      socket.connect(53, '192.0.2.1', () => {
        try {
          done(socket.address().address)
        } catch {
          done(null)
        }
      })
    } catch {
      done(null)
    }
  })
  return inFlight
}

/**
 * The last known default-route address. Synchronous for the status bar; a stale
 * value triggers a background refresh so it self-heals when the route changes.
 */
export function routeAddress(): string | null {
  if (Date.now() - cache.at >= ROUTE_TTL_MS) void refreshRouteAddress()
  return cache.address
}

export function activeInterface(): ActiveInterface {
  return chooseInterface(listCandidates(), routeAddress())
}
