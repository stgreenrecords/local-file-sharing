/**
 * The only bridge between renderer and main. Nothing here does work — it maps
 * the `OmniApi` surface onto IPC channels one-to-one.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channel, type EnqueueRequest, type OmniApi } from '@shared/ipc'
import type {
  ConflictPrompt,
  ConflictResolution,
  DaemonStatus,
  PathRef,
  Peer,
  Settings,
  TransferSnapshot
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: OmniApi = {
  fs: {
    volumes: (nodeId) => ipcRenderer.invoke(Channel.FS_VOLUMES, nodeId),
    list: (ref) => ipcRenderer.invoke(Channel.FS_LIST, ref),
    stat: (ref) => ipcRenderer.invoke(Channel.FS_STAT, ref),
    home: (nodeId) => ipcRenderer.invoke(Channel.FS_HOME, nodeId),
    mkdir: (ref) => ipcRenderer.invoke(Channel.FS_MKDIR, ref),
    remove: (nodeId, paths) => ipcRenderer.invoke(Channel.FS_DELETE, nodeId, paths),
    rename: (nodeId, from, to) => ipcRenderer.invoke(Channel.FS_RENAME, nodeId, from, to),
    reveal: (ref) => ipcRenderer.invoke(Channel.FS_REVEAL, ref),
    open: (ref) => ipcRenderer.invoke(Channel.FS_OPEN, ref)
  },
  net: {
    status: () => ipcRenderer.invoke(Channel.NET_STATUS),
    peers: () => ipcRenderer.invoke(Channel.NET_PEERS),
    nodes: () => ipcRenderer.invoke(Channel.NET_NODES),
    rescan: () => ipcRenderer.invoke(Channel.NET_RESCAN),
    pair: (nodeId, pin) => ipcRenderer.invoke(Channel.NET_PAIR, nodeId, pin),
    unpair: (nodeId) => ipcRenderer.invoke(Channel.NET_UNPAIR, nodeId),
    connectManual: (host, port, pin) =>
      ipcRenderer.invoke(Channel.NET_CONNECT_MANUAL, host, port, pin),
    rotatePin: () => ipcRenderer.invoke(Channel.NET_ROTATE_PIN)
  },
  transfer: {
    enqueue: (req: EnqueueRequest) => ipcRenderer.invoke(Channel.TRANSFER_ENQUEUE, req),
    snapshot: () => ipcRenderer.invoke(Channel.TRANSFER_SNAPSHOT),
    pause: () => ipcRenderer.invoke(Channel.TRANSFER_PAUSE),
    resume: () => ipcRenderer.invoke(Channel.TRANSFER_RESUME),
    cancelBatch: (batchId) => ipcRenderer.invoke(Channel.TRANSFER_CANCEL_BATCH, batchId),
    clearDone: () => ipcRenderer.invoke(Channel.TRANSFER_CLEAR_DONE),
    resolveConflict: (jobId, resolution: ConflictResolution) =>
      ipcRenderer.invoke(Channel.TRANSFER_RESOLVE, jobId, resolution)
  },
  settings: {
    get: () => ipcRenderer.invoke(Channel.SETTINGS_GET),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(Channel.SETTINGS_SET, patch),
    reset: () => ipcRenderer.invoke(Channel.SETTINGS_RESET),
    exportConfig: () => ipcRenderer.invoke(Channel.SETTINGS_EXPORT)
  },
  window: {
    minimize: () => ipcRenderer.send(Channel.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(Channel.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(Channel.WINDOW_CLOSE)
  },
  on: {
    peers: (cb) => subscribe<Peer[]>(Channel.EVENT_PEERS, cb),
    status: (cb) => subscribe<DaemonStatus>(Channel.EVENT_STATUS, cb),
    transfers: (cb) => subscribe<TransferSnapshot>(Channel.EVENT_TRANSFERS, cb),
    conflict: (cb) => subscribe<ConflictPrompt>(Channel.EVENT_CONFLICT, cb),
    dirChanged: (cb) => subscribe<PathRef>(Channel.EVENT_DIR_CHANGED, cb)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('omni', api)
