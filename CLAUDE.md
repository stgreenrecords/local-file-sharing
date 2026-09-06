# OmniCommander — Cross-Platform Dual-Pane File Commander

Desktop app (Windows + macOS) that works like Total Commander, but the two panes can
live on **different machines on the same LAN**. Machines discover each other
automatically over mDNS; files/folders/drives are browsed and copied in either
direction (Mac -> Windows, Windows -> Mac, or local <-> local).

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron 33 | Main process doubles as the network daemon |
| Build | electron-vite + TypeScript | `src/main`, `src/preload`, `src/renderer` |
| UI | React 18 + Tailwind CSS 3 | Tokens generated from `design/precision_dual_pane_commander/DESIGN.md` |
| State | Zustand | One store per domain, see `src/renderer/state` |
| Icons/Fonts | Material Symbols Outlined, Geist, JetBrains Mono | Bundled locally, never CDN (app must work offline) |
| Discovery | `bonjour-service` (pure JS mDNS) | No native modules anywhere in the dep tree |
| Transport | Node `http` + streams | See `docs/PROTOCOL.md` |
| Packaging | electron-builder | `nsis` (win), `dmg` + `zip` (mac, universal) |

**Hard rule: no native/compiled npm dependencies.** They break cross-compiling and
CI. If a task seems to need one, solve it with Node built-ins or a platform shell-out
in `src/main/platform/`.

## Layout

```
src/
  shared/      Types + IPC channel names. Imported by ALL three processes.
               Must stay free of node: and electron imports.
  main/        Node/Electron main process = the daemon
    fs/        Local filesystem: volumes, listing, mutations
    net/       discovery (mDNS), server (HTTP API), client (peer calls), auth (pairing)
    transfer/  Queue + streaming copy engine
    ipc/       Renderer-facing handlers, one module per domain
  preload/     contextBridge surface. The ONLY bridge; no nodeIntegration.
  renderer/    React UI
    views/     One per top nav tab: Commander, Queue, Discovery, Settings
    components/ Reusable primitives styled from the design tokens
    state/     Zustand stores
```

## Conventions

- **Path handling**: a path always belongs to a *node*, and that node has a platform.
  Never use `node:path` on a remote path — use `src/shared/paths.ts`
  (`joinFor(platform, ...)`, `dirnameFor`, `sepFor`). A `PathRef` is
  `{ nodeId, path }` and is the unit of navigation and transfer.
- **Every filesystem or network call goes through IPC.** The renderer never touches
  `node:fs`, sockets, or peer URLs. Renderer -> `window.omni.*` -> preload -> IPC
  handler -> main.
- **Local node is a peer like any other.** `nodeId === 'local'` resolves to direct fs
  calls; everything else goes over HTTP. UI code must not branch on this — the main
  process resolves it in `src/main/fs/resolve.ts`.
- **Errors cross IPC as values**, never thrown strings:
  `{ ok: true, data }` | `{ ok: false, error: { code, message } }`. Codes live in
  `src/shared/errors.ts`.
- **Styling**: Tailwind token classes only (`bg-surface-container`, `text-body-md`,
  `p-space-sm`). No raw hex, no arbitrary px spacing outside `tailwind.config.js`.
  The token set is closed — extend the config rather than inventing a one-off value.
- **Long operations stream progress**: transfers push `transfer:progress` events on a
  throttle (>=100ms), never per-chunk.

## Design source of truth

`design/` holds the approved screens. `code.html` in each folder is the reference
markup — port it to React components, keep the class names, drop the CDN script tags.

| Folder | View |
|---|---|
| `dual_pane_commander_macos_windows` | `views/Commander` |
| `active_transfer_sync_queue` | `views/Queue` |
| `network_machine_discovery_mounting` | `views/Discovery` |
| `app_settings_cross_platform_preferences` | `views/Settings` |

The screens show fictional demo data (10GbE, RDMA, NVMe-oF). Reproduce the *layout and
chrome*, but every number must come from real measurement or be omitted. Do not render
a metric the app cannot actually compute.

## Commands

```bash
npm run dev        # electron-vite dev, HMR on the renderer
npm run typecheck  # tsc on all three tsconfigs — must pass before any commit
npm run lint
npm run build      # bundle only
npm run dist:win   # NSIS installer
npm run dist:mac   # dmg + zip
```

## Testing discovery locally

Two instances on one machine will find each other — run a second copy with a distinct
identity and port:

```bash
OMNI_DATA_DIR=.dev/node-b OMNI_PORT=47655 npm run dev
```

Discovery needs UDP 5353 (mDNS). On Windows, first run prompts for a firewall
exception on the private profile; if peers do not appear, that prompt was denied.

## Reference docs

- `docs/ARCHITECTURE.md` — process model, data flow, module responsibilities
- `docs/PROTOCOL.md` — wire protocol, pairing, auth, endpoint contracts
- `docs/ROADMAP.md` — phased build plan and current status
