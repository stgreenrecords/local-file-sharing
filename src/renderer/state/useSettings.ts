import { create } from 'zustand'
import type { Settings } from '@shared/types'
import { api, run } from '../lib/api'
import { usePanes } from './usePanes'
import { useToasts } from './useToasts'

interface SettingsState {
  settings: Settings | null
  /** Unsaved edits, so the Save button can be meaningful. */
  draft: Partial<Settings>
  saving: boolean
  load(): Promise<void>
  edit(patch: Partial<Settings>): void
  save(): Promise<void>
  discard(): void
  reset(): Promise<void>
  exportConfig(): Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  draft: {},
  saving: false,

  async load() {
    const settings = await run(api().settings.get())
    if (settings === null) return
    set({ settings, draft: {} })
    usePanes.getState().setShowHidden(settings.showHidden)
  },

  edit(patch) {
    set((state) => ({ draft: { ...state.draft, ...patch } }))
  },

  async save() {
    const { draft } = get()
    if (Object.keys(draft).length === 0) return
    set({ saving: true })
    const settings = await run(api().settings.set(draft))
    set({ saving: false })
    if (settings === null) return
    set({ settings, draft: {} })
    usePanes.getState().setShowHidden(settings.showHidden)
    useToasts.getState().push({ tone: 'success', title: 'Configuration applied' })
  },

  discard() {
    set({ draft: {} })
  },

  async reset() {
    const settings = await run(api().settings.reset())
    if (settings === null) return
    set({ settings, draft: {} })
    usePanes.getState().setShowHidden(settings.showHidden)
    useToasts.getState().push({ tone: 'info', title: 'Defaults restored' })
  },

  async exportConfig() {
    const path = await run(api().settings.exportConfig())
    if (path === null) return
    useToasts.getState().push({ tone: 'success', title: 'Configuration exported', detail: path })
  }
}))

/** The effective value of a setting: the draft edit if present, else saved. */
export function effective<K extends keyof Settings>(
  state: Pick<SettingsState, 'settings' | 'draft'>,
  key: K,
  fallback: Settings[K]
): Settings[K] {
  const draft = state.draft[key]
  if (draft !== undefined) return draft as Settings[K]
  return state.settings?.[key] ?? fallback
}

export function hasChanges(state: Pick<SettingsState, 'draft'>): boolean {
  return Object.keys(state.draft).length > 0
}
