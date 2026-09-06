import type { AppError, Result } from './types'

export const ErrorCode = {
  BAD_PATH: 'bad_path',
  NOT_FOUND: 'not_found',
  DENIED: 'denied',
  EXISTS: 'exists',
  IS_DIR: 'is_dir',
  NOT_DIR: 'not_dir',
  NO_SPACE: 'no_space',
  REFUSE_ROOT: 'refuse_root',
  NAME_COLLISION: 'name_collision',
  HASH_MISMATCH: 'hash_mismatch',
  TRUNCATED: 'truncated',
  UNKNOWN_NODE: 'unknown_node',
  NOT_PAIRED: 'not_paired',
  BAD_PIN: 'bad_pin',
  PAIR_LOCKED: 'pair_locked',
  UNREACHABLE: 'unreachable',
  PROTOCOL: 'protocol',
  CANCELLED: 'cancelled',
  INTERNAL: 'internal'
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export class OmniError extends Error {
  readonly code: ErrorCodeValue
  readonly detail?: string
  readonly httpStatus: number

  constructor(code: ErrorCodeValue, message: string, detail?: string) {
    super(message)
    this.name = 'OmniError'
    this.code = code
    this.detail = detail
    this.httpStatus = HTTP_STATUS[code] ?? 500
  }
}

const HTTP_STATUS: Partial<Record<ErrorCodeValue, number>> = {
  [ErrorCode.BAD_PATH]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.DENIED]: 403,
  [ErrorCode.EXISTS]: 409,
  [ErrorCode.IS_DIR]: 400,
  [ErrorCode.NOT_DIR]: 400,
  [ErrorCode.NO_SPACE]: 507,
  [ErrorCode.REFUSE_ROOT]: 400,
  [ErrorCode.NAME_COLLISION]: 409,
  [ErrorCode.HASH_MISMATCH]: 422,
  [ErrorCode.TRUNCATED]: 400,
  [ErrorCode.NOT_PAIRED]: 401,
  [ErrorCode.BAD_PIN]: 401,
  [ErrorCode.PAIR_LOCKED]: 429,
  [ErrorCode.PROTOCOL]: 502,
  [ErrorCode.UNREACHABLE]: 503
}

/** Maps a Node `errno` to a stable app code so the UI never sees raw errnos. */
export function fromErrno(err: unknown, fallbackMessage: string): OmniError {
  const e = err as { code?: string; message?: string } | undefined
  switch (e?.code) {
    case 'ENOENT':
      return new OmniError(ErrorCode.NOT_FOUND, 'Path does not exist', e.message)
    case 'EACCES':
    case 'EPERM':
      return new OmniError(ErrorCode.DENIED, 'Permission denied', e.message)
    case 'EEXIST':
      return new OmniError(ErrorCode.EXISTS, 'Already exists', e.message)
    case 'EISDIR':
      return new OmniError(ErrorCode.IS_DIR, 'Path is a directory', e.message)
    case 'ENOTDIR':
      return new OmniError(ErrorCode.NOT_DIR, 'Path is not a directory', e.message)
    case 'ENOSPC':
      return new OmniError(ErrorCode.NO_SPACE, 'No space left on target volume', e.message)
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ETIMEDOUT':
    case 'ENETUNREACH':
      return new OmniError(ErrorCode.UNREACHABLE, 'Peer is not reachable', e.message)
    default:
      if (err instanceof OmniError) return err
      return new OmniError(ErrorCode.INTERNAL, fallbackMessage, e?.message)
  }
}

export function toAppError(err: unknown, fallbackMessage = 'Operation failed'): AppError {
  const o = err instanceof OmniError ? err : fromErrno(err, fallbackMessage)
  return o.detail === undefined
    ? { code: o.code, message: o.message }
    : { code: o.code, message: o.message, detail: o.detail }
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const fail = (err: unknown, fallbackMessage?: string): Result<never> => ({
  ok: false,
  error: toAppError(err, fallbackMessage)
})

/** Wraps a handler so it always resolves to a Result instead of rejecting. */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (err) {
    return fail(err)
  }
}
