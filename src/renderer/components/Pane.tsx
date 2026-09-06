/**
 * One pane: machine selector, volume selector, tab strip, breadcrumb path bar,
 * the file table, and a footer with selection and free-space telemetry.
 */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { PathRef, RowDensity, Volume } from '@shared/types'
import { LOCAL_NODE_ID } from '@shared/types'
import { formatBytes, formatLatency, latencyTone, percent } from '@shared/format'
import { joinFor, middleEllipsis, segmentsFor } from '@shared/paths'
import {
  activeTab,
  selectionBytes,
  usePanes,
  visibleRows,
  type PaneId
} from '../state/usePanes'
import { useNodes } from '../state/useNodes'
import { LATENCY_TEXT } from '../lib/tone'
import { FileTable } from './FileTable'
import { IconButton } from './controls'
import { Icon, Pill, ProgressBar, StatusDot } from './primitives'

const PLATFORM_ICON: Record<string, string> = {
  win32: 'desktop_windows',
  darwin: 'laptop_mac',
  linux: 'terminal'
}

const VOLUME_ICON: Record<Volume['kind'], string> = {
  fixed: 'hard_drive',
  removable: 'usb',
  network: 'lan',
  home: 'home'
}

export function Pane({ id, density }: { id: PaneId; density: RowDensity }): ReactNode {
  const pane = usePanes((s) => s[id])
  const focus = usePanes((s) => s.focus)
  const showHidden = usePanes((s) => s.showHidden)
  const actions = usePanes()
  const nodes = useNodes((s) => s.nodes)
  const peers = useNodes((s) => s.peers)
  const platformOf = useNodes((s) => s.platformOf)

  const tab = activeTab(pane)
  const platform = platformOf(tab.nodeId)
  const focused = focus === id
  const rows = useMemo(
    () => visibleRows(pane, platform, showHidden),
    [pane, platform, showHidden]
  )

  const peer = tab.nodeId === LOCAL_NODE_ID ? null : peers.find((p) => p.id === tab.nodeId)
  const volume = pane.volumes
    .filter((v) => v.kind !== 'home' && tab.path.toLowerCase().startsWith(v.path.toLowerCase()))
    .sort((a, b) => b.path.length - a.path.length)[0]

  const go = (ref: PathRef): void => {
    actions.setFocus(id)
    void actions.navigate(id, ref)
  }

  const onRowClick = (index: number, event: MouseEvent): void => {
    actions.setFocus(id)
    if (event.shiftKey) actions.selectTo(id, index)
    else if (event.ctrlKey || event.metaKey) actions.toggleSelectAt(id, index)
    else actions.setCursor(id, index)
  }

  return (
    <section
      onMouseDown={() => actions.setFocus(id)}
      className={`flex-1 min-w-[380px] flex flex-col bg-surface-container-low overflow-hidden ${
        focused ? 'omni-pane-active' : ''
      }`}
    >
      {/* Machine + volume header */}
      <div className="h-header-height shrink-0 bg-surface-container-high px-space-base flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <span className="w-5 h-5 rounded flex items-center justify-center bg-primary/10 text-primary shrink-0">
            <Icon name={PLATFORM_ICON[platform] ?? 'devices'} size={14} />
          </span>
          <NodeSelector
            value={tab.nodeId}
            nodes={nodes}
            onChange={(nodeId) => {
              // Switching machine invalidates the path; land on that node's home.
              void (async () => {
                actions.setFocus(id)
                const home = await window.omni.fs.home(nodeId)
                go({ nodeId, path: home.ok ? home.data : '' })
              })()
            }}
          />
          {focused && <Pill tone="primary">FOCUSED</Pill>}
          {peer !== null && peer !== undefined && (
            <span className="flex items-center gap-space-2xs">
              <StatusDot tone={peer.state === 'paired' ? 'secondary' : 'warning'} />
              <span
                className={`font-data-tabular-sm text-data-tabular-sm ${LATENCY_TEXT[latencyTone(peer.rttMs)]}`}
              >
                {formatLatency(peer.rttMs)}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-space-sm shrink-0">
          <VolumeSelector
            volumes={pane.volumes}
            current={volume}
            onPick={(path) => go({ nodeId: tab.nodeId, path })}
          />
          <div className="flex items-center bg-surface-container-lowest p-space-2xs rounded gap-space-2xs">
            <IconButton
              icon="home"
              title="Home"
              onClick={() => {
                void (async () => {
                  const home = await window.omni.fs.home(tab.nodeId)
                  if (home.ok) go({ nodeId: tab.nodeId, path: home.data })
                })()
              }}
            />
            <IconButton
              icon="refresh"
              title="Refresh (Ctrl+R)"
              onClick={() => void actions.refresh(id)}
            />
            <IconButton
              icon={showHidden ? 'visibility' : 'visibility_off'}
              title="Toggle hidden files (Ctrl+H)"
              active={showHidden}
              onClick={() => actions.setShowHidden(!showHidden)}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center px-space-xs pt-space-xs gap-space-2xs bg-surface-container-lowest shrink-0">
        {pane.tabs.map((paneTab) => {
          const active = paneTab.id === pane.activeTabId
          const label = paneTab.path === '' ? 'New tab' : leafLabel(paneTab.path, platformOf(paneTab.nodeId))
          return (
            <div
              key={paneTab.id}
              className={`group flex items-center gap-space-xs px-space-sm h-6 rounded-t cursor-default ${
                active
                  ? 'bg-surface-container text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container/60'
              }`}
              onClick={() => void actions.activateTab(id, paneTab.id)}
            >
              <Icon name="folder" size={12} />
              <span className="font-body-md text-body-md max-w-[160px] truncate">{label}</span>
              {pane.tabs.length > 1 && (
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.closeTab(id, paneTab.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          )
        })}
        <IconButton icon="add" title="New tab (Ctrl+T)" onClick={() => actions.addTab(id)} />
      </div>

      {/* Breadcrumb / raw path */}
      <PathBar
        nodeId={tab.nodeId}
        path={tab.path}
        platform={platform}
        onNavigate={(path) => go({ nodeId: tab.nodeId, path })}
      />

      {pane.error !== null ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-space-sm px-space-lg text-center">
          <Icon name="folder_off" size={28} className="text-error/70" />
          <p className="font-headline-md text-headline-md text-error">{pane.error.message}</p>
          <p className="font-data-tabular-md text-data-tabular-md text-on-surface-variant break-all max-w-[60ch]">
            {tab.path}
          </p>
          <button
            type="button"
            onClick={() => void actions.up(id)}
            className="font-body-md text-body-md text-primary hover:underline"
          >
            Go to parent folder
          </button>
        </div>
      ) : (
        <FileTable
          rows={rows}
          cursor={pane.cursor}
          selected={pane.selected}
          focused={focused}
          density={density}
          platform={platform}
          sort={pane.sort}
          onSort={(column) => actions.setSort(id, column)}
          onRowClick={onRowClick}
          onRowDoubleClick={(index) => {
            actions.setCursor(id, index)
            void actions.enter(id)
          }}
          onFocus={() => actions.setFocus(id)}
        />
      )}

      {/* Footer telemetry */}
      <div className="h-6 shrink-0 px-space-md flex items-center justify-between gap-space-base bg-surface-container border-t border-outline-variant/30 font-data-tabular-sm text-data-tabular-sm">
        <span className={pane.selected.size > 0 ? 'text-primary' : 'text-on-surface-variant'}>
          {pane.selected.size} selected
          {pane.selected.size > 0 && ` (${formatBytes(selectionBytes(pane))})`}
          <span className="text-outline"> · </span>
          <span className="text-on-surface-variant">
            {rows.filter((r) => r !== '..').length} listed
          </span>
        </span>
        {pane.loading && <span className="text-primary animate-pulse">reading…</span>}
        {volume !== undefined && (
          <span className="flex items-center gap-space-sm min-w-0">
            <span className="text-on-surface-variant">
              Free: <span className="text-secondary">{formatBytes(volume.freeBytes)}</span> of{' '}
              {formatBytes(volume.totalBytes)}
            </span>
            <span className="w-16 shrink-0">
              <ProgressBar
                value={percent(volume.totalBytes - volume.freeBytes, volume.totalBytes)}
                tone="primary"
                height={3}
              />
            </span>
          </span>
        )}
      </div>
    </section>
  )
}

function leafLabel(path: string, platform: 'win32' | 'darwin' | 'linux'): string {
  const segments = segmentsFor(platform, path)
  return segments[segments.length - 1]?.label ?? path
}

function NodeSelector({
  value,
  nodes,
  onChange
}: {
  value: string
  nodes: Array<{ id: string; name: string; platform: string }>
  onChange: (nodeId: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const current = nodes.find((n) => n.id === value)

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-space-xs min-w-0 hover:text-primary transition-colors"
      >
        <span className="font-headline-md text-headline-md text-on-surface truncate">
          {current?.name ?? 'Unknown machine'}
        </span>
        <Icon name="expand_more" size={14} className="text-on-surface-variant shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 mt-space-xs min-w-[240px] bg-surface-container/95 backdrop-blur-md border border-outline/60 rounded shadow-[0_16px_36px_-8px_rgba(0,0,0,0.85)] py-space-2xs">
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (node.id !== value) onChange(node.id)
                }}
                className={`w-full flex items-center gap-space-sm px-space-base h-7 text-left transition-colors ${
                  node.id === value
                    ? 'text-primary bg-primary/10'
                    : 'text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <Icon name={PLATFORM_ICON[node.platform] ?? 'devices'} size={14} />
                <span className="font-body-md text-body-md truncate">{node.name}</span>
              </button>
            ))}
            {nodes.length === 1 && (
              <p className="px-space-base py-space-sm font-body-sm text-body-sm text-outline">
                No paired machines yet — pair one in Network Discovery.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function VolumeSelector({
  volumes,
  current,
  onPick
}: {
  volumes: Volume[]
  current: Volume | undefined
  onPick: (path: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-space-xs bg-surface-container px-space-sm h-6 rounded hover:bg-surface-bright transition-colors"
      >
        <Icon name="hard_drive" size={15} className="text-primary" />
        <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface max-w-[180px] truncate">
          {current === undefined
            ? volumes.length === 0
              ? 'no volumes'
              : 'select volume'
            : `${current.label} (${current.fs.toUpperCase()})`}
        </span>
        {current !== undefined && (
          <span className="font-data-tabular-sm text-data-tabular-sm text-secondary">
            {formatBytes(current.freeBytes)} free
          </span>
        )}
        <Icon name="expand_more" size={14} className="text-on-surface-variant" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full right-0 mt-space-xs w-[340px] bg-surface-container/95 backdrop-blur-md border border-outline/60 rounded shadow-[0_16px_36px_-8px_rgba(0,0,0,0.85)] py-space-2xs max-h-[320px] overflow-y-auto omni-scroll">
            {volumes.map((volume) => (
              <button
                key={volume.path}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPick(volume.path)
                }}
                className="w-full flex items-center gap-space-sm px-space-base py-space-sm text-left hover:bg-surface-container-high transition-colors"
              >
                <Icon name={VOLUME_ICON[volume.kind]} size={16} className="text-primary shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-body-md text-body-md text-on-surface truncate">
                    {volume.label}
                  </span>
                  <span className="block font-data-tabular-sm text-data-tabular-sm text-on-surface-variant truncate">
                    {volume.path} · {volume.fs.toUpperCase()}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block font-data-tabular-sm text-data-tabular-sm text-secondary">
                    {formatBytes(volume.freeBytes)} free
                  </span>
                  <span className="block font-data-tabular-sm text-data-tabular-sm text-outline">
                    of {formatBytes(volume.totalBytes)}
                  </span>
                </span>
              </button>
            ))}
            {volumes.length === 0 && (
              <p className="px-space-base py-space-sm font-body-sm text-body-sm text-outline">
                No volumes reported by this machine.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Clicking a token drills to it; clicking the background switches to raw text
 * entry, per the design's interactive path bar.
 */
function PathBar({
  nodeId,
  path,
  platform,
  onNavigate
}: {
  nodeId: string
  path: string
  platform: 'win32' | 'darwin' | 'linux'
  onNavigate: (path: string) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(path)

  useEffect(() => {
    setDraft(path)
    setEditing(false)
    // A machine or path change abandons any half-typed path.
  }, [path, nodeId])

  const segments = segmentsFor(platform, path)

  if (editing) {
    return (
      <div className="h-6 shrink-0 px-space-md flex items-center bg-surface-container border-b border-outline-variant/30">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setEditing(false)
              if (draft.trim() !== '') onNavigate(draft.trim())
            }
            if (e.key === 'Escape') {
              setDraft(path)
              setEditing(false)
            }
          }}
          className="w-full bg-transparent outline-none font-data-tabular-md text-data-tabular-md text-on-surface select-text"
        />
      </div>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      title={path}
      className="h-6 shrink-0 px-space-md flex items-center gap-space-2xs bg-surface-container border-b border-outline-variant/30 cursor-text overflow-hidden"
    >
      <Icon name="folder_open" size={13} className="text-on-surface-variant shrink-0" />
      {segments.length === 0 ? (
        <span className="font-data-tabular-md text-data-tabular-md text-outline">
          select a volume
        </span>
      ) : (
        segments.map((segment, index) => {
          const last = index === segments.length - 1
          return (
            <span key={segment.path} className="flex items-center gap-space-2xs min-w-0">
              {index > 0 && <span className="text-outline-variant shrink-0">/</span>}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onNavigate(segment.path)
                }}
                className={`font-data-tabular-md text-data-tabular-md truncate transition-colors ${
                  last ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {middleEllipsis(segment.label, 28)}
              </button>
            </span>
          )
        })
      )}
    </div>
  )
}

export { joinFor }
