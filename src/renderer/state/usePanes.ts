/**
 * Dual-pane navigation state.
 *
 * A pane is bound to a `nodeId` + `path`; the local machine is just the node
 * whose id is `local`, so no code here branches on local vs remote.
 */
import { create } from 'zustand'
import type {
  AppError,
  DirEntry,
  PathRef,
  SortColumn,
  SortDirection,
  Volume
} from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { basenameFor, dirnameFor, isRootFor, joinFor } from '@shared/paths'
import { api, run } from '../lib/api'
import { useNodes } from './useNodes'

export type PaneId = 'left' | 'right'

export interface PaneTab {
  id: string
  nodeId: string
  path: string
}

export interface PaneState {
  tabs: PaneTab[]
  activeTabId: string
  entries: DirEntry[]
  volumes: Volume[]
  loading: boolean
  error: AppError | null
  /** Index into the *visible* rows, including the `..` row at index 0. */
  cursor: number
  /** Selected entry paths. The cursor row is not implicitly selected. */
  selected: Set<string>
  sort: { column: SortColumn; direction: SortDirection }
}

interface PanesState {
  left: PaneState
  right: PaneState
  focus: PaneId
  showHidden: boolean

  setFocus(pane: PaneId): void
  toggleFocus(): void
  init(): Promise<void>
  navigate(pane: PaneId, ref: PathRef, options?: { keepTab?: boolean }): Promise<void>
  refresh(pane: PaneId): Promise<void>
  up(pane: PaneId): Promise<void>
  enter(pane: PaneId): Promise<void>
  setSort(pane: PaneId, column: SortColumn): void
  setShowHidden(value: boolean): void

  moveCursor(pane: PaneId, delta: number, extendSelection: boolean): void
  setCursor(pane: PaneId, index: number): void
  toggleSelectAt(pane: PaneId, index: number): void
  selectTo(pane: PaneId, index: number): void
  selectAll(pane: PaneId): void
  clearSelection(pane: PaneId): void
  invertSelection(pane: PaneId): void

  addTab(pane: PaneId): void
  closeTab(pane: PaneId, tabId: string): void
  activateTab(pane: PaneId, tabId: string): Promise<void>
}

let tabSeq = 0
const newTabId = (): string => {
  tabSeq += 1
  return `tab-${tabSeq}`
}

const emptyPane = (nodeId: string, path: string): PaneState => ({
  tabs: [{ id: newTabId(), nodeId, path }],
  activeTabId: '',
  entries: [],
  volumes: [],
  loading: false,
  error: null,
  cursor: 0,
  selected: new Set(),
  sort: { column: 'name', direction: 'asc' }
})

function withActiveTab(pane: PaneState): PaneState {
  const first = pane.tabs[0]
  return { ...pane, activeTabId: pane.activeTabId || (first?.id ?? '') }
}

export const activeTab = (pane: PaneState): PaneTab =>
  pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? { id: '', nodeId: LOCAL_NODE_ID, path: '' }

/** The `..` row is a real row so the keyboard model has nothing special-cased. */
export const PARENT_ROW = '..'

/** Visible rows in display order: `..` (unless at a volume root), dirs, then files. */
export function visibleRows(
  pane: PaneState,
  platform: 'win32' | 'darwin' | 'linux',
  showHidden: boolean
): Array<DirEntry | typeof PARENT_ROW> {
  const tab = activeTab(pane)
  const entries = pane.entries.filter((e) => showHidden || !e.hidden)
  const { column, direction } = pane.sort
  const sign = direction === 'asc' ? 1 : -1

  const sorted = [...entries].sort((a, b) => {
    // Directories always cluster above files, whatever the sort column.
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    switch (column) {
      case 'size':
        return sign * (a.size - b.size)
      case 'mtime':
        return sign * (a.mtimeMs - b.mtimeMs)
      case 'ext':
        return sign * (a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name))
      case 'name':
      default:
        return sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
  })

  const atRoot = tab.path === '' || isRootFor(platform, tab.path)
  return atRoot ? sorted : [PARENT_ROW, ...sorted]
}

export const usePanes = create<PanesState>((set, get) => {
  const patch = (pane: PaneId, changes: Partial<PaneState>): void =>
    set((state) => ({ [pane]: { ...state[pane], ...changes } }) as Pick<PanesState, PaneId>)

  const platformOf = (nodeId: string): 'win32' | 'darwin' | 'linux' =>
    useNodes.getState().platformOf(nodeId)

  const load = async (pane: PaneId, ref: PathRef): Promise<void> => {
    patch(pane, { loading: true, error: null })
    const [entries, volumes] = await Promise.all([
      api().fs.list(ref),
      api().fs.volumes(ref.nodeId)
    ])

    if (!entries.ok) {
      patch(pane, { loading: false, error: entries.error, entries: [] })
      return
    }
    patch(pane, {
      loading: false,
      error: null,
      entries: entries.data,
      volumes: volumes.ok ? volumes.data : [],
      cursor: 0,
      selected: new Set()
    })
  }

  return {
    left: withActiveTab(emptyPane(LOCAL_NODE_ID, '')),
    right: withActiveTab(emptyPane(LOCAL_NODE_ID, '')),
    focus: 'left',
    showHidden: false,

    setFocus: (pane) => set({ focus: pane }),
    toggleFocus: () => set((state) => ({ focus: state.focus === 'left' ? 'right' : 'left' })),

    async init() {
      await useNodes.getState().refresh()
      const home = await run(api().fs.home(LOCAL_NODE_ID))
      if (home === null) return
      const platform = platformOf(LOCAL_NODE_ID)
      // Right pane opens one level up, which is the more useful default when
      // both panes start on the same machine.
      const rightStart = isRootFor(platform, home) ? home : dirnameFor(platform, home)
      await Promise.all([
        get().navigate('left', { nodeId: LOCAL_NODE_ID, path: home }),
        get().navigate('right', { nodeId: LOCAL_NODE_ID, path: rightStart })
      ])
    },

    async navigate(pane, ref, options) {
      const state = get()[pane]
      const tab = activeTab(state)
      const tabs =
        options?.keepTab === false
          ? state.tabs
          : state.tabs.map((t) => (t.id === tab.id ? { ...t, ...ref } : t))
      patch(pane, { tabs })
      await load(pane, ref)
    },

    async refresh(pane) {
      const tab = activeTab(get()[pane])
      if (tab.path === '') return
      await load(pane, { nodeId: tab.nodeId, path: tab.path })
    },

    async up(pane) {
      const tab = activeTab(get()[pane])
      const platform = platformOf(tab.nodeId)
      if (tab.path === '' || isRootFor(platform, tab.path)) return
      const parent = dirnameFor(platform, tab.path)
      const leaving = basenameFor(platform, tab.path)
      await get().navigate(pane, { nodeId: tab.nodeId, path: parent })
      // Land the cursor on the folder we just came out of.
      const rows = visibleRows(get()[pane], platform, get().showHidden)
      const index = rows.findIndex((row) => row !== PARENT_ROW && row.name === leaving)
      if (index >= 0) patch(pane, { cursor: index })
    },

    async enter(pane) {
      const state = get()[pane]
      const tab = activeTab(state)
      const platform = platformOf(tab.nodeId)
      const rows = visibleRows(state, platform, get().showHidden)
      const row = rows[state.cursor]
      if (row === undefined) return
      if (row === PARENT_ROW) return get().up(pane)
      if (row.isDir) {
        return get().navigate(pane, { nodeId: tab.nodeId, path: row.path })
      }
      // Files open with the OS handler, which only works for local paths.
      if (tab.nodeId === LOCAL_NODE_ID) {
        await run(api().fs.open({ nodeId: tab.nodeId, path: row.path }))
      }
    },

    setSort(pane, column) {
      const state = get()[pane]
      const direction: SortDirection =
        state.sort.column === column && state.sort.direction === 'asc' ? 'desc' : 'asc'
      patch(pane, { sort: { column, direction } })
    },

    setShowHidden(value) {
      set({ showHidden: value })
    },

    moveCursor(pane, delta, extendSelection) {
      const state = get()[pane]
      const tab = activeTab(state)
      const rows = visibleRows(state, platformOf(tab.nodeId), get().showHidden)
      if (rows.length === 0) return
      const next = Math.min(Math.max(state.cursor + delta, 0), rows.length - 1)

      if (!extendSelection) {
        patch(pane, { cursor: next })
        return
      }
      // Shift+arrows in a commander toggle the row you leave, matching how
      // Total Commander grows a selection.
      const row = rows[state.cursor]
      const selected = new Set(state.selected)
      if (row !== undefined && row !== PARENT_ROW) {
        if (selected.has(row.path)) selected.delete(row.path)
        else selected.add(row.path)
      }
      patch(pane, { cursor: next, selected })
    },

    setCursor(pane, index) {
      patch(pane, { cursor: Math.max(0, index) })
    },

    toggleSelectAt(pane, index) {
      const state = get()[pane]
      const tab = activeTab(state)
      const rows = visibleRows(state, platformOf(tab.nodeId), get().showHidden)
      const row = rows[index]
      if (row === undefined || row === PARENT_ROW) return
      const selected = new Set(state.selected)
      if (selected.has(row.path)) selected.delete(row.path)
      else selected.add(row.path)
      patch(pane, { selected, cursor: index })
    },

    selectTo(pane, index) {
      const state = get()[pane]
      const tab = activeTab(state)
      const rows = visibleRows(state, platformOf(tab.nodeId), get().showHidden)
      const from = Math.min(state.cursor, index)
      const to = Math.max(state.cursor, index)
      const selected = new Set(state.selected)
      for (let i = from; i <= to; i += 1) {
        const row = rows[i]
        if (row !== undefined && row !== PARENT_ROW) selected.add(row.path)
      }
      patch(pane, { selected, cursor: index })
    },

    selectAll(pane) {
      const state = get()[pane]
      const selected = new Set(
        state.entries.filter((e) => get().showHidden || !e.hidden).map((e) => e.path)
      )
      patch(pane, { selected })
    },

    clearSelection(pane) {
      patch(pane, { selected: new Set() })
    },

    invertSelection(pane) {
      const state = get()[pane]
      const selected = new Set<string>()
      for (const entry of state.entries) {
        if (!get().showHidden && entry.hidden) continue
        if (!state.selected.has(entry.path)) selected.add(entry.path)
      }
      patch(pane, { selected })
    },

    addTab(pane) {
      const state = get()[pane]
      const current = activeTab(state)
      const tab: PaneTab = { id: newTabId(), nodeId: current.nodeId, path: current.path }
      patch(pane, { tabs: [...state.tabs, tab], activeTabId: tab.id })
    },

    closeTab(pane, tabId) {
      const state = get()[pane]
      if (state.tabs.length <= 1) return
      const index = state.tabs.findIndex((t) => t.id === tabId)
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      const nextActive =
        state.activeTabId === tabId
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? '')
          : state.activeTabId
      patch(pane, { tabs, activeTabId: nextActive })
      if (state.activeTabId === tabId) void get().refresh(pane)
    },

    async activateTab(pane, tabId) {
      const state = get()[pane]
      const tab = state.tabs.find((t) => t.id === tabId)
      if (tab === undefined) return
      patch(pane, { activeTabId: tabId })
      await load(pane, { nodeId: tab.nodeId, path: tab.path })
    }
  }
})

/** Paths the user has acted on: the explicit selection, else the cursor row. */
export function effectiveSelection(pane: PaneState, showHidden: boolean, platform: 'win32' | 'darwin' | 'linux'): PathRef[] {
  const tab = activeTab(pane)
  if (pane.selected.size > 0) {
    return [...pane.selected].map((path) => ({ nodeId: tab.nodeId, path }))
  }
  const rows = visibleRows(pane, platform, showHidden)
  const row = rows[pane.cursor]
  if (row === undefined || row === PARENT_ROW) return []
  return [{ nodeId: tab.nodeId, path: row.path }]
}

/** Total size of the current selection, for the pane footer. */
export function selectionBytes(pane: PaneState): number {
  if (pane.selected.size === 0) return 0
  return pane.entries
    .filter((e) => pane.selected.has(e.path))
    .reduce((sum, e) => sum + e.size, 0)
}

export { joinFor }
