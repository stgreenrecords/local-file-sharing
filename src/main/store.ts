/**
 * Settings + trust persistence. A single JSON file written atomically, because the
 * daemon (pairing, port fallback) and the UI (settings edits) both mutate it.
 *
 * `OMNI_DATA_DIR` relocates the whole file, which is how a second dev instance on
 * the same machine gets its own identity.
 */
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { Identity, NodePlatform, Settings, TrustedPeer } from '@shared/types'

interface Persisted {
  version: 1
  identity: { nodeId: string; displayName: string; secret: string }
  trust: Record<string, TrustedPeer & { token: string }>
  /** Tokens *we* issued to peers, so we can recognise them on inbound requests. */
  issued: Record<string, { token: string; name: string; platform: NodePlatform; at: number }>
  settings: Settings
}

export const DEFAULT_PORT = 47654

export const defaultSettings = (): Settings => ({
  displayName: hostname(),
  rowDensity: 'standard',
  showHidden: false,
  confirmDelete: true,
  sanitizeWindowsNames: true,
  stripMacMetadata: true,
  normalizeUnicode: true,
  pathMappings: [],
  transport: 'omnidirect',
  streamWorkers: 1,
  bufferWindowBytes: 4 * 1024 * 1024,
  verifyChecksums: true,
  conflictPolicy: 'ask',
  bandwidthLimitBps: null,
  discoveryEnabled: true,
  port: Number(process.env['OMNI_PORT']) || DEFAULT_PORT,
  autoPairKnownPeers: true
})

function dataDir(): string {
  const override = process.env['OMNI_DATA_DIR']
  if (override) return resolve(override)
  return app.getPath('userData')
}

class Store {
  private state: Persisted
  private readonly file: string

  constructor() {
    const dir = dataDir()
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'omni.json')
    this.state = this.load()
  }

  private load(): Persisted {
    const fresh = (): Persisted => ({
      version: 1,
      identity: {
        nodeId: randomUUID(),
        displayName: hostname(),
        secret: randomBytes(32).toString('hex')
      },
      trust: {},
      issued: {},
      settings: defaultSettings()
    })

    if (!existsSync(this.file)) {
      const created = fresh()
      this.state = created
      this.flush()
      return created
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
      const base = fresh()
      return {
        version: 1,
        identity: { ...base.identity, ...parsed.identity },
        trust: parsed.trust ?? {},
        issued: parsed.issued ?? {},
        // Merge so a new setting added in an update gets its default.
        settings: { ...base.settings, ...parsed.settings }
      }
    } catch {
      // A corrupt config must not brick the app; keep the bad file for inspection.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
      const created = fresh()
      this.state = created
      this.flush()
      return created
    }
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  /* ── identity ─────────────────────────────────────────────────────── */

  get nodeId(): string {
    return this.state.identity.nodeId
  }

  get secret(): string {
    return this.state.identity.secret
  }

  get fingerprint(): string {
    return createHash('sha256').update(this.state.identity.secret).digest('hex').slice(0, 16)
  }

  identity(): Identity {
    return {
      nodeId: this.nodeId,
      displayName: this.state.settings.displayName,
      platform: process.platform as NodePlatform,
      fingerprint: this.fingerprint
    }
  }

  /* ── settings ─────────────────────────────────────────────────────── */

  settings(): Settings {
    return { ...this.state.settings, pathMappings: [...this.state.settings.pathMappings] }
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.state.settings, ...patch }
    this.flush()
    return this.settings()
  }

  resetSettings(): Settings {
    // Keep the display name: it is identity, not preference.
    const displayName = this.state.settings.displayName
    this.state.settings = { ...defaultSettings(), displayName }
    this.flush()
    return this.settings()
  }

  /* ── trust: tokens we hold for peers (outbound) ───────────────────── */

  tokenFor(nodeId: string): string | null {
    return this.state.trust[nodeId]?.token ?? null
  }

  trustedPeers(): TrustedPeer[] {
    return Object.values(this.state.trust).map(({ token: _token, ...peer }) => peer)
  }

  saveTrust(peer: TrustedPeer, token: string): void {
    this.state.trust[peer.nodeId] = { ...peer, token }
    this.flush()
  }

  forget(nodeId: string): void {
    delete this.state.trust[nodeId]
    delete this.state.issued[nodeId]
    this.flush()
  }

  /* ── trust: tokens we issued to peers (inbound) ───────────────────── */

  issueToken(peer: { nodeId: string; name: string; platform: NodePlatform }): string {
    const token = randomBytes(32).toString('hex')
    this.state.issued[peer.nodeId] = {
      token,
      name: peer.name,
      platform: peer.platform,
      at: Date.now()
    }
    this.flush()
    return token
  }

  /** Resolves an inbound bearer token to the peer it was issued to. */
  peerForToken(token: string): { nodeId: string; name: string; platform: NodePlatform } | null {
    for (const [nodeId, record] of Object.entries(this.state.issued)) {
      if (timingSafeEqualHex(record.token, token)) {
        return { nodeId, name: record.name, platform: record.platform }
      }
    }
    return null
  }
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

let instance: Store | null = null

export function store(): Store {
  if (instance === null) instance = new Store()
  return instance
}

export type { Store }
