/**
 * Pairing state: the PIN this machine currently displays, brute-force lockout,
 * and inbound bearer-token verification.
 *
 * The PIN lives only in memory — it is meant to be read off the target's screen,
 * so it must not survive a restart.
 */
import { randomInt } from 'node:crypto'
import type { NodePlatform } from '@shared/types'
import { ErrorCode, OmniError } from '@shared/errors'
import { store } from '../store'

const PIN_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 3
const ATTEMPT_WINDOW_MS = 60_000
const LOCKOUT_MS = 5 * 60_000

interface PinState {
  pin: string
  issuedAt: number
}

let current: PinState | null = null
let attempts: number[] = []
let lockedUntil = 0
const listeners = new Set<() => void>()

const newPin = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0')

function notify(): void {
  for (const listener of listeners) listener()
}

export function onPairingChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The PIN to display, rotating on expiry. Null while locked out. */
export function pairingPin(): string | null {
  if (Date.now() < lockedUntil) return null
  if (current === null || Date.now() - current.issuedAt > PIN_TTL_MS) {
    current = { pin: newPin(), issuedAt: Date.now() }
  }
  return current.pin
}

export function rotatePin(): string | null {
  current = { pin: newPin(), issuedAt: Date.now() }
  notify()
  return pairingPin()
}

export function pairingLockedUntil(): number | null {
  return Date.now() < lockedUntil ? lockedUntil : null
}

/**
 * Verifies a PIN from an inbound pair request and, on success, mints a token.
 * The PIN rotates after every successful pair so a shoulder-surfed code is
 * single-use.
 */
export function verifyPinAndIssueToken(peer: {
  nodeId: string
  name: string
  platform: NodePlatform
  pin: string
}): string {
  const now = Date.now()
  if (now < lockedUntil) {
    throw new OmniError(
      ErrorCode.PAIR_LOCKED,
      'Pairing is temporarily locked after repeated bad PINs'
    )
  }

  const expected = pairingPin()
  const supplied = peer.pin.replace(/\D/g, '')
  if (expected === null || supplied.length !== 6 || !constantTimeEqual(expected, supplied)) {
    attempts = [...attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS), now]
    if (attempts.length >= MAX_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS
      attempts = []
      notify()
      throw new OmniError(ErrorCode.PAIR_LOCKED, 'Too many bad PINs — pairing locked')
    }
    notify()
    throw new OmniError(ErrorCode.BAD_PIN, 'Incorrect pairing PIN')
  }

  attempts = []
  const token = store().issueToken({
    nodeId: peer.nodeId,
    name: peer.name,
    platform: peer.platform
  })
  rotatePin()
  return token
}

/** Resolves the `Authorization` header to a paired peer, or throws. */
export function requirePeer(authorization: string | undefined): {
  nodeId: string
  name: string
  platform: NodePlatform
} {
  const token = /^Bearer\s+([0-9a-f]{64})$/i.exec(authorization ?? '')?.[1]
  if (token === undefined) {
    throw new OmniError(ErrorCode.NOT_PAIRED, 'Missing or malformed bearer token')
  }
  const peer = store().peerForToken(token.toLowerCase())
  if (peer === null) {
    throw new OmniError(ErrorCode.NOT_PAIRED, 'This machine has not been paired with you')
  }
  return peer
}

/** Non-throwing variant, for `/api/hello` which reports pairing state. */
export function peerFromHeader(authorization: string | undefined): { nodeId: string } | null {
  try {
    return requirePeer(authorization)
  } catch {
    return null
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
