# Roadmap

Status legend: `[x]` done · `[~]` in progress · `[ ]` not started

## Phase 0 — Foundation `[x]`
- [x] AI context files (`CLAUDE.md`) and reference docs
- [x] electron-vite + TypeScript + React + Tailwind scaffold
- [x] Design tokens transcribed into `tailwind.config.js`
- [x] Local fonts + Material Symbols (offline-capable, no CDN)
- [x] Shared types, IPC channel registry, typed preload bridge
- [x] JSON settings/trust store with atomic writes

## Phase 1 — Local commander `[x]`
- [x] Volume enumeration (Windows drive letters, macOS `/Volumes`)
- [x] Directory listing with sortable Name/Ext/Size/Modified/Attrs columns
- [x] Dual-pane shell, per-pane tabs, breadcrumb + raw path entry
- [x] Keyboard model: Tab/arrows/Space/Shift-select/Enter/Backspace, F3–F10
- [x] mkdir (F7), delete (F8), rename (Shift+F6)

## Phase 2 — Discovery `[x]`
- [x] mDNS advertise + browse, self-echo filtering
- [x] Peer probe with RTT, reachable/unreachable state
- [x] PIN pairing, token trust store, one-click reciprocal pairing
- [x] Discovery view with peer cards and per-peer volume lists
- [x] "Open in Right Pane" wiring from a peer volume

## Phase 3 — Remote browsing `[x]`
- [x] HTTP API server (volumes/list/stat/file/mkdir/delete/rename)
- [x] Peer client implementing the same `FsProvider` interface
- [x] Either pane bound to any node; local is just `nodeId: 'local'`
- [x] Cross-platform path handling via `shared/paths.ts`

## Phase 4 — Transfer engine `[~]`
- [x] Recursive walk, byte-accurate totals before transfer starts
- [x] Streaming copy with SHA-256 verification and `.omnipart` staging
- [x] Queue with pause/resume/cancel and progress throttling
- [x] Conflict policy: ask / overwrite-if-newer / keep-both / skip-identical
- [x] Queue view: active stream, pending, completed, throughput chart
- [ ] Range-based resume of an interrupted single file
- [ ] Move across nodes (copy + verify + delete source)
- [ ] Parallel workers >1 (engine is serial today; setting is present but clamped)

## Phase 5 — Hardening `[ ]`
- [ ] TLS with self-signed per-node certs, pinned at pairing via `fp`
- [ ] Warn when the active interface is outside RFC1918
- [ ] Read-only shares and per-path export allowlist (currently a peer with a token
      can read anything the app user can read)
- [ ] Windows long-path (`\?\`) and macOS resource-fork edge cases
- [ ] Crash-safe queue: persist and offer to resume on next launch

## Phase 6 — Beyond OmniCommander peers `[ ]`
- [ ] SFTP `FsProvider` for Linux/NAS hosts
- [ ] SMB `FsProvider` for NAS shares
- [ ] Folder compare / sync mode (the Ctrl+D "Diff Check" affordance in the design)
- [ ] F3 viewer (text/hex/image quick look)

## Known gaps in the current build
- Throughput figures are measured, but the design's 10GbE/RDMA labels are cosmetic —
  the sub-bar reports the real interface and measured rate instead.
- Only one transfer runs at a time; the worker slider is capped until the parallel
  engine lands.
- No auto-update channel yet.
