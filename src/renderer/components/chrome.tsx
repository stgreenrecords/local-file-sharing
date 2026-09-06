/**
 * The fixed frame: title bar, top navigation, function-key dock and status bar.
 * Heights are locked to the design's layout geometry tokens.
 */
import type { ReactNode } from 'react'
import { formatBytes, formatLatency, latencyTone } from '@shared/format'
import { useNodes } from '../state/useNodes'
import { usePanes, activeTab, selectionBytes } from '../state/usePanes'
import { useTransfers } from '../state/useTransfers'
import { Icon, Pill, StatusDot } from './primitives'
import { LATENCY_TEXT } from '../lib/tone'
import type { ViewId } from '../App'

const NAV: Array<{ id: ViewId; label: string }> = [
  { id: 'commander', label: 'Dual Pane Commander' },
  { id: 'queue', label: 'Transfer & Sync Queue' },
  { id: 'discovery', label: 'Network Discovery' },
  { id: 'settings', label: 'Settings & Preferences' }
]

export function TitleBar(): ReactNode {
  const status = useNodes((s) => s.status)
  const isMac = window.omni.platform === 'darwin'

  const linkTone = status?.discoveryActive === true ? 'secondary' : 'warning'
  const linkLabel =
    status === null
      ? 'Starting daemon'
      : !status.serverListening
        ? 'Daemon offline'
        : status.discoveryActive
          ? `LAN active · ${status.interfaceName ?? 'unknown interface'}`
          : 'Discovery unavailable'

  return (
    <div className="h-header-height shrink-0 w-full px-space-base flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-low omni-drag-region">
      <div className="flex items-center gap-space-sm">
        {/* macOS draws its own traffic lights in the inset title bar. */}
        {isMac && <span className="w-[70px]" />}
        <div className="flex items-center gap-space-xs">
          <Icon name="dock_to_right" size={16} className="text-primary" />
          <span className="font-headline-md text-headline-md text-on-surface">
            OmniCommander
          </span>
          <span className="font-data-tabular-sm text-data-tabular-sm text-outline">
            cross-platform dual-pane
          </span>
        </div>
      </div>

      <div className="flex items-center gap-space-base omni-no-drag">
        {status !== null && !status.privateNetwork && status.interfaceAddress !== null && (
          <Pill tone="warning">
            <Icon name="lock_open" size={11} className="mr-space-2xs align-[-2px]" />
            Public network — traffic is unencrypted
          </Pill>
        )}
        <div className="flex items-center gap-space-xs px-space-sm py-space-2xs rounded bg-surface-container border border-outline-variant/40">
          <StatusDot tone={linkTone} pulse={status?.discoveryActive === true} />
          <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant uppercase tracking-wider">
            {linkLabel}
          </span>
          {status !== null && (
            <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface">
              {status.pairedCount}/{status.peerCount} paired
            </span>
          )}
        </div>
        {!isMac && <WindowControls />}
      </div>
    </div>
  )
}

function WindowControls(): ReactNode {
  return (
    <div className="flex items-center gap-space-2xs">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => window.omni.window.minimize()}
        className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-high"
      >
        <Icon name="remove" size={16} />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        onClick={() => window.omni.window.maximize()}
        className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-high"
      >
        <Icon name="crop_square" size={14} />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => window.omni.window.close()}
        className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

export function TopNav({
  view,
  onNavigate
}: {
  view: ViewId
  onNavigate: (view: ViewId) => void
}): ReactNode {
  const status = useNodes((s) => s.status)
  const queueCount = useTransfers(
    (s) => s.snapshot.jobs.filter((j) => j.status === 'queued' || j.status === 'active').length
  )

  return (
    <div className="h-header-height shrink-0 w-full px-space-base flex items-center justify-between bg-surface-container border-b border-outline-variant/20">
      <nav className="flex items-center h-full gap-space-xs">
        {NAV.map((item) => {
          const active = item.id === view
          const badge = item.id === 'queue' && queueCount > 0 ? ` (${queueCount})` : ''
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`h-full px-space-base flex items-center transition-colors font-body-lg text-body-lg ${
                active
                  ? 'bg-surface-container-high text-primary border-b-2 border-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              {item.label}
              {badge}
            </button>
          )
        })}
      </nav>

      <div className="flex items-center gap-space-xs font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
        <span className="px-space-xs py-space-2xs bg-surface-container-low border border-outline-variant/30 rounded text-on-surface">
          NODE: {status?.identity.displayName ?? '--'}
        </span>
        <span className="text-outline">|</span>
        <span>PORT: {status?.serverPort ?? '--'}</span>
      </div>
    </div>
  )
}

export interface FunctionKey {
  key: string
  label: string
  onPress: () => void
  disabled?: boolean
}

export function FunctionBar({ keys }: { keys: FunctionKey[] }): ReactNode {
  return (
    <div className="h-function-bar-height shrink-0 w-full grid gap-space-2xs px-space-2xs py-space-2xs bg-surface-container-lowest border-t border-outline-variant/30"
      style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
    >
      {keys.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={entry.onPress}
          disabled={entry.disabled}
          className="flex items-center justify-center gap-space-sm rounded-sm bg-surface-container-low border border-outline-variant/40 text-on-surface hover:bg-surface-container-high active:translate-y-px active:border-primary-container/60 transition-[background-color,transform] disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <span className="font-keybind-label text-keybind-label text-primary">{entry.key}</span>
          <span className="font-body-md text-body-md">{entry.label}</span>
        </button>
      ))}
    </div>
  )
}

export function StatusBar(): ReactNode {
  const { focus, left, right, showHidden } = usePanes()
  const pane = focus === 'left' ? left : right
  const platformOf = useNodes((s) => s.platformOf)
  const peers = useNodes((s) => s.peers)
  const status = useNodes((s) => s.status)

  const tab = activeTab(pane)
  const volume = pane.volumes
    .filter((v) => tab.path.toLowerCase().startsWith(v.path.toLowerCase()))
    // The deepest matching mount owns the path.
    .sort((a, b) => b.path.length - a.path.length)[0]

  const selectedCount = pane.selected.size
  const bytes = selectionBytes(pane)
  const visibleCount = pane.entries.filter((e) => showHidden || !e.hidden).length
  const activePeer = tab.nodeId === 'local' ? null : peers.find((p) => p.id === tab.nodeId)

  return (
    <div className="h-statusbar-height shrink-0 w-full px-space-base flex items-center justify-between bg-surface-container-lowest border-t border-outline-variant/20 font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
      <div className="flex items-center gap-space-base min-w-0">
        <span>
          Selected:{' '}
          <span className="text-on-surface">
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'}
          </span>
          {selectedCount > 0 && <span className="text-secondary"> ({formatBytes(bytes)})</span>}
        </span>
        <span className="text-outline">|</span>
        <span>
          Listed: <span className="text-on-surface">{visibleCount}</span>
        </span>
        {volume !== undefined && (
          <>
            <span className="text-outline">|</span>
            <span>
              Free: <span className="text-secondary">{formatBytes(volume.freeBytes)}</span> of{' '}
              {formatBytes(volume.totalBytes)} ({volume.fs.toUpperCase()})
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-space-base">
        <span>
          Path style:{' '}
          <span className="text-on-surface">
            {platformOf(tab.nodeId) === 'win32' ? 'Windows' : 'POSIX'}
          </span>
        </span>
        <span className="text-outline">|</span>
        {activePeer === undefined || activePeer === null ? (
          <span>
            Socket: <span className="text-on-surface">local</span>
          </span>
        ) : (
          <span>
            Socket:{' '}
            <span className={activePeer.state === 'paired' ? 'text-secondary' : 'text-warning'}>
              {activePeer.state.toUpperCase()}
            </span>{' '}
            <span className={LATENCY_TEXT[latencyTone(activePeer.rttMs)]}>
              {formatLatency(activePeer.rttMs)}
            </span>
          </span>
        )}
        <span className="text-outline">|</span>
        <span className="text-outline">
          {status?.identity.fingerprint.slice(0, 8) ?? '--------'}
        </span>
      </div>
    </div>
  )
}
