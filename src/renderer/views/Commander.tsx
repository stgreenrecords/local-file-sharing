/**
 * The dual-pane commander. Owns the keyboard model, the function-key actions and
 * the transfer rail between the panes.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PathRef, RowDensity } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { formatBytes } from '@shared/format'
import { basenameFor, dirnameFor, joinFor } from '@shared/paths'
import {
  activeTab,
  effectiveSelection,
  usePanes,
  visibleRows,
  type PaneId
} from '../state/usePanes'
import { useNodes } from '../state/useNodes'
import { useSettings, effective } from '../state/useSettings'
import { useToasts } from '../state/useToasts'
import { api, run } from '../lib/api'
import { Pane } from '../components/Pane'
import { FunctionBar, type FunctionKey } from '../components/chrome'
import { ConfirmDialog, PromptDialog } from '../components/dialogs'
import { Icon, KeyBadge } from '../components/primitives'
import { IconButton } from '../components/controls'

type PendingDialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; from: string; current: string }
  | { kind: 'delete'; paths: PathRef[] }
  | { kind: 'transfer'; operation: 'copy' | 'move'; sources: PathRef[]; targetDir: PathRef }
  | null

export function Commander({ onOpenQueue }: { onOpenQueue: () => void }): ReactNode {
  const panes = usePanes()
  const { focus, showHidden } = panes
  const platformOf = useNodes((s) => s.platformOf)
  const settingsState = useSettings()
  const pushToast = useToasts((s) => s.push)
  const [dialog, setDialog] = useState<PendingDialog>(null)

  const density: RowDensity = effective(settingsState, 'rowDensity', 'standard')
  const confirmDelete = effective(settingsState, 'confirmDelete', true)

  const focusPane = focus === 'left' ? panes.left : panes.right
  const otherId: PaneId = focus === 'left' ? 'right' : 'left'
  const otherPane = focus === 'left' ? panes.right : panes.left
  const sourceTab = activeTab(focusPane)
  const targetTab = activeTab(otherPane)

  const selection = useMemo(
    () => effectiveSelection(focusPane, showHidden, platformOf(sourceTab.nodeId)),
    [focusPane, showHidden, platformOf, sourceTab.nodeId]
  )

  const cursorEntry = useMemo(() => {
    const rows = visibleRows(focusPane, platformOf(sourceTab.nodeId), showHidden)
    const row = rows[focusPane.cursor]
    return row === undefined || row === '..' ? null : row
  }, [focusPane, platformOf, sourceTab.nodeId, showHidden])

  /* ── actions ──────────────────────────────────────────────────────── */

  const startTransfer = useCallback(
    (operation: 'copy' | 'move') => {
      if (selection.length === 0) {
        pushToast({ tone: 'warning', title: 'Nothing selected' })
        return
      }
      if (targetTab.path === '') {
        pushToast({ tone: 'warning', title: 'The target pane has no folder open' })
        return
      }
      if (operation === 'move' && sourceTab.nodeId !== targetTab.nodeId) {
        pushToast({
          tone: 'warning',
          title: 'Moving between machines is not supported yet',
          detail: 'Copy the files, then delete the originals.'
        })
        return
      }
      setDialog({
        kind: 'transfer',
        operation,
        sources: selection,
        targetDir: { nodeId: targetTab.nodeId, path: targetTab.path }
      })
    },
    [selection, sourceTab.nodeId, targetTab.nodeId, targetTab.path, pushToast]
  )

  const openWithOs = useCallback(
    (label: string) => {
      if (cursorEntry === null) return
      if (sourceTab.nodeId !== LOCAL_NODE_ID) {
        pushToast({
          tone: 'warning',
          title: `${label} only works on this machine`,
          detail: 'Copy the file across first, or browse it from the machine that holds it.'
        })
        return
      }
      void run(api().fs.open({ nodeId: sourceTab.nodeId, path: cursorEntry.path }))
    },
    [cursorEntry, sourceTab.nodeId, pushToast]
  )

  const requestDelete = useCallback(() => {
    if (selection.length === 0) {
      pushToast({ tone: 'warning', title: 'Nothing selected' })
      return
    }
    if (!confirmDelete) {
      void performDelete(selection, focus)
      return
    }
    setDialog({ kind: 'delete', paths: selection })
  }, [selection, confirmDelete, focus, pushToast])

  const performDelete = useCallback(
    async (paths: PathRef[], paneId: PaneId) => {
      const nodeId = paths[0]?.nodeId ?? LOCAL_NODE_ID
      const done = await run(api().fs.remove(nodeId, paths.map((p) => p.path)))
      if (done !== null) {
        pushToast({
          tone: 'success',
          title: `Deleted ${paths.length} ${paths.length === 1 ? 'item' : 'items'}`
        })
      }
      await panes.refresh(paneId)
      // The other pane may be showing the same folder.
      if (activeTab(paneId === 'left' ? panes.right : panes.left).nodeId === nodeId) {
        await panes.refresh(paneId === 'left' ? 'right' : 'left')
      }
    },
    [panes, pushToast]
  )

  const openMenu = useCallback(() => {
    setMenuOpen((open) => !open)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)

  /* ── keyboard model ───────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Never steal keys from a text field or an open dialog.
      const target = event.target as HTMLElement | null
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (dialog !== null) return

      const mod = event.ctrlKey || event.metaKey
      const pane = usePanes.getState().focus

      switch (event.key) {
        case 'Tab':
          event.preventDefault()
          usePanes.getState().toggleFocus()
          return
        case 'ArrowUp':
          event.preventDefault()
          panes.moveCursor(pane, -1, event.shiftKey)
          return
        case 'ArrowDown':
          event.preventDefault()
          panes.moveCursor(pane, 1, event.shiftKey)
          return
        case 'PageUp':
          event.preventDefault()
          panes.moveCursor(pane, -20, event.shiftKey)
          return
        case 'PageDown':
          event.preventDefault()
          panes.moveCursor(pane, 20, event.shiftKey)
          return
        case 'Home':
          event.preventDefault()
          panes.setCursor(pane, 0)
          return
        case 'End':
          event.preventDefault()
          panes.moveCursor(pane, Number.MAX_SAFE_INTEGER, false)
          return
        case 'Enter':
          event.preventDefault()
          void panes.enter(pane)
          return
        case 'Backspace':
          event.preventDefault()
          void panes.up(pane)
          return
        case ' ':
        case 'Insert':
          event.preventDefault()
          panes.toggleSelectAt(pane, usePanes.getState()[pane].cursor)
          panes.moveCursor(pane, 1, false)
          return
        case 'Escape':
          panes.clearSelection(pane)
          setMenuOpen(false)
          return
        case 'F3':
          event.preventDefault()
          openWithOs('Quick look')
          return
        case 'F4':
          event.preventDefault()
          openWithOs('Edit')
          return
        case 'F5':
          event.preventDefault()
          startTransfer('copy')
          return
        case 'F6':
          event.preventDefault()
          if (event.shiftKey) {
            if (cursorEntry !== null) {
              setDialog({ kind: 'rename', from: cursorEntry.path, current: cursorEntry.name })
            }
          } else startTransfer('move')
          return
        case 'F7':
          event.preventDefault()
          setDialog({ kind: 'mkdir' })
          return
        case 'F8':
        case 'Delete':
          event.preventDefault()
          requestDelete()
          return
        case 'F9':
          event.preventDefault()
          openMenu()
          return
        case 'F10':
          event.preventDefault()
          window.omni.window.close()
          return
        default:
          break
      }

      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        panes.selectAll(pane)
      } else if (mod && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void panes.refresh(pane)
      } else if (mod && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        panes.setShowHidden(!usePanes.getState().showHidden)
      } else if (mod && event.key.toLowerCase() === 't') {
        event.preventDefault()
        panes.addTab(pane)
      } else if (mod && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        panes.closeTab(pane, usePanes.getState()[pane].activeTabId)
      } else if (mod && event.key === '*') {
        event.preventDefault()
        panes.invertSelection(pane)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panes, dialog, cursorEntry, openWithOs, requestDelete, startTransfer, openMenu])

  /* ── function bar ─────────────────────────────────────────────────── */

  const functionKeys: FunctionKey[] = [
    { key: 'F3', label: 'View', onPress: () => openWithOs('Quick look'), disabled: cursorEntry === null },
    { key: 'F4', label: 'Edit', onPress: () => openWithOs('Edit'), disabled: cursorEntry === null },
    { key: 'F5', label: 'Copy', onPress: () => startTransfer('copy'), disabled: selection.length === 0 },
    { key: 'F6', label: 'Move', onPress: () => startTransfer('move'), disabled: selection.length === 0 },
    { key: 'F7', label: 'NewFolder', onPress: () => setDialog({ kind: 'mkdir' }) },
    { key: 'F8', label: 'Delete', onPress: requestDelete, disabled: selection.length === 0 },
    { key: 'F9', label: 'Menu', onPress: openMenu },
    { key: 'F10', label: 'Exit', onPress: () => window.omni.window.close() }
  ]

  const selectionBytesKnown = selection.length > 0
  const knownBytes = focusPane.entries
    .filter((e) => selection.some((s) => s.path === e.path))
    .reduce((sum, e) => sum + e.size, 0)
  const hasFolders = focusPane.entries.some(
    (e) => e.isDir && selection.some((s) => s.path === e.path)
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <TelemetryStrip />

      <div className="flex-1 min-h-0 flex items-stretch gap-pane-gutter bg-outline-variant/40 relative">
        <Pane id="left" density={density} />
        <TransferRail
          direction={focus === 'left' ? 'right' : 'left'}
          canTransfer={selection.length > 0 && targetTab.path !== ''}
          onCopy={() => startTransfer('copy')}
          onMove={() => startTransfer('move')}
          onSwap={() => {
            // Swap what the two panes are showing.
            const left = activeTab(panes.left)
            const right = activeTab(panes.right)
            void panes.navigate('left', { nodeId: right.nodeId, path: right.path })
            void panes.navigate('right', { nodeId: left.nodeId, path: left.path })
          }}
          onMirror={() => {
            const source = activeTab(focusPane)
            void panes.navigate(otherId, { nodeId: source.nodeId, path: source.path })
          }}
        />
        <Pane id="right" density={density} />

        {menuOpen && (
          <ContextMenu
            onClose={() => setMenuOpen(false)}
            items={[
              {
                label: 'Rename',
                hint: 'Shift+F6',
                icon: 'edit',
                disabled: cursorEntry === null,
                onPress: () => {
                  if (cursorEntry !== null) {
                    setDialog({ kind: 'rename', from: cursorEntry.path, current: cursorEntry.name })
                  }
                }
              },
              {
                label: 'Invert selection',
                hint: 'Ctrl+*',
                icon: 'flip',
                onPress: () => panes.invertSelection(focus)
              },
              {
                label: 'Select all',
                hint: 'Ctrl+A',
                icon: 'select_all',
                onPress: () => panes.selectAll(focus)
              },
              {
                label: 'Reveal in file manager',
                icon: 'open_in_new',
                disabled: cursorEntry === null || sourceTab.nodeId !== LOCAL_NODE_ID,
                onPress: () => {
                  if (cursorEntry !== null) {
                    void run(api().fs.reveal({ nodeId: sourceTab.nodeId, path: cursorEntry.path }))
                  }
                }
              },
              {
                label: 'Mirror this folder to the other pane',
                icon: 'content_copy',
                onPress: () => {
                  const source = activeTab(focusPane)
                  void panes.navigate(otherId, { nodeId: source.nodeId, path: source.path })
                }
              },
              {
                label: 'Open transfer queue',
                icon: 'sync_alt',
                onPress: onOpenQueue
              }
            ]}
          />
        )}
      </div>

      <FunctionBar keys={functionKeys} />

      {dialog?.kind === 'mkdir' && (
        <PromptDialog
          title="Create folder"
          icon="create_new_folder"
          label={`Inside ${sourceTab.path}`}
          initialValue=""
          confirmLabel="Create"
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null)
            void (async () => {
              const path = joinFor(platformOf(sourceTab.nodeId), sourceTab.path, name)
              const done = await run(api().fs.mkdir({ nodeId: sourceTab.nodeId, path }))
              if (done !== null) await panes.refresh(focus)
            })()
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          icon="edit"
          label="New name"
          initialValue={dialog.current}
          confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            const from = dialog.from
            setDialog(null)
            void (async () => {
              const platform = platformOf(sourceTab.nodeId)
              const to = joinFor(platform, dirnameFor(platform, from), name)
              if (to === from) return
              const done = await run(api().fs.rename(sourceTab.nodeId, from, to))
              if (done !== null) await panes.refresh(focus)
            })()
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete"
          icon="delete_forever"
          destructive
          confirmLabel={`Delete ${dialog.paths.length}`}
          message={`Permanently delete ${dialog.paths.length} ${
            dialog.paths.length === 1 ? 'item' : 'items'
          }?`}
          detail={
            <div className="omni-inset rounded p-space-base max-h-40 overflow-y-auto omni-scroll">
              {dialog.paths.slice(0, 40).map((ref) => (
                <p
                  key={ref.path}
                  className="font-data-tabular-md text-data-tabular-md text-on-surface-variant break-all"
                >
                  {ref.path}
                </p>
              ))}
              {dialog.paths.length > 40 && (
                <p className="font-data-tabular-md text-data-tabular-md text-outline mt-space-xs">
                  …and {dialog.paths.length - 40} more
                </p>
              )}
              <p className="font-body-md text-body-md text-warning mt-space-sm">
                This bypasses the recycle bin and cannot be undone.
              </p>
            </div>
          }
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const paths = dialog.paths
            setDialog(null)
            void performDelete(paths, focus)
          }}
        />
      )}

      {dialog?.kind === 'transfer' && (
        <ConfirmDialog
          title={dialog.operation === 'copy' ? 'Copy to the other pane' : 'Move to the other pane'}
          icon={dialog.operation === 'copy' ? 'content_copy' : 'drive_file_move'}
          confirmLabel={dialog.operation === 'copy' ? 'Copy' : 'Move'}
          message={`${dialog.sources.length} ${
            dialog.sources.length === 1 ? 'item' : 'items'
          } → ${dialog.targetDir.path}`}
          detail={
            <div className="omni-inset rounded p-space-base font-data-tabular-md text-data-tabular-md text-on-surface-variant space-y-space-xs">
              <p>
                From <span className="text-on-surface">{useNodes.getState().nodeName(dialog.sources[0]?.nodeId ?? LOCAL_NODE_ID)}</span>{' '}
                to <span className="text-on-surface">{useNodes.getState().nodeName(dialog.targetDir.nodeId)}</span>
              </p>
              {selectionBytesKnown && (
                <p>
                  Files selected: <span className="text-secondary">{formatBytes(knownBytes)}</span>
                  {hasFolders && (
                    <span className="text-outline">
                      {' '}
                      · folder contents are measured before the copy starts
                    </span>
                  )}
                </p>
              )}
            </div>
          }
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const request = dialog
            setDialog(null)
            void (async () => {
              const batchId = await run(
                api().transfer.enqueue({
                  sources: request.sources,
                  targetDir: request.targetDir,
                  operation: request.operation
                })
              )
              if (batchId === null) return
              panes.clearSelection(focus)
              await panes.refresh(otherId)
              onOpenQueue()
            })()
          }}
        />
      )}
    </div>
  )
}

/** The sub-header strip: what the panes are connected to, and key hints. */
function TelemetryStrip(): ReactNode {
  const { focus, left, right } = usePanes()
  const nodeName = useNodes((s) => s.nodeName)
  const status = useNodes((s) => s.status)
  const sourceTab = activeTab(focus === 'left' ? left : right)
  const targetTab = activeTab(focus === 'left' ? right : left)

  const crossMachine = sourceTab.nodeId !== targetTab.nodeId

  return (
    <div className="w-full shrink-0 bg-surface-container-lowest px-space-base py-space-xs flex items-center justify-between gap-space-lg">
      <div className="flex items-center gap-space-lg min-w-0">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="swap_horiz" size={14} className="text-primary" />
          <span className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
            Channel:
          </span>
          <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface truncate">
            {nodeName(sourceTab.nodeId)} → {nodeName(targetTab.nodeId)}
          </span>
          <span
            className={`font-data-tabular-sm text-data-tabular-sm px-space-xs py-space-2xs rounded ${
              crossMachine ? 'text-secondary bg-secondary/10' : 'text-on-surface-variant bg-surface-container'
            }`}
          >
            {crossMachine ? 'OmniDirect P2P' : 'Local filesystem'}
          </span>
        </div>
        {status?.interfaceAddress !== null && status !== null && (
          <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant hidden lg:inline">
            Interface: <span className="text-on-surface">{status.interfaceName}</span> ·{' '}
            {status.interfaceAddress}:{status.serverPort}
          </span>
        )}
      </div>

      <div className="flex items-center gap-space-sm shrink-0">
        <span className="flex items-center gap-space-xs bg-surface-container px-space-sm py-space-2xs rounded">
          <KeyBadge>TAB</KeyBadge>
          <span className="font-body-sm text-body-sm text-on-surface-variant">Switch pane</span>
        </span>
        <span className="flex items-center gap-space-xs bg-surface-container px-space-sm py-space-2xs rounded">
          <KeyBadge>SPACE</KeyBadge>
          <span className="font-body-sm text-body-sm text-on-surface-variant">Tag item</span>
        </span>
      </div>
    </div>
  )
}

/** The vertical action rail between the panes. */
function TransferRail({
  direction,
  canTransfer,
  onCopy,
  onMove,
  onSwap,
  onMirror
}: {
  direction: 'left' | 'right'
  canTransfer: boolean
  onCopy: () => void
  onMove: () => void
  onSwap: () => void
  onMirror: () => void
}): ReactNode {
  return (
    <div className="shrink-0 w-9 flex flex-col items-center justify-center gap-space-sm bg-surface px-space-2xs">
      <button
        type="button"
        onClick={onCopy}
        disabled={!canTransfer}
        title="Copy to the other pane (F5)"
        className="w-7 h-7 flex items-center justify-center rounded bg-primary-container/20 border border-primary-container/50 text-primary hover:bg-primary-container/35 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Icon name={direction === 'right' ? 'arrow_forward' : 'arrow_back'} size={16} />
      </button>
      <button
        type="button"
        onClick={onMove}
        disabled={!canTransfer}
        title="Move to the other pane (F6)"
        className="w-7 h-7 flex items-center justify-center rounded bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Icon name={direction === 'right' ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'} size={16} />
      </button>
      <div className="w-4 h-px bg-outline-variant/60" />
      <IconButton icon="content_copy" title="Mirror this folder to the other pane" onClick={onMirror} size={15} />
      <IconButton icon="swap_horiz" title="Swap panes" onClick={onSwap} size={15} />
    </div>
  )
}

interface MenuItem {
  label: string
  icon: string
  hint?: string
  disabled?: boolean
  onPress: () => void
}

function ContextMenu({
  items,
  onClose
}: {
  items: MenuItem[]
  onClose: () => void
}): ReactNode {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute z-40 bottom-space-base left-1/2 -translate-x-1/2 w-[340px] bg-surface-container/95 backdrop-blur-md border border-outline/60 rounded-lg shadow-[0_16px_36px_-8px_rgba(0,0,0,0.85)] py-space-xs">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onPress()
            }}
            className="w-full flex items-center gap-space-sm px-space-base h-7 text-left text-on-surface hover:bg-surface-container-high disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name={item.icon} size={15} className="text-on-surface-variant" />
            <span className="flex-1 font-body-md text-body-md">{item.label}</span>
            {item.hint !== undefined && (
              <span className="font-keybind-label text-keybind-label text-outline">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}

export { basenameFor }
