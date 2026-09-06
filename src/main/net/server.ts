/**
 * The inbound half of the peer protocol: an HTTP server exposing this machine's
 * filesystem to paired peers. See docs/PROTOCOL.md for the endpoint contracts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { PROTOCOL_VERSION, type NodePlatform } from '@shared/types'
import { ErrorCode, OmniError, toAppError } from '@shared/errors'
import { local } from '../fs/local'
import { store } from '../store'
import { peerFromHeader, requirePeer, verifyPinAndIssueToken } from './auth'
import { pairWithPeer } from './client'

const MAX_JSON_BYTES = 64 * 1024

export interface ServerHandle {
  port: number
  close(): Promise<void>
}

let handle: ServerHandle | null = null

export async function startServer(preferredPort: number): Promise<ServerHandle> {
  if (handle !== null) return handle
  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => sendError(res, err))
  })
  server.on('clientError', (_err, socket) => socket.destroy())
  // Long transfers must not be killed by an idle-header timeout.
  server.requestTimeout = 0
  server.headersTimeout = 60_000

  const port = await listen(server, preferredPort)
  handle = {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          handle = null
          resolve()
        })
      })
  }
  return handle
}

/** Binds `preferredPort`, walking upward on collision so two dev instances coexist. */
function listen(server: Server, preferredPort: number): Promise<number> {
  const MAX_TRIES = 20
  return new Promise((resolve, reject) => {
    let candidate = preferredPort
    let tries = 0
    const attempt = (): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries < MAX_TRIES) {
          tries += 1
          candidate += 1
          attempt()
          return
        }
        reject(err)
      })
      server.listen(candidate, () => {
        const address = server.address()
        resolve(typeof address === 'object' && address !== null ? address.port : candidate)
      })
    }
    attempt()
  })
}

/* ── routing ─────────────────────────────────────────────────────────── */

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (path === '/api/hello' && method === 'GET') return hello(req, res)
  if (path === '/api/pair' && method === 'POST') return pair(req, res)

  // Everything below requires a bearer token.
  const peer = requirePeer(req.headers.authorization)

  switch (`${method} ${path}`) {
    case 'GET /api/volumes':
      return sendJson(res, 200, await local.volumes())
    case 'GET /api/list':
      return sendJson(res, 200, await local.list(requiredParam(url, 'path')))
    case 'GET /api/stat':
      return sendJson(res, 200, await local.stat(requiredParam(url, 'path')))
    case 'GET /api/home':
      return sendJson(res, 200, { path: await local.home() })
    case 'GET /api/file':
      return download(req, res, requiredParam(url, 'path'))
    case 'PUT /api/file':
      return upload(req, res, requiredParam(url, 'path'))
    case 'POST /api/mkdir': {
      const body = await readJson<{ path?: string }>(req)
      await local.mkdir(requireString(body.path, 'path'))
      return sendJson(res, 200, { ok: true })
    }
    case 'POST /api/delete': {
      const body = await readJson<{ paths?: string[] }>(req)
      if (!Array.isArray(body.paths) || body.paths.length === 0) {
        throw new OmniError(ErrorCode.BAD_PATH, 'paths must be a non-empty array')
      }
      await local.remove(body.paths)
      return sendJson(res, 200, { ok: true })
    }
    case 'POST /api/rename': {
      const body = await readJson<{ from?: string; to?: string }>(req)
      await local.rename(requireString(body.from, 'from'), requireString(body.to, 'to'))
      return sendJson(res, 200, { ok: true })
    }
    case 'POST /api/pair/reciprocate': {
      // The peer is telling us the PIN it is displaying so we can pair back.
      const body = await readJson<{ pin?: string; host?: string; port?: number }>(req)
      const pin = requireString(body.pin, 'pin')
      const host = body.host ?? req.socket.remoteAddress ?? ''
      const port = body.port ?? 0
      if (!host || !port) throw new OmniError(ErrorCode.PROTOCOL, 'host and port are required')
      await pairWithPeer(normaliseHost(host), port, pin)
      return sendJson(res, 200, { ok: true })
    }
    default:
      throw new OmniError(ErrorCode.PROTOCOL, `No route for ${method} ${path}`, peer.nodeId)
  }
}

async function hello(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const identity = store().identity()
  sendJson(res, 200, {
    id: identity.nodeId,
    name: identity.displayName,
    platform: identity.platform,
    ver: PROTOCOL_VERSION,
    fp: identity.fingerprint,
    paired: peerFromHeader(req.headers.authorization) !== null
  })
}

async function pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson<{
    id?: string
    name?: string
    platform?: NodePlatform
    pin?: string
  }>(req)
  const token = verifyPinAndIssueToken({
    nodeId: requireString(body.id, 'id'),
    name: requireString(body.name, 'name'),
    platform: (body.platform ?? 'linux') as NodePlatform,
    pin: requireString(body.pin, 'pin')
  })
  const identity = store().identity()
  sendJson(res, 200, {
    token,
    id: identity.nodeId,
    name: identity.displayName,
    platform: identity.platform,
    fp: identity.fingerprint
  })
}

async function download(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const entry = await local.stat(path)
  if (entry.isDir) throw new OmniError(ErrorCode.IS_DIR, 'Cannot download a directory', path)

  const range = parseRange(req.headers.range, entry.size)
  const stream = await local.read(path, range ?? undefined)

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('X-Omni-Mtime', String(Math.round(entry.mtimeMs)))
  if (range === null) {
    res.setHeader('Content-Length', String(entry.size))
    res.writeHead(200)
  } else {
    const end = range.end ?? entry.size - 1
    res.setHeader('Content-Length', String(end - range.start + 1))
    res.setHeader('Content-Range', `bytes ${range.start}-${end}/${entry.size}`)
    res.writeHead(206)
  }

  try {
    await pipeline(stream, res)
  } catch {
    // The peer hung up or cancelled; nothing to report back over a dead socket.
    stream.destroy()
  }
}

async function upload(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const size = Number(req.headers['content-length'])
  if (!Number.isFinite(size) || size < 0) {
    throw new OmniError(ErrorCode.PROTOCOL, 'Content-Length is required for uploads')
  }
  const mtimeHeader = Number(req.headers['x-omni-mtime'])
  const sha = req.headers['x-omni-sha256']

  const result = await local.write(path, req, {
    size,
    ...(Number.isFinite(mtimeHeader) && mtimeHeader > 0 ? { mtimeMs: mtimeHeader } : {}),
    ...(typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha) ? { sha256: sha.toLowerCase() } : {})
  })
  sendJson(res, 200, result)
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function parseRange(header: string | undefined, size: number): { start: number; end?: number } | null {
  if (header === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd)
    return { start: Math.max(0, size - suffix) }
  }
  const start = Number(rawStart)
  if (start >= size) throw new OmniError(ErrorCode.PROTOCOL, 'Range start beyond end of file')
  return rawEnd === '' ? { start } : { start, end: Math.min(Number(rawEnd), size - 1) }
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (value === null || value === '') {
    throw new OmniError(ErrorCode.BAD_PATH, `Missing query parameter: ${name}`)
  }
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new OmniError(ErrorCode.PROTOCOL, `Missing or invalid field: ${name}`)
  }
  return value
}

/** IPv6-mapped IPv4 (`::ffff:192.168.1.5`) arrives from `remoteAddress`. */
function normaliseHost(host: string): string {
  return host.startsWith('::ffff:') ? host.slice(7) : host
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_JSON_BYTES) throw new OmniError(ErrorCode.PROTOCOL, 'Request body too large')
    chunks.push(buf)
  }
  if (total === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new OmniError(ErrorCode.PROTOCOL, 'Malformed JSON body')
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length)
  })
  res.end(body)
}

function sendError(res: ServerResponse, err: unknown): void {
  const status = err instanceof OmniError ? err.httpStatus : 500
  if (res.headersSent) {
    res.destroy()
    return
  }
  sendJson(res, status, { error: toAppError(err) })
}
