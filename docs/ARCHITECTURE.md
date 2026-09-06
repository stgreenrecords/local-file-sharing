# Architecture

## Process model

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron Main  (= "OmniDaemon")                    Node runtime │
│                                                                 │
│  net/discovery ── mDNS advertise + browse (_omnidirect._tcp)     │
│  net/server ──── HTTP API on OMNI_PORT (default 47654)          │
│  net/client ──── HTTP calls out to paired peers                 │
│  net/auth ────── PIN pairing, token issue/verify, trust store    │
│  fs/* ────────── volumes, directory listing, mkdir/delete/move   │
│  fs/resolve ──── nodeId -> local fs | peer client (single seam)  │
│  transfer/* ──── queue, streaming copy, hash verify, progress    │
│  store ───────── settings + trust persisted as JSON in userData  │
└───────────────┬─────────────────────────────────────────────────┘
                │ ipcMain.handle / webContents.send
┌───────────────┴─────────────────────────────────────────────────┐
│ Preload  (contextBridge, sandboxed)                              │
│   window.omni = { fs, net, transfer, settings, on }              │
└───────────────┬─────────────────────────────────────────────────┘
┌───────────────┴─────────────────────────────────────────────────┐
│ Renderer  React + Tailwind — no node access                      │
│   views/Commander · Queue · Discovery · Settings                 │
│   state/ panes · nodes · transfers · settings (Zustand)          │
└─────────────────────────────────────────────────────────────────┘
```

Both instances of the app are symmetric peers: each one simultaneously runs a server
(so the other side can browse it) and a client (so it can browse the other side).
There is no central coordinator.

## The node abstraction

Everything the UI shows lives on a **node**. The local machine is the node with
`id: 'local'`; every discovered machine is a node identified by its persistent UUID.

```ts
type NodePlatform = 'win32' | 'darwin' | 'linux'
type NodeRef = { id: string; name: string; platform: NodePlatform }
type PathRef = { nodeId: string; path: string }
```

`fs/resolve.ts` is the only place that knows whether a `PathRef` means "call
`node:fs`" or "issue an HTTP request". Both branches satisfy the same `FsProvider`
interface:

```ts
interface FsProvider {
  volumes(): Promise<Volume[]>
  list(path: string): Promise<DirEntry[]>
  stat(path: string): Promise<DirEntry>
  mkdir(path: string): Promise<void>
  remove(paths: string[]): Promise<void>
  rename(from: string, to: string): Promise<void>
  read(path: string, range?: ByteRange): Promise<Readable>
  write(path: string, body: Readable, size: number): Promise<void>
  home(): Promise<string>
}
```

Adding a future transport (SFTP, SMB) means adding one `FsProvider` implementation —
no UI or transfer-engine changes.

## Data flow: a copy from Mac pane to Windows pane

1. Renderer: user presses **F5**. `panes` store sends the selected `PathRef[]` plus
   the target `PathRef` over `transfer.enqueue`.
2. Main: `transfer/queue.ts` walks each source directory recursively via the source
   node's `FsProvider.list`, flattening to a job list of file-sized units. Total byte
   count is known before the first byte moves, so ETA is real.
3. For each job, `transfer/engine.ts` opens `source.read(path)` and pipes into
   `target.write(path, stream, size)` through a `PassThrough` that feeds a
   `crypto.createHash('sha256')` and a byte counter.
4. The counter emits `transfer:progress` at most every 100 ms with
   `{ jobId, bytes, total, bps }`. `bps` is an exponentially weighted average over a
   2-second window, not an instantaneous delta.
5. On stream end, the target's returned digest is compared with the source digest.
   Mismatch -> job fails, partial file is unlinked, queue continues.
6. Conflict policy (`ask` | `overwrite-if-newer` | `keep-both` | `skip-identical`) is
   evaluated with a `stat` on the target before the stream opens.

Directory *creation* happens eagerly during the walk so an empty source folder still
materialises on the target.

## Discovery lifecycle

1. On boot, `net/server` binds a port, then `net/discovery` advertises
   `_omnidirect._tcp` with TXT records `{ id, name, platform, ver, fp }`.
2. The browser fires `up`/`down`. Records whose `id` matches our own are dropped
   (mDNS echoes our own advertisement back).
3. Each discovered peer is probed with `GET /api/hello` to confirm reachability and
   measure RTT. Failure keeps the peer listed but marked `unreachable`.
4. Peers we already hold a token for transition straight to `paired`, and their
   volumes are fetched. Unpaired peers show a **Connect & Pair** action.
5. `net/discovery` re-probes every 15 s to refresh RTT and catch silent drops.

## Persistence

`app.getPath('userData')/omni.json` (override the whole directory with
`OMNI_DATA_DIR` for a second dev instance):

```jsonc
{
  "identity": { "nodeId": "uuid", "displayName": "Viach-MBP", "secret": "hex" },
  "trust": { "<peerNodeId>": { "token": "hex", "name": "...", "pairedAt": 0 } },
  "settings": { /* see shared/types.ts Settings */ },
  "bookmarks": [ { "nodeId": "local", "path": "/Users/x/Projects", "label": "..." } ]
}
```

Writes are atomic (write temp + rename) because both the daemon and the UI mutate it.

## Why not SMB mounting?

The design mentions mounting shares, and the settings screen keeps SMB/SFTP as
transport options. They are deliberately *not* the v1 path:

- SMB needs OS-level credentials and admin rights, and behaves differently on macOS
  (`mount_smbfs`) vs Windows (`net use`).
- Mount points leak: a crashed app leaves stale mounts.
- A direct HTTP stream between two copies of the same app gives one code path, real
  progress reporting, and end-to-end hash verification.

SMB/SFTP remain viable as extra `FsProvider` implementations for reaching NAS boxes
and Linux servers that do not run OmniCommander — that is `docs/ROADMAP.md` phase 6.
