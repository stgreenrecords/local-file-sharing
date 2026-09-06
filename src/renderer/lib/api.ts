import type { AppError, Result } from '@shared/types'

/** Every IPC call returns a Result; this is where a failure becomes a toast. */
export type ErrorSink = (error: AppError) => void

let sink: ErrorSink = (error) => console.error('[omni]', error.code, error.message)

export function setErrorSink(next: ErrorSink): void {
  sink = next
}

/** Runs a call, reporting failures to the sink and returning null. */
export async function run<T>(call: Promise<Result<T>>): Promise<T | null> {
  const result = await call
  if (result.ok) return result.data
  sink(result.error)
  return null
}

/** Runs a call and hands back the raw Result, for callers that render the error. */
export async function tryRun<T>(call: Promise<Result<T>>): Promise<Result<T>> {
  return call
}

export const api = (): typeof window.omni => window.omni
