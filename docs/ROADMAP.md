# Roadmap

Status legend: `[x]` done and verified · `[~]` partially done · `[ ]` not started

## Phase 0 — Foundation `[x]`
- [x] AI context file (`CLAUDE.md`) and reference docs
- [x] electron-vite + TypeScript + React + Tailwind scaffold
- [x] Design tokens transcribed into `tailwind.config.mjs`
- [x] Local fonts + Material Symbols (offline-capable, no CDN, CSP forbids remotes)
- [x] Shared types, IPC channel registry, typed preload bridge
- [x] JSON settings/trust store with atomic writes and corrupt-file recovery
- [x] Vitest suite (`npm test`)

## Phase 1 — Local commander `[x]`
- [x] Volume enumeration (Windows drive letters via WMI + `statfs`, macOS `/Volumes`)
- [x] Directory listing with sortable Name/Ext/Size/Modified/Attrs columns
- [x] Dual-pane shell, per-pane tabs, breadcrumb + raw path entry
- [x] Keyboard model: Tab/arrows/Space/Shift-select/Enter/Backspace, F3–F10
- [x] mkdir (F7), delete (F8), rename (Shift+F6)

## Phase 2 — Discovery `[x]`
- [x] mDNS advertise + browse, self-echo filtering, unique instance naming
- [x] Peer probe with RTT, reachable/unreachable state
- [x] PIN pairing, token trust store, one-click reciprocal pairing
- [x] Brute-force lockout (3 bad PINs in 60 s → 5 min lock)
- [x] Discovery view with peer cards and per-peer volume lists
- [x] "Open in left/right pane" wiring from a peer volume
- [x] Direct-IP pairing for subnets where multicast is blocked
- [x] Default-route interface detection (not the first virtual adapter)
- [x] Peer address ranking + fallback across every advertised address
- [x] Automatic reconnect to paired machines, independent of mDNS, with backoff

## Phase 3 — Remote browsing `[x]`
- [x] HTTP API server (volumes/list/stat/file/mkdir/delete/rename)
- [x] Peer client implementing the same `FsProvider` interface
- [x] Either pane bound to any node; local is just `nodeId: 'local'`
- [x] Cross-platform path handling via `shared/paths.ts`
- [x] Range requests on download (full, bounded and suffix ranges)

## Phase 4 — Transfer engine `[~]`
- [x] Recursive walk, byte-accurate totals before the transfer starts
- [x] Streaming copy with SHA-256 verification and `.omnipart` staging
- [x] Queue with pause/resume/cancel and progress throttling
- [x] Conflict policy: ask / overwrite-if-newer / keep-both / skip-identical
- [x] Per-job failure isolation — one bad file does not abort the batch
- [x] Same-node move (copy, verify, then delete the source)
- [x] Queue view: active stream, pending, completed, throughput chart
- [ ] Range-based resume of an interrupted single file (server supports it;
      the engine never asks for a range)
- [ ] Move *across* nodes — currently refused up front rather than risking the source
- [ ] Parallel workers > 1. The engine is serial; the setting exists but the slider
      is disabled and the value is ignored.

## Phase 5 — Hardening `[ ]`
- [ ] TLS with self-signed per-node certs, pinned at pairing via `fp`
- [x] Warn in the UI when the active interface is outside RFC1918
- [ ] Read-only shares and a per-path export allowlist. **Today a paired peer can
      read anything the app user can read.**
- [ ] Windows long-path (`\\?\`) support and macOS resource-fork edge cases
- [ ] Windows hidden/system file attributes (needs a shell-out; Node cannot read
      DOS attributes, so `R`/`D`/`A` are currently inferred)
- [ ] Crash-safe queue: persist and offer to resume on next launch
- [ ] Subset the Material Symbols font — the full face is ~3.3 MB of the bundle

## Phase 6 — Beyond OmniCommander peers `[ ]`
- [ ] SFTP `FsProvider` for Linux/NAS hosts
- [ ] SMB `FsProvider` for NAS shares
- [ ] Folder compare / sync mode (the Ctrl+D "Diff Check" affordance in the design)
- [ ] F3 viewer (text/hex/image quick look) — F3/F4 currently hand off to the OS
      handler, which only works for local files

## Verification status

| Area | How it is covered |
|---|---|
| `shared/paths.ts` | 78 unit tests, both platform directions |
| Interface selection | 21 unit tests incl. the real WSL/Bluetooth/Wi-Fi adapter set |
| Transfer walk | 12 unit tests with fake providers |
| Transfer engine | 20 tests driving the real engine + real `LocalProvider` over temp dirs |
| HTTP protocol | 34 checks run against a live instance (see below) |
| UI render | Confirmed manually against a running build |
| Discovery → pair → transfer | Driven end to end between two live instances over CDP: mDNS discovery, PIN pairing (both legs), a 12 MB copy over HTTP with a matching SHA-256, and reconnect after restart with mDNS switched off |

The HTTP protocol checks are not yet part of `npm test` — they need two live
instances, so they were run as a one-off script. Turning them into a
`vitest` suite that boots the server in-process is worth doing.

## Bugs found and fixed during the initial build

1. **Streams metered with a `'data'` listener dropped bytes.** Attaching the
   listener put the stream into flowing mode before the writer was piped, so small
   files failed with "Stream ended early" and larger ones were at risk. Both
   `fs/local.ts` and `transfer/engine.ts` now count inside a `Transform`.
2. **mDNS advertisement failed when two machines shared a hostname.** The instance
   name now carries a fingerprint suffix.
3. **The reported LAN address was the WSL virtual adapter.** Interface selection now
   asks the kernel which source address the default route uses.
4. **A move marked the job done before deleting the source, and swallowed a failed
   deletion.** The delete now happens first, and a failure is reported on the job.
5. **Cross-machine pairing always failed ("socket hang up").** Discovery worked and
   the handshake was correct, but a peer's *first advertised* IPv4 address was
   dialed blindly. `bonjour-service` emits an A record for every interface, and a
   virtual adapter (WSL here) sorted first — an address the other machine cannot
   route to. Addresses are now ranked by reachability and every candidate is tried.
6. **Known machines did not reconnect on their own.** Trust persisted but the
   endpoint did not, seeding lived inside mDNS startup (so it never ran with the
   beacon off), and retries were a flat 15s. The endpoint is now persisted,
   reconnection is independent of mDNS, and retries back off from 2s.
