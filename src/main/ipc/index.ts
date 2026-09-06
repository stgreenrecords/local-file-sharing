/**
 * Renderer-facing handlers. Every one returns a `Result` — nothing rejects across
 * the IPC boundary, so the UI always has a value to render.
 */
import { BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { Channel, type EnqueueRequest } from '@shared/ipc'
import { LOCAL_NODE_ID, type ConflictResolution, type Peer, type Settings } from '@shared/types'
import { ErrorCode, OmniError, attempt } from '@shared/errors'
import { providerFor, forgetProvider } from '../fs/resolve'
import { invalidateVolumeCache } from '../fs/volumes'
import { onPairingChange, pairingPin, rotatePin } from '../net/auth'
import { hello, pairWithPeer } from '../net/client'
import { activeInterface, loadVolumes, rescan } from '../net/discovery'
import * as registry from '../net/registry'
import { engine } from '../transfer'
import { store } from '../store'
import { daemonStatus, serverPort } from '../daemon'

export function registerIpc(): void {
  /* ── filesystem ───────────────────────────────────────────────────── */

  ipcMain.handle(Channel.FS_VOLUMES, (_e, nodeId: string) =>
    attempt(() => providerFor(nodeId).volumes())
  )
  ipcMain.handle(Channel.FS_LIST, (_e, ref: { nodeId: string; path: string }) =>
    attempt(() => providerFor(ref.nodeId).list(ref.path))
  )
  ipcMain.handle(Channel.FS_STAT, (_e, ref: { nodeId: string; path: string }) =>
    attempt(() => providerFor(ref.nodeId).stat(ref.path))
  )
  ipcMain.handle(Channel.FS_HOME, (_e, nodeId: string) =>
    attempt(() => providerFor(nodeId).home())
  )
  ipcMain.handle(Channel.FS_MKDIR, (_e, ref: { nodeId: string; path: string }) =>
    attempt(async () => {
      await providerFor(ref.nodeId).mkdir(ref.path)
      invalidateVolumeCache()
    })
  )
  ipcMain.handle(Channel.FS_DELETE, (_e, nodeId: string, paths: string[]) =>
    attempt(() => providerFor(nodeId).remove(paths))
  )
  ipcMain.handle(Channel.FS_RENAME, (_e, nodeId: string, from: string, to: string) =>
    attempt(() => providerFor(nodeId).rename(from, to))
  )

  // Reveal/open only make sense for paths on this machine.
  ipcMain.handle(Channel.FS_REVEAL, (_e, ref: { nodeId: string; path: string }) =>
    attempt(() => {
      requireLocal(ref.nodeId, 'reveal in file manager')
      shell.showItemInFolder(ref.path)
    })
  )
  ipcMain.handle(Channel.FS_OPEN, (_e, ref: { nodeId: string; path: string }) =>
    attempt(async () => {
      requireLocal(ref.nodeId, 'open with the default application')
      const error = await shell.openPath(ref.path)
      if (error !== '') throw new OmniError(ErrorCode.DENIED, error)
    })
  )

  /* ── network ──────────────────────────────────────────────────────── */

  ipcMain.handle(Channel.NET_STATUS, () => attempt(() => daemonStatus()))
  ipcMain.handle(Channel.NET_PEERS, () => attempt(() => registry.list()))
  ipcMain.handle(Channel.NET_NODES, () => attempt(() => registry.selectableNodes()))
  ipcMain.handle(Channel.NET_RESCAN, () =>
    attempt(() => {
      rescan()
    })
  )
  ipcMain.handle(Channel.NET_ROTATE_PIN, () =>
    attempt(() => {
      const pin = rotatePin()
      if (pin === null) throw new OmniError(ErrorCode.PAIR_LOCKED, 'Pairing is locked')
      return pin
    })
  )

  ipcMain.handle(Channel.NET_PAIR, (_e, nodeId: string, pin: string) =>
    attempt(async () => pairAndRefresh(nodeId, pin))
  )

  ipcMain.handle(Channel.NET_UNPAIR, (_e, nodeId: string) =>
    attempt(() => {
      store().forget(nodeId)
      forgetProvider(nodeId)
      registry.patch(nodeId, { state: 'discovered', volumes: [] })
    })
  )

  ipcMain.handle(
    Channel.NET_CONNECT_MANUAL,
    (_e, host: string, port: number, pin: string) =>
      attempt(async () => {
        // A manually entered host may not be in the registry yet, so probe first
        // and register what we learn before pairing.
        const probe = await hello(host, port)
        registry.upsert({
          id: probe.hello.id,
          name: probe.hello.name,
          platform: probe.hello.platform,
          host,
          addresses: [host],
          port,
          fingerprint: probe.hello.fp,
          protocolVersion: probe.hello.ver,
          state: 'pairing',
          rttMs: probe.rttMs,
          lastSeen: Date.now(),
          volumes: []
        })
        return pairAndRefresh(probe.hello.id, pin)
      })
  )

  /* ── transfers ────────────────────────────────────────────────────── */

  ipcMain.handle(Channel.TRANSFER_ENQUEUE, (_e, req: EnqueueRequest) =>
    attempt(() => engine.enqueue(req.sources, req.targetDir, req.operation))
  )
  ipcMain.handle(Channel.TRANSFER_SNAPSHOT, () => attempt(() => engine.snapshot()))
  ipcMain.handle(Channel.TRANSFER_PAUSE, () => attempt(() => engine.pause()))
  ipcMain.handle(Channel.TRANSFER_RESUME, () => attempt(() => engine.resume()))
  ipcMain.handle(Channel.TRANSFER_CANCEL_BATCH, (_e, batchId: string) =>
    attempt(() => engine.cancelBatch(batchId))
  )
  ipcMain.handle(Channel.TRANSFER_CLEAR_DONE, () => attempt(() => engine.clearDone()))
  ipcMain.handle(
    Channel.TRANSFER_RESOLVE,
    (_e, jobId: string, resolution: ConflictResolution) =>
      attempt(() => engine.resolveConflict(jobId, resolution))
  )

  /* ── settings ─────────────────────────────────────────────────────── */

  ipcMain.handle(Channel.SETTINGS_GET, () => attempt(() => store().settings()))
  ipcMain.handle(Channel.SETTINGS_SET, (_e, patch: Partial<Settings>) =>
    attempt(() => store().patchSettings(patch))
  )
  ipcMain.handle(Channel.SETTINGS_RESET, () => attempt(() => store().resetSettings()))
  ipcMain.handle(Channel.SETTINGS_EXPORT, (event) =>
    attempt(async () => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const target = await dialog.showSaveDialog(window ?? BrowserWindow.getAllWindows()[0]!, {
        title: 'Export configuration',
        defaultPath: 'omnicommander-config.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (target.canceled || target.filePath === undefined) return null
      const payload = {
        exportedAt: new Date().toISOString(),
        identity: store().identity(),
        settings: store().settings(),
        trustedPeers: store().trustedPeers()
      }
      await writeFile(target.filePath, JSON.stringify(payload, null, 2), 'utf8')
      return target.filePath
    })
  )

  /* ── window ───────────────────────────────────────────────────────── */

  ipcMain.on(Channel.WINDOW_MINIMIZE, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  )
  ipcMain.on(Channel.WINDOW_MAXIMIZE, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(Channel.WINDOW_CLOSE, (event) => BrowserWindow.fromWebContents(event.sender)?.close())
}

/**
 * Pairs, then asks the peer to pair back using the PIN we display, so one click
 * establishes trust in both directions.
 */
async function pairAndRefresh(nodeId: string, pin: string): Promise<Peer> {
  const peer = registry.get(nodeId)
  if (peer === undefined) {
    throw new OmniError(ErrorCode.UNKNOWN_NODE, 'That machine is no longer on the network')
  }
  registry.patch(nodeId, { state: 'pairing', error: undefined })
  try {
    const ourPin = pairingPin()
    await pairWithPeer(peer.host, peer.port, pin, {
      ...(ourPin === null ? {} : { reciprocate: { pin: ourPin, port: serverPort() } })
    })
    registry.patch(nodeId, { state: 'paired', error: undefined })
    await loadVolumes(nodeId)
    return registry.get(nodeId)!
  } catch (err) {
    registry.patch(nodeId, {
      state: 'discovered',
      error: err instanceof Error ? err.message : 'Pairing failed'
    })
    throw err
  }
}

function requireLocal(nodeId: string, action: string): void {
  if (nodeId !== LOCAL_NODE_ID) {
    throw new OmniError(ErrorCode.PROTOCOL, `Cannot ${action} on a remote machine`)
  }
}

/** Wires main-process events to a window's renderer. */
export function bridgeEvents(window: BrowserWindow): () => void {
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const unsubscribers = [
    registry.onPeersChanged((peers) => {
      send(Channel.EVENT_PEERS, peers)
      send(Channel.EVENT_STATUS, daemonStatus())
    }),
    engine.onChange((snapshot) => send(Channel.EVENT_TRANSFERS, snapshot)),
    engine.onConflict((prompt) => send(Channel.EVENT_CONFLICT, prompt)),
    onPairingChange(() => send(Channel.EVENT_STATUS, daemonStatus()))
  ]

  // The PIN rotates on a timer; refresh the header so a stale code is never shown.
  const statusTimer = setInterval(() => send(Channel.EVENT_STATUS, daemonStatus()), 10_000)
  statusTimer.unref?.()

  return () => {
    clearInterval(statusTimer)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

export { activeInterface }
