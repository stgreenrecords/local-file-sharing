# OmniDirect wire protocol v1

Peer-to-peer HTTP/1.1 over TCP on the LAN. Every instance is both server and client.
Default port **47654** (`OMNI_PORT` to override; the server increments on `EADDRINUSE`
and advertises whatever it actually bound).

## Discovery

- Service type: `_omnidirect._tcp` (mDNS / Bonjour / DNS-SD, UDP 5353)
- Instance name: `<display name>-<first 6 hex of fingerprint>`. An mDNS instance
  name must be unique per subnet, and two machines often share a hostname; the
  readable name travels in the `name` TXT record instead.
- TXT records:

| Key | Meaning |
|---|---|
| `id` | Persistent node UUID. Used to ignore our own echo and to key the trust store. |
| `name` | Human display name (hostname by default, editable in Settings). |
| `platform` | `win32` \| `darwin` \| `linux` |
| `ver` | Protocol version, currently `1`. Peers with a different major are listed but not paired. |
| `fp` | First 16 hex chars of SHA-256 of the node secret. Lets a user eyeball that a peer identity has not changed. |

### Choosing which address to dial

A machine advertises an A record for **every** non-internal interface it has, and
`bonjour-service` offers no way to filter that list. On a developer machine the
virtual adapters (WSL, Docker, Parallels, VM hosts) frequently sort *before* the
real NIC, so taking the first IPv4 address lands on something no other machine can
route to — which is why naive selection fails across a real LAN even though
discovery itself succeeds.

Addresses are therefore ranked before use:

1. an address on one of *our own* subnets (compared with our netmask) — the route
   that demonstrably exists
2. any other private address
3. a public address
4. routable IPv6

IPv4 link-local (`169.254.0.0/16`, i.e. DHCP failed) and IPv6 link-local (`fe80::`,
needs a scope id) are discarded. The `.local` hostname from the SRV record is kept
as a last resort.

The prober then **tries each candidate in order** until one answers, so a wrong
guess costs a round trip rather than the connection. The address that answered is
remembered on the peer and, for paired peers, persisted in the trust store.

## Authentication

Bearer tokens, established once per peer pair.

1. Requester calls `GET /api/hello` — unauthenticated, returns node identity.
2. Requester calls `POST /api/pair` with the 6-digit PIN currently displayed on the
   **target's** Discovery screen. The PIN is 6 digits from `crypto.randomInt`, rotates
   every 5 minutes and after every successful pair.
3. On a PIN match the target mints a 32-byte token, stores it under the requester's
   node id, and returns it. The requester saves it in its own trust store.
4. All later requests send `Authorization: Bearer <token>`.
5. Three wrong PINs inside 60 s locks pairing on that node for 5 minutes
   (`429 pair_locked`).

Tokens are symmetric in effect but not shared: A holding a token for B lets A browse B.
For B to browse A, B pairs with A. The UI does both legs in one **Connect & Pair**
action — after a successful pair it calls `POST /api/pair/reciprocate` so the peer
pairs back using a PIN we hand it inline.

Pairing is once per pair of machines. Tokens and the last working endpoint are both
persisted, so on the next launch a known machine is probed straight away and
reconnects without a PIN — independently of mDNS, so it also works where multicast
is blocked. Failed probes back off (2s, 4s, 8s, then every 15s), and a peer that is
merely booting reads as "Reconnecting…" rather than an error.

### Threat model, stated plainly

v1 is **plaintext HTTP on a trusted LAN**. A device on the same network that already
holds a token can read every path the app can read. There is no TLS, so a passive
observer on the same segment can read transferred file bytes and tokens. This is
acceptable for a home/studio LAN and is exactly what SMB without encryption gives you,
but it is not suitable for untrusted networks (cafés, hotels, conference Wi-Fi).
Phase 5 adds TLS with per-node self-signed certs pinned at pairing time via the `fp`
TXT record. Until then Settings shows a plain warning when the active interface is not
a private RFC1918 range.

## Endpoints

All JSON bodies are UTF-8. Errors are
`{ "error": { "code": "...", "message": "..." } }` with a matching HTTP status.

### `GET /api/hello` — no auth

```json
{ "id": "uuid", "name": "WIN-STUDIO-RIG", "platform": "win32", "ver": 1,
  "fp": "9f2c...", "paired": true }
```

`paired` reflects whether *the caller's* bearer token (if any) is recognised.

### `POST /api/pair` — no auth

```json
// request
{ "id": "uuid", "name": "Viach-MBP", "platform": "darwin", "pin": "489102" }
// response 200
{ "token": "hex64", "id": "uuid", "name": "WIN-STUDIO-RIG", "platform": "win32" }
```

`401 bad_pin`, `429 pair_locked`.

### `GET /api/volumes`

```json
[ { "path": "C:\\", "label": "System NVMe", "fs": "NTFS",
    "totalBytes": 500107862016, "freeBytes": 132445798400, "kind": "fixed" } ]
```

`kind`: `fixed` | `removable` | `network` | `home`. macOS reports `/` plus everything
under `/Volumes`; Windows enumerates drive letters.

### `GET /api/list?path=<urlencoded>`

```json
[ { "name": "4K_B-Roll_Footage", "path": "/Users/a/p/4K_B-Roll_Footage",
    "isDir": true, "size": 0, "mtimeMs": 1731628800000,
    "ext": "", "mode": "drwxr-xr-x", "hidden": false, "symlink": false } ]
```

Directory sizes are `0` — the app never recursively sizes a folder for a listing.
`404 not_found`, `403 denied`, `400 bad_path`.

### `GET /api/stat?path=` — single `DirEntry`.

### `GET /api/file?path=`

Streams bytes. Honours `Range: bytes=N-` for resume. Responds
`Content-Length`, `Accept-Ranges: bytes`, and `X-Omni-Mtime`.

### `PUT /api/file?path=`

Body is the raw byte stream. Headers:

| Header | Purpose |
|---|---|
| `Content-Length` | Expected size; a short body fails the transfer. |
| `X-Omni-Mtime` | Source mtime in ms, applied to the written file. |
| `X-Omni-Sha256` | Optional source digest. When present the server verifies and returns `422 hash_mismatch` on disagreement. |

Writes go to `<name>.omnipart` in the target directory and are renamed on success, so
a killed transfer never leaves a truncated file at the real path. Response:
`{ "bytes": 19327352832, "sha256": "..." }`.

### `POST /api/mkdir` `{ "path": "..." }` — recursive, idempotent.

### `POST /api/delete` `{ "paths": ["..."], "recursive": true }`

Refuses a volume root outright (`400 refuse_root`).

### `POST /api/rename` `{ "from": "...", "to": "..." }` — also used for same-node move.

### `POST /api/pair/reciprocate` — auth

`{ "pin": "123456" }` — asks the peer to pair back to us using this PIN, which we are
displaying. Lets one click establish trust in both directions.

## Path rules

Paths are always **native to the node that owns them**: `D:\PostProduction\clip.mov`
on Windows, `/Users/alex/clip.mov` on macOS. The server rejects a path whose shape
does not match its own platform (`400 bad_path`) rather than guessing.

Cross-platform copies sanitise the *leaf name* only, per Settings:

- Windows-illegal characters `\ / : * ? " < > |` -> `_` when the target is `win32`
- Trailing dots/spaces stripped for `win32` targets
- `.DS_Store`, `._*` AppleDouble files skipped when the target is `win32`
- `desktop.ini`, `Thumbs.db` skipped when the target is `darwin`
- Unicode: macOS stores NFD, Windows NFC. Names are normalised to the target's form,
  which is why a round-tripped filename with an accent stays byte-identical.

Sanitising can make two distinct source names collide (`a?b` and `a*b` both become
`a_b`). The engine detects this during the walk and fails the *second* one with
`name_collision` rather than silently overwriting.
