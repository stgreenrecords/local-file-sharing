/**
 * The outbound half of the peer protocol: an `FsProvider` that speaks HTTP to a
 * paired peer. Identical surface to `LocalProvider`, so the transfer engine and
 * the IPC layer never branch on local vs remote.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import type { DirEntry, NodePlatform, Volume } from '@shared/types'
import { PROTOCOL_VERSION } from '@shared/types'
import { ErrorCode, OmniError, fromErrno, type ErrorCodeValue } from '@shared/errors'
import type { ByteRange, FsProvider, WriteOptions, WriteResult } from '../fs/provider'
import { store } from '../store'
import * as registry from './registry'

const CONTROL_TIMEOUT_MS = 10_000

export interface HelloResponse {
  id: string
  name: string
  platform: NodePlatform
  ver: number
  fp: string
  paired: boolean
}

interface RequestSpec {
  host: string
  port: number
  method: string
  path: string
  token?: string
  headers?: Record<string, string>
  body?: Buffer | Readable
  /** Streaming responses must not be subject to the control-plane timeout. */
  timeoutMs?: number
}

function send(spec: RequestSpec): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...spec.headers }
    if (spec.token !== undefined) headers['Authorization'] = `Bearer ${spec.token}`
    if (Buffer.isBuffer(spec.body)) headers['Content-Length'] = String(spec.body.length)

    const req = httpRequest(
      { host: spec.host, port: spec.port, method: spec.method, path: spec.path, headers },
      (res) => resolve(res)
    )
    const timeout = spec.timeoutMs ?? CONTROL_TIMEOUT_MS
    if (timeout > 0) {
      req.setTimeout(timeout, () => {
        req.destroy(new OmniError(ErrorCode.UNREACHABLE, 'Peer did not respond in time'))
      })
    }
    req.on('error', (err) => reject(fromErrno(err, 'Peer request failed')))

    if (spec.body === undefined) {
      req.end()
    } else if (Buffer.isBuffer(spec.body)) {
      req.end(spec.body)
    } else {
      spec.body.on('error', (err) => req.destroy(err))
      spec.body.pipe(req)
    }
  })
}

async function drain(res: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of res) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Throws an `OmniError` carrying the peer's own error code when status >= 400. */
async function ensureOk(res: IncomingMessage): Promise<void> {
  const status = res.statusCode ?? 0
  if (status < 400) return
  const raw = await drain(res)
  let code: ErrorCodeValue = ErrorCode.PROTOCOL
  let message = `Peer returned HTTP ${status}`
  let detail: string | undefined
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as {
      error?: { code?: string; message?: string; detail?: string }
    }
    if (parsed.error?.code) code = parsed.error.code as ErrorCodeValue
    if (parsed.error?.message) message = parsed.error.message
    detail = parsed.error?.detail
  } catch {
    /* Non-JSON error body; keep the generic message. */
  }
  throw new OmniError(code, message, detail)
}

async function json<T>(res: IncomingMessage): Promise<T> {
  await ensureOk(res)
  const raw = await drain(res)
  try {
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    throw new OmniError(ErrorCode.PROTOCOL, 'Peer sent a malformed JSON response')
  }
}

/* ── unauthenticated calls ───────────────────────────────────────────── */

/** Probes a peer and measures round-trip time. */
export async function hello(
  host: string,
  port: number,
  token?: string
): Promise<{ hello: HelloResponse; rttMs: number }> {
  const started = process.hrtime.bigint()
  const res = await send({
    host,
    port,
    method: 'GET',
    path: '/api/hello',
    ...(token === undefined ? {} : { token }),
    timeoutMs: 3000
  })
  const body = await json<HelloResponse>(res)
  const rttMs = Number(process.hrtime.bigint() - started) / 1e6
  return { hello: body, rttMs }
}

/**
 * Exchanges a PIN for a token and records the trust. Also asks the peer to pair
 * back so both directions work from one user action.
 */
export async function pairWithPeer(
  host: string,
  port: number,
  pin: string,
  options: { reciprocate?: { pin: string; port: number } } = {}
): Promise<{ id: string; name: string; platform: NodePlatform; fingerprint: string }> {
  const identity = store().identity()
  const res = await send({
    host,
    port,
    method: 'POST',
    path: '/api/pair',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(
      JSON.stringify({
        id: identity.nodeId,
        name: identity.displayName,
        platform: identity.platform,
        pin: pin.replace(/\D/g, '')
      })
    )
  })
  const body = await json<{
    token: string
    id: string
    name: string
    platform: NodePlatform
    fp?: string
  }>(res)

  store().saveTrust(
    {
      nodeId: body.id,
      name: body.name,
      platform: body.platform,
      fingerprint: body.fp ?? '',
      pairedAt: Date.now()
    },
    body.token
  )

  if (options.reciprocate !== undefined) {
    // Best effort: a peer that refuses to pair back still lets us browse it.
    await send({
      host,
      port,
      method: 'POST',
      path: '/api/pair/reciprocate',
      token: body.token,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ pin: options.reciprocate.pin, port: options.reciprocate.port }))
    })
      .then((r) => ensureOk(r))
      .catch(() => undefined)
  }

  return {
    id: body.id,
    name: body.name,
    platform: body.platform,
    fingerprint: body.fp ?? ''
  }
}

export function assertCompatible(peer: HelloResponse): void {
  if (peer.ver !== PROTOCOL_VERSION) {
    throw new OmniError(
      ErrorCode.PROTOCOL,
      `${peer.name} runs protocol v${peer.ver}; this build speaks v${PROTOCOL_VERSION}`
    )
  }
}

/* ── the provider ────────────────────────────────────────────────────── */

export class PeerProvider implements FsProvider {
  constructor(
    readonly nodeId: string,
    readonly platform: NodePlatform
  ) {}

  private endpoint(): { host: string; port: number; token: string } {
    return registry.endpointFor(this.nodeId)
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    const { host, port, token } = this.endpoint()
    const res = await send({
      host,
      port,
      method,
      path,
      token,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(body))
          }),
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    })
    return json<T>(res)
  }

  volumes(): Promise<Volume[]> {
    return this.call<Volume[]>('GET', '/api/volumes')
  }

  list(path: string): Promise<DirEntry[]> {
    return this.call<DirEntry[]>('GET', `/api/list?path=${encodeURIComponent(path)}`, undefined, 30_000)
  }

  stat(path: string): Promise<DirEntry> {
    return this.call<DirEntry>('GET', `/api/stat?path=${encodeURIComponent(path)}`)
  }

  async home(): Promise<string> {
    const body = await this.call<{ path: string }>('GET', '/api/home')
    return body.path
  }

  async mkdir(path: string): Promise<void> {
    await this.call('POST', '/api/mkdir', { path })
  }

  async remove(paths: string[]): Promise<void> {
    await this.call('POST', '/api/delete', { paths, recursive: true }, 120_000)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.call('POST', '/api/rename', { from, to })
  }

  async read(path: string, range?: ByteRange): Promise<Readable> {
    const { host, port, token } = this.endpoint()
    const headers: Record<string, string> = {}
    if (range !== undefined) {
      headers['Range'] = `bytes=${range.start}-${range.end === undefined ? '' : range.end}`
    }
    const res = await send({
      host,
      port,
      method: 'GET',
      path: `/api/file?path=${encodeURIComponent(path)}`,
      token,
      headers,
      timeoutMs: 0
    })
    await ensureOk(res)
    return res
  }

  async write(path: string, body: Readable, options: WriteOptions): Promise<WriteResult> {
    const { host, port, token } = this.endpoint()
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(options.size)
    }
    if (options.mtimeMs !== undefined) headers['X-Omni-Mtime'] = String(Math.round(options.mtimeMs))
    if (options.sha256 !== undefined) headers['X-Omni-Sha256'] = options.sha256

    const res = await send({
      host,
      port,
      method: 'PUT',
      path: `/api/file?path=${encodeURIComponent(path)}`,
      token,
      headers,
      body,
      timeoutMs: 0
    })
    return json<WriteResult>(res)
  }
}
