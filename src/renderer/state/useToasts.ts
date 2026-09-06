import { create } from 'zustand'
import type { AppError } from '@shared/types'
import { setErrorSink } from '../lib/api'

export interface Toast {
  id: number
  tone: 'error' | 'warning' | 'info' | 'success'
  title: string
  detail?: string
}

interface ToastState {
  toasts: Toast[]
  push(toast: Omit<Toast, 'id'>): void
  dismiss(id: number): void
}

let nextId = 1

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId
    nextId += 1
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }))
    // Errors stay until dismissed; anything else self-clears.
    if (toast.tone !== 'error') {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
    }
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

/** Routes every failed IPC Result into the toast rail. */
setErrorSink((error: AppError) => {
  useToasts.getState().push({
    tone: 'error',
    title: error.message,
    ...(error.detail === undefined ? {} : { detail: error.detail })
  })
})
