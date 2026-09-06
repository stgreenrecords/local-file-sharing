# OmniCommander

A dual-pane file commander for Windows and macOS where the two panes can live on
**different machines on the same network**. Machines find each other automatically
over mDNS/Bonjour, you pair them once with a 6-digit code, and then you browse and
copy files in either direction — Mac → Windows, Windows → Mac, or locally.

Both copies of the app are equal peers: each one runs a small HTTP file server so the
other side can browse it, and a client so it can browse the other side. There is no
server to set up and nothing to mount.

## Quick start

```bash
npm install
npm run dev
```

Run the same thing on the second machine. Open **Network Discovery** on both, then on
one of them press **Connect & pair** and type the 6-digit code the other machine is
showing. Its drives then appear in the machine selector at the top of either pane.

Copy with **F5**, move with **F6**, and watch progress in **Transfer & Sync Queue**.

## Packaging

```bash
npm run dist:win   # NSIS installer (x64 + arm64)
npm run dist:mac   # dmg + zip (universal)
```

## Development

```bash
npm run typecheck   # tsc over every source tree
npm test            # vitest
npm run build       # bundle without packaging
```

Two instances on one machine will discover each other — give the second one its own
identity and port:

```bash
OMNI_DATA_DIR=.dev/node-b OMNI_PORT=47655 npm run dev
```

Discovery needs UDP 5353. On Windows the first run asks for a firewall exception on
the private profile; if peers never appear, that prompt was probably denied — use the
**Direct IP connection** panel in Network Discovery instead.

## Security, stated plainly

Pairing requires a code shown on the target machine's screen, and three wrong codes
lock pairing for five minutes. But **transfers are unencrypted HTTP on the LAN**, and
**a paired peer can read anything the app user can read** — there is no per-path
allowlist yet. That is fine for a home or studio network you control; it is not
suitable for public Wi-Fi. The app warns in the title bar when the active interface is
outside the private address ranges. See `docs/PROTOCOL.md` for the full threat model
and `docs/ROADMAP.md` for what is planned (TLS with pinned per-node certificates).

## Where things are

| Path | What |
|---|---|
| `CLAUDE.md` | Conventions and architecture rules for working in this repo |
| `docs/ARCHITECTURE.md` | Process model, the node abstraction, data flow |
| `docs/PROTOCOL.md` | Wire protocol, pairing, endpoint contracts, path rules |
| `docs/ROADMAP.md` | Phased plan, current status, known gaps |
| `design/` | The approved screen designs this UI is built from |
