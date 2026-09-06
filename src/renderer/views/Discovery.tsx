/**
 * LAN discovery: what this machine is advertising, which peers answered, and the
 * pairing flow. A peer's drives are only listed once trust exists.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Peer, Volume } from '@shared/types'
import { formatBytes, formatLatency, formatPin, latencyTone } from '@shared/format'
import { useNodes } from '../state/useNodes'
import { usePanes } from '../state/usePanes'
import { useToasts } from '../state/useToasts'
import { LATENCY_TEXT } from '../lib/tone'
import { Button, TextInput, Toggle } from '../components/controls'
import { PairDialog } from '../components/dialogs'
import { EmptyState, Icon, Pill, SectionCard, StatusDot } from '../components/primitives'
import { useSettings, effective } from '../state/useSettings'

const PLATFORM_ICON: Record<string, string> = {
  win32: 'desktop_windows',
  darwin: 'laptop_mac',
  linux: 'terminal'
}

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

const VOLUME_ICON: Record<Volume['kind'], string> = {
  fixed: 'hard_drive',
  removable: 'usb',
  network: 'lan',
  home: 'home'
}

export function Discovery({ onOpenCommander }: { onOpenCommander: () => void }): ReactNode {
  const { peers, status, rescan, rotatePin } = useNodes()
  const settingsState = useSettings()
  const [pairing, setPairing] = useState<Peer | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void useNodes.getState().refresh()
  }, [])

  const discoveryEnabled = effective(settingsState, 'discoveryEnabled', true)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto omni-scroll p-space-lg space-y-space-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-space-lg">
        <div className="flex items-start gap-space-base">
          <span className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Icon name="hub" size={24} />
          </span>
          <div>
            <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-secondary">
              <StatusDot tone={status?.discoveryActive === true ? 'secondary' : 'warning'} />
              <span className="ml-space-xs">
                {status?.discoveryActive === true
                  ? 'mDNS beacon active'
                  : 'mDNS beacon inactive'}
              </span>
            </p>
            <h1 className="font-headline-xl text-headline-xl text-on-surface">
              LAN machine discovery
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant mt-space-2xs">
              Machines running OmniCommander on this network announce themselves over
              Bonjour/mDNS. Pair once with a 6-digit code, then browse their drives in either
              pane.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-space-sm shrink-0">
          <Button icon="refresh" variant="accent" onClick={() => void rescan()}>
            Rescan network
          </Button>
        </div>
      </div>

      {/* This machine */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-space-base">
        <div className="omni-inset rounded-lg border border-outline-variant/30 px-space-lg py-space-base">
          <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
            This machine
          </p>
          <p className="font-headline-md text-headline-md text-on-surface truncate">
            {status?.identity.displayName ?? '--'}
          </p>
          <p className="font-data-tabular-md text-data-tabular-md text-on-surface-variant mt-space-2xs">
            {PLATFORM_LABEL[status?.identity.platform ?? ''] ?? '--'} ·{' '}
            {status?.interfaceAddress ?? 'no address'}:{status?.serverPort ?? '--'}
          </p>
          <p className="font-data-tabular-sm text-data-tabular-sm text-outline mt-space-xs">
            fingerprint {status?.identity.fingerprint ?? '--'}
          </p>
        </div>

        <div className="omni-inset rounded-lg border border-outline-variant/30 px-space-lg py-space-base">
          <div className="flex items-center justify-between mb-space-xs">
            <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
              Pairing code
            </p>
            <button
              type="button"
              onClick={() => void rotatePin()}
              className="font-body-sm text-body-sm text-primary hover:underline"
            >
              new code
            </button>
          </div>
          {status?.pairingLockedUntil !== null && status?.pairingLockedUntil !== undefined ? (
            <p className="font-headline-lg text-headline-lg text-danger">Locked</p>
          ) : (
            <p className="font-data-tabular-lg text-[24px] tracking-[0.3em] text-secondary select-text">
              {formatPin(status?.pairingPin ?? null)}
            </p>
          )}
          <p className="font-body-md text-body-md text-on-surface-variant mt-space-xs">
            {status?.pairingLockedUntil !== null && status?.pairingLockedUntil !== undefined
              ? 'Too many wrong codes. Pairing reopens in a few minutes.'
              : 'Type this on the other machine to pair. It rotates every 5 minutes.'}
          </p>
        </div>

        <div className="omni-inset rounded-lg border border-outline-variant/30 px-space-lg py-space-base">
          <div className="flex items-center justify-between gap-space-base">
            <div className="min-w-0">
              <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
                Discovery beacon
              </p>
              <p className="font-body-lg text-body-lg text-on-surface">
                mDNS · Bonjour · _omnidirect._tcp
              </p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
                {status?.peerCount ?? 0} machines seen · {status?.pairedCount ?? 0} paired
              </p>
            </div>
            <Toggle
              checked={discoveryEnabled}
              label="Discovery beacon"
              onChange={(value) => {
                settingsState.edit({ discoveryEnabled: value })
                void settingsState.save()
              }}
            />
          </div>
        </div>
      </div>

      {/* Peers */}
      <div>
        <div className="flex items-center justify-between mb-space-base">
          <h2 className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
            Discovered machines{' '}
            <Pill tone={peers.length > 0 ? 'primary' : 'neutral'}>{peers.length}</Pill>
          </h2>
          <div className="flex items-center gap-space-base font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
            <span className="flex items-center gap-space-2xs">
              <StatusDot tone="secondary" /> paired
            </span>
            <span className="flex items-center gap-space-2xs">
              <StatusDot tone="primary" /> discovered
            </span>
            <span className="flex items-center gap-space-2xs">
              <StatusDot tone="neutral" /> unreachable
            </span>
          </div>
        </div>

        {peers.length === 0 ? (
          <div className="bg-surface-container-low rounded-lg border border-outline-variant/30">
            <EmptyState
              icon="wifi_find"
              title="No other machines found yet"
              detail={
                status?.discoveryActive === true
                  ? 'Start OmniCommander on the other machine and keep both on the same network. Discovery needs UDP 5353 (mDNS) — on Windows the first run asks for a firewall exception on the private profile.'
                  : 'The mDNS beacon is not running, so nothing can be discovered automatically. Use a direct IP connection below, or re-enable the beacon.'
              }
              action={
                <Button icon="refresh" onClick={() => void rescan()} className="mt-space-sm">
                  Rescan
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-space-base">
            {peers.map((peer) => (
              <PeerCard
                key={peer.id}
                peer={peer}
                onPair={() => setPairing(peer)}
                onOpenCommander={onOpenCommander}
              />
            ))}
          </div>
        )}
      </div>

      <ManualConnect />

      {pairing !== null && (
        <PairDialog
          peerName={pairing.name}
          fingerprint={pairing.fingerprint}
          busy={busy}
          onClose={() => setPairing(null)}
          onConfirm={(pin) => {
            const target = pairing
            setBusy(true)
            void (async () => {
              const paired = await useNodes.getState().pair(target.id, pin)
              setBusy(false)
              if (paired) {
                setPairing(null)
                useToasts.getState().push({
                  tone: 'success',
                  title: `Paired with ${target.name}`,
                  detail: 'Its drives are now selectable in either pane.'
                })
              }
            })()
          }}
        />
      )}
    </div>
  )
}

function PeerCard({
  peer,
  onPair,
  onOpenCommander
}: {
  peer: Peer
  onPair: () => void
  onOpenCommander: () => void
}): ReactNode {
  const panes = usePanes()
  const unpair = useNodes((s) => s.unpair)

  const stateTone =
    peer.state === 'paired'
      ? 'secondary'
      : peer.state === 'discovered' || peer.state === 'pairing'
        ? 'primary'
        : peer.state === 'incompatible'
          ? 'warning'
          : 'neutral'

  const accent =
    peer.state === 'paired'
      ? 'before:bg-secondary'
      : peer.state === 'discovered'
        ? 'before:bg-primary-container'
        : 'before:bg-outline-variant'

  const openInPane = (pane: 'left' | 'right', path: string): void => {
    void panes.navigate(pane, { nodeId: peer.id, path })
    panes.setFocus(pane)
    onOpenCommander()
  }

  return (
    <article
      className={`relative bg-surface-container-low rounded-lg border border-outline-variant/30 overflow-hidden before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${accent}`}
    >
      <header className="flex items-start justify-between gap-space-base p-space-lg pb-space-base">
        <div className="flex items-start gap-space-base min-w-0">
          <span className="w-11 h-11 rounded-lg bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0">
            <Icon name={PLATFORM_ICON[peer.platform] ?? 'devices'} size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-space-sm flex-wrap">
              <Pill tone="neutral">{PLATFORM_LABEL[peer.platform] ?? peer.platform}</Pill>
              <Pill tone={stateTone}>{peer.state.toUpperCase()}</Pill>
            </div>
            <h3 className="font-headline-lg text-headline-lg text-on-surface truncate mt-space-xs">
              {peer.name}
            </h3>
            <p className="font-data-tabular-md text-data-tabular-md text-on-surface-variant truncate">
              {peer.host === '' ? 'address unknown' : `${peer.host}:${peer.port}`}
              {peer.fingerprint !== '' && (
                <span className="text-outline"> · {peer.fingerprint}</span>
              )}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`font-data-tabular-lg text-data-tabular-lg ${LATENCY_TEXT[latencyTone(peer.rttMs)]}`}>
            {formatLatency(peer.rttMs)}
          </p>
          <p className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
            protocol v{peer.protocolVersion}
          </p>
        </div>
      </header>

      {peer.error !== undefined && peer.error !== '' && (
        <p className="mx-space-lg mb-space-base px-space-base py-space-sm rounded bg-error-container/20 border border-error/30 font-body-md text-body-md text-error">
          {peer.error}
        </p>
      )}

      {peer.state === 'paired' ? (
        <div className="px-space-lg pb-space-base">
          <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-sm">
            Available drives
          </p>
          {peer.volumes.length === 0 ? (
            <p className="font-body-md text-body-md text-outline">
              No volumes reported yet — rescan to refresh.
            </p>
          ) : (
            <ul className="space-y-space-2xs">
              {peer.volumes.map((volume) => (
                <li
                  key={volume.path}
                  className="flex items-center gap-space-base omni-inset rounded px-space-base py-space-sm"
                >
                  <Icon
                    name={VOLUME_ICON[volume.kind]}
                    size={16}
                    className="text-primary shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block font-body-lg text-body-lg text-on-surface truncate">
                      {volume.label}
                    </span>
                    <span className="block font-data-tabular-sm text-data-tabular-sm text-on-surface-variant truncate">
                      {volume.path} · {volume.fs.toUpperCase()} ·{' '}
                      {formatBytes(volume.freeBytes)} free of {formatBytes(volume.totalBytes)}
                    </span>
                  </span>
                  <span className="flex items-center gap-space-2xs shrink-0">
                    <Button onClick={() => openInPane('left', volume.path)}>Left pane</Button>
                    <Button variant="accent" onClick={() => openInPane('right', volume.path)}>
                      Right pane
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="px-space-lg pb-space-base">
          <p className="font-body-md text-body-md text-on-surface-variant">
            {peer.state === 'incompatible'
              ? `This machine runs protocol v${peer.protocolVersion}; this build speaks v1. Update both to the same version.`
              : peer.state === 'unreachable'
                ? 'Advertised but not answering. It may be asleep, or a firewall is blocking the port.'
                : 'Not paired yet. Pairing needs the 6-digit code shown on that machine.'}
          </p>
        </div>
      )}

      <footer className="flex items-center justify-between gap-space-sm px-space-lg py-space-base border-t border-outline-variant/30 bg-surface-container-lowest/60">
        {peer.state === 'paired' ? (
          <>
            <Button
              icon="dock_to_right"
              onClick={() => {
                const first = peer.volumes[0]
                if (first !== undefined) openInPane('right', first.path)
                else onOpenCommander()
              }}
            >
              Open in commander
            </Button>
            <Button icon="link_off" variant="danger" onClick={() => void unpair(peer.id)}>
              Unpair
            </Button>
          </>
        ) : (
          <>
            <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
              {peer.host === '' ? 'waiting for an address' : 'ready to pair'}
            </span>
            <Button
              icon="key"
              variant="accent"
              disabled={peer.state === 'incompatible' || peer.host === ''}
              onClick={onPair}
            >
              Connect &amp; pair
            </Button>
          </>
        )}
      </footer>
    </article>
  )
}

/** Direct IP entry, for subnets where multicast is blocked. */
function ManualConnect(): ReactNode {
  const status = useNodes((s) => s.status)
  const connectManual = useNodes((s) => s.connectManual)
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(status?.serverPort ?? 47654))
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    const digits = pin.replace(/\D/g, '')
    if (host.trim() === '' || digits.length !== 6) return
    setBusy(true)
    void (async () => {
      const paired = await connectManual(host.trim(), Number(port) || 47654, digits)
      setBusy(false)
      if (paired) {
        setHost('')
        setPin('')
        useToasts.getState().push({ tone: 'success', title: 'Paired over direct IP' })
      }
    })()
  }

  return (
    <SectionCard
      icon="cable"
      title="Direct IP connection"
      subtitle="Use this when multicast is blocked and a machine never shows up in the scan."
    >
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-space-base items-end">
        <label className="block">
          <span className="block font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
            Host or IP
          </span>
          <TextInput value={host} onChange={setHost} placeholder="192.168.1.140" onSubmit={submit} />
        </label>
        <label className="block">
          <span className="block font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
            Port
          </span>
          <TextInput value={port} onChange={setPort} placeholder="47654" onSubmit={submit} />
        </label>
        <label className="block">
          <span className="block font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
            Their pairing code
          </span>
          <TextInput value={pin} onChange={setPin} placeholder="000000" onSubmit={submit} />
        </label>
        <Button
          variant="accent"
          icon="link"
          disabled={busy || host.trim() === '' || pin.replace(/\D/g, '').length !== 6}
          onClick={submit}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </SectionCard>
  )
}
