/**
 * Configuration. Edits accumulate in a draft so "Save & apply" is meaningful,
 * except for toggles whose effect is immediate and obvious.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PathMapping, RowDensity, TransportProtocol } from '@shared/types'
import { formatBytes } from '@shared/format'
import { effective, hasChanges, useSettings } from '../state/useSettings'
import { useNodes } from '../state/useNodes'
import { Button, Checkbox, IconButton, Radio, Select, Slider, TextInput, Toggle } from '../components/controls'
import { Icon, Pill, SectionCard } from '../components/primitives'

type SectionId = 'general' | 'paths' | 'engine' | 'network' | 'hotkeys'

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: 'general', label: 'General & UI density', icon: 'tune' },
  { id: 'paths', label: 'Cross-platform paths', icon: 'swap_horiz' },
  { id: 'engine', label: 'Transfer engine', icon: 'bolt' },
  { id: 'network', label: 'Network & security', icon: 'vpn_key' },
  { id: 'hotkeys', label: 'Keyboard shortcuts', icon: 'keyboard' }
]

export function Settings(): ReactNode {
  const state = useSettings()
  const status = useNodes((s) => s.status)
  const [section, setSection] = useState<SectionId>('general')

  useEffect(() => {
    void state.load()
    // Loading once on mount is intentional; edits live in the draft.
  }, [])

  const dirty = hasChanges(state)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-space-lg py-space-base flex items-center justify-between gap-space-lg border-b border-outline-variant/30 bg-surface-container-lowest">
        <div className="flex items-center gap-space-sm">
          <Icon name="settings" size={18} className="text-primary" />
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Configuration &amp; engine preferences
          </h1>
        </div>
        <div className="flex items-center gap-space-base font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
          <span>
            daemon:{' '}
            <span className={status?.serverListening === true ? 'text-secondary' : 'text-danger'}>
              {status?.serverListening === true ? 'listening' : 'offline'}
            </span>
          </span>
          <span className="text-outline">|</span>
          <span>node {status?.identity.fingerprint ?? '--'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Section rail */}
        <nav className="w-[260px] shrink-0 border-r border-outline-variant/30 bg-surface-container-lowest p-space-base flex flex-col">
          <p className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-sm px-space-sm">
            Subsystem
          </p>
          {SECTIONS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`flex items-center gap-space-sm px-space-sm h-8 rounded text-left transition-colors ${
                section === item.id
                  ? 'bg-surface-container-high text-primary border-l-2 border-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface border-l-2 border-transparent'
              }`}
            >
              <Icon name={item.icon} size={15} />
              <span className="flex-1 font-body-lg text-body-lg truncate">{item.label}</span>
              <span className="font-data-tabular-sm text-data-tabular-sm text-outline">
                {String(index + 1).padStart(2, '0')}
              </span>
            </button>
          ))}

          <div className="mt-auto space-y-space-sm">
            <Button icon="restart_alt" onClick={() => void state.reset()} className="w-full">
              Restore defaults
            </Button>
            <Button icon="download" onClick={() => void state.exportConfig()} className="w-full">
              Export config
            </Button>
          </div>
        </nav>

        {/* Panels */}
        <div className="flex-1 min-w-0 overflow-y-auto omni-scroll p-space-lg space-y-space-lg">
          {section === 'general' && <GeneralPanel />}
          {section === 'paths' && <PathsPanel />}
          {section === 'engine' && <EnginePanel />}
          {section === 'network' && <NetworkPanel />}
          {section === 'hotkeys' && <HotkeysPanel />}
        </div>
      </div>

      {/* Save bar */}
      <div className="shrink-0 h-11 px-space-lg flex items-center justify-between border-t border-outline-variant/30 bg-surface-container-lowest">
        <span className="font-body-md text-body-md text-on-surface-variant">
          {dirty ? 'Unsaved changes' : 'All changes applied'}
        </span>
        <div className="flex items-center gap-space-sm">
          <Button onClick={state.discard} disabled={!dirty}>
            Discard
          </Button>
          <Button
            variant="accent"
            icon="save"
            disabled={!dirty || state.saving}
            onClick={() => void state.save()}
          >
            {state.saving ? 'Applying…' : 'Save & apply'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function GeneralPanel(): ReactNode {
  const state = useSettings()
  const displayName = effective(state, 'displayName', '')
  const density: RowDensity = effective(state, 'rowDensity', 'standard')

  return (
    <>
      <SectionCard
        icon="badge"
        title="Machine identity"
        subtitle="The name other machines see when they discover this one."
      >
        <div className="max-w-md">
          <TextInput
            value={displayName}
            onChange={(value) => state.edit({ displayName: value })}
            mono={false}
            icon="computer"
          />
          <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm">
            Changing this re-advertises the mDNS service. Existing pairings survive — trust is
            keyed on the node id, not the name.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        icon="table_rows"
        title="Listing density"
        subtitle="Row height in the file panes, which sets how many items fit on screen."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-base max-w-2xl">
          <Radio
            checked={density === 'compact'}
            label="Compact"
            detail="22px rows. Maximum items per screen."
            onChange={() => state.edit({ rowDensity: 'compact' })}
          />
          <Radio
            checked={density === 'standard'}
            label="Standard"
            detail="26px rows. Easier pointer targets."
            onChange={() => state.edit({ rowDensity: 'standard' })}
          />
        </div>

        <div className="mt-space-lg space-y-space-base max-w-2xl">
          <Checkbox
            checked={effective(state, 'showHidden', false)}
            onChange={(value) => {
              state.edit({ showHidden: value })
              void state.save()
            }}
            label="Show hidden files"
            detail="Dotfiles on macOS, plus desktop.ini and $RECYCLE.BIN on Windows. Hidden files are always copied regardless of this setting."
          />
          <Checkbox
            checked={effective(state, 'confirmDelete', true)}
            onChange={(value) => state.edit({ confirmDelete: value })}
            label="Confirm before deleting"
            detail="Deletes bypass the recycle bin and cannot be undone, so leaving this on is recommended."
          />
        </div>
      </SectionCard>
    </>
  )
}

function PathsPanel(): ReactNode {
  const state = useSettings()
  const mappings = effective(state, 'pathMappings', [])

  const update = (next: PathMapping[]): void => {
    state.edit({ pathMappings: next })
  }

  return (
    <>
      <SectionCard
        icon="swap_horiz"
        title="Filename translation"
        subtitle="Windows NTFS and macOS APFS disagree about legal filenames. These rules run on the leaf name during a copy."
        aside={<Pill tone="secondary">applied per file</Pill>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
          <Checkbox
            checked={effective(state, 'sanitizeWindowsNames', true)}
            onChange={(value) => state.edit({ sanitizeWindowsNames: value })}
            label="Sanitise names Windows cannot store"
            detail={
              <>
                Replaces <span className="font-data-tabular-md text-warning">{'\\ / : * ? " < > |'}</span>{' '}
                with underscores, strips trailing dots and spaces, and escapes reserved device
                names like CON and NUL. If two names collapse onto the same result, the second
                one fails rather than overwriting the first.
              </>
            }
          />
          <Checkbox
            checked={effective(state, 'stripMacMetadata', true)}
            onChange={(value) => state.edit({ stripMacMetadata: value })}
            label="Drop cross-platform junk files"
            detail={
              <>
                Skips <span className="font-data-tabular-md text-primary">.DS_Store</span> and{' '}
                <span className="font-data-tabular-md text-primary">._*</span> AppleDouble files
                when copying to Windows, and{' '}
                <span className="font-data-tabular-md text-primary">desktop.ini</span> /{' '}
                <span className="font-data-tabular-md text-primary">Thumbs.db</span> when copying
                to macOS.
              </>
            }
          />
          <Checkbox
            checked={effective(state, 'normalizeUnicode', true)}
            onChange={(value) => state.edit({ normalizeUnicode: value })}
            label="Normalise Unicode filenames"
            detail="macOS stores decomposed (NFD) names, Windows expects composed (NFC). Without this, an accented filename can round-trip into a different byte sequence."
          />
        </div>
      </SectionCard>

      <SectionCard
        icon="alt_route"
        title="Folder equivalences"
        subtitle="Optional: note that a Windows folder and a macOS folder are the same logical place. Used to suggest a matching target when you switch a pane between machines."
        aside={
          <Button
            icon="add"
            onClick={() =>
              update([
                ...mappings,
                { id: `map-${Date.now()}`, windows: '', posix: '' }
              ])
            }
          >
            Add rule
          </Button>
        }
      >
        {mappings.length === 0 ? (
          <p className="font-body-md text-body-md text-outline">
            No equivalences defined. Panes simply open each machine&apos;s home folder.
          </p>
        ) : (
          <div className="space-y-space-sm">
            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-space-base font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
              <span>Windows path</span>
              <span />
              <span>macOS / POSIX path</span>
              <span />
            </div>
            {mappings.map((mapping) => (
              <div key={mapping.id} className="grid grid-cols-[1fr_auto_1fr_auto] gap-space-base items-center">
                <TextInput
                  value={mapping.windows}
                  placeholder="D:\PostProduction\"
                  onChange={(value) =>
                    update(mappings.map((m) => (m.id === mapping.id ? { ...m, windows: value } : m)))
                  }
                />
                <Icon name="sync_alt" size={16} className="text-secondary" />
                <TextInput
                  value={mapping.posix}
                  placeholder="/Volumes/PostProduction/"
                  onChange={(value) =>
                    update(mappings.map((m) => (m.id === mapping.id ? { ...m, posix: value } : m)))
                  }
                />
                <IconButton
                  icon="delete"
                  title="Remove rule"
                  onClick={() => update(mappings.filter((m) => m.id !== mapping.id))}
                />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  )
}

const TRANSPORTS: Array<{
  value: TransportProtocol
  label: string
  detail: string
  aside: string
  available: boolean
}> = [
  {
    value: 'omnidirect',
    label: 'OmniDirect P2P',
    detail:
      'Streams files over a direct HTTP connection between two copies of this app. One code path on both platforms, real progress, end-to-end SHA-256 verification.',
    aside: 'Recommended',
    available: true
  },
  {
    value: 'smb',
    label: 'SMB share',
    detail:
      'Reach a NAS or a machine that does not run OmniCommander. Not implemented yet — see roadmap phase 6.',
    aside: 'Planned',
    available: false
  },
  {
    value: 'sftp',
    label: 'SFTP / SSH',
    detail:
      'Reach a Linux host over OpenSSH. Not implemented yet — see roadmap phase 6.',
    aside: 'Planned',
    available: false
  }
]

const BUFFER_OPTIONS = [
  { value: 1024 * 1024, label: '1 MB (low memory)' },
  { value: 4 * 1024 * 1024, label: '4 MB (default)' },
  { value: 16 * 1024 * 1024, label: '16 MB (fast NVMe)' },
  { value: 64 * 1024 * 1024, label: '64 MB (10GbE link)' }
]

function EnginePanel(): ReactNode {
  const state = useSettings()
  const transport = effective(state, 'transport', 'omnidirect')
  const workers = effective(state, 'streamWorkers', 1)
  const buffer = effective(state, 'bufferWindowBytes', 4 * 1024 * 1024)

  return (
    <>
      <SectionCard
        icon="bolt"
        title="Transport"
        subtitle="How bytes get from one machine to the other."
      >
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-space-base">
          {TRANSPORTS.map((option) => (
            <Radio
              key={option.value}
              checked={transport === option.value}
              label={option.label}
              detail={option.detail}
              aside={
                <span
                  className={`font-data-tabular-sm text-data-tabular-sm ${
                    option.available ? 'text-secondary' : 'text-outline'
                  }`}
                >
                  {option.aside}
                </span>
              }
              onChange={() => {
                if (option.available) state.edit({ transport: option.value })
              }}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        icon="speed"
        title="Streaming"
        subtitle="Buffer sizing, parallelism and verification."
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="font-headline-md text-headline-md text-on-surface">
                Parallel files
              </span>
              <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant">
                {workers} {workers === 1 ? 'file' : 'files'}
              </span>
            </div>
            <Slider
              value={workers}
              min={1}
              max={8}
              onChange={(value) => state.edit({ streamWorkers: value })}
              disabled
            />
            <p className="font-body-md text-body-md text-warning mt-space-sm">
              Locked to 1 in this build. The engine transfers serially; parallel workers are
              roadmap phase 4.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <span className="font-headline-md text-headline-md text-on-surface">
                Buffer window
              </span>
              <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant">
                {formatBytes(buffer)}
              </span>
            </div>
            <Select
              value={buffer}
              options={BUFFER_OPTIONS}
              onChange={(value) => state.edit({ bufferWindowBytes: value })}
            />
            <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm">
              In-flight bytes held between the read and the write stream. Bigger windows help on
              fast links and hurt on constrained machines.
            </p>
          </div>

          <div>
            <span className="block font-headline-md text-headline-md text-on-surface mb-space-sm">
              Verification
            </span>
            <Checkbox
              checked={effective(state, 'verifyChecksums', true)}
              onChange={(value) => state.edit({ verifyChecksums: value })}
              label="Verify every file with SHA-256"
              detail="Hashes the stream in flight on both sides and compares before the target file is renamed into place. A mismatch discards the copy instead of leaving a corrupt file."
            />
          </div>
        </div>
      </SectionCard>
    </>
  )
}

function NetworkPanel(): ReactNode {
  const state = useSettings()
  const status = useNodes((s) => s.status)
  const port = effective(state, 'port', 47654)

  return (
    <>
      <SectionCard
        icon="lan"
        title="Discovery & listening"
        subtitle="The beacon that lets other machines find this one, and the port they connect to."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg max-w-3xl">
          <div className="flex items-start justify-between gap-space-base">
            <div className="min-w-0">
              <p className="font-headline-md text-headline-md text-on-surface">
                Advertise over mDNS
              </p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
                Publishes <span className="font-data-tabular-md">_omnidirect._tcp</span> on UDP
                5353. With this off, other machines can still reach this one by direct IP.
              </p>
            </div>
            <Toggle
              checked={effective(state, 'discoveryEnabled', true)}
              label="Advertise over mDNS"
              onChange={(value) => state.edit({ discoveryEnabled: value })}
            />
          </div>

          <div className="flex items-start justify-between gap-space-base">
            <div className="min-w-0">
              <p className="font-headline-md text-headline-md text-on-surface">
                Reconnect to paired machines
              </p>
              <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
                Pairing is remembered, along with the address that last answered, so a
                known machine comes back on its own at startup without asking for a code
                again. Turn this off to list known machines but connect only on demand.
              </p>
            </div>
            <Toggle
              checked={effective(state, 'autoPairKnownPeers', true)}
              label="Reconnect to paired machines"
              onChange={(value) => state.edit({ autoPairKnownPeers: value })}
            />
          </div>

          <div>
            <p className="font-headline-md text-headline-md text-on-surface mb-space-sm">
              Listening port
            </p>
            <TextInput
              value={String(port)}
              onChange={(value) => {
                const parsed = Number(value.replace(/\D/g, ''))
                state.edit({ port: Number.isFinite(parsed) ? parsed : 47654 })
              }}
              icon="settings_ethernet"
            />
            <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm">
              Currently bound to{' '}
              <span className="text-on-surface">{status?.serverPort ?? '--'}</span>. A port change
              takes effect on the next launch. If the port is busy the daemon walks upward and
              advertises whatever it actually bound.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon="security"
        title="Transport security"
        subtitle="What this build does and does not protect."
        aside={
          <Pill tone={status?.privateNetwork === true ? 'secondary' : 'warning'}>
            {status?.privateNetwork === true ? 'private network' : 'check your network'}
          </Pill>
        }
      >
        <div className="space-y-space-base max-w-3xl">
          <Row
            icon="key"
            tone="secondary"
            title="PIN pairing with bearer tokens"
            detail="A peer must type the 6-digit code shown on this machine before it gets a token. Three wrong codes lock pairing for five minutes. Tokens persist until you unpair."
          />
          <Row
            icon="lock_open"
            tone="warning"
            title="Traffic is not encrypted"
            detail="Transfers are plaintext HTTP on the LAN, so anything on the same segment can read file bytes and tokens. Fine for a home or studio network you control; not for public Wi-Fi. TLS with pinned per-node certificates is roadmap phase 5."
          />
          <Row
            icon="folder_open"
            tone="warning"
            title="A paired peer can read anything you can"
            detail="There is no per-path allowlist yet. Pair only with machines you own or trust, and unpair when you are done."
          />
          <Row
            icon="fingerprint"
            tone="primary"
            title={`This machine's fingerprint: ${status?.identity.fingerprint ?? '--'}`}
            detail="Shown on a peer's card before pairing. If it ever changes unexpectedly, the identity file on that machine was replaced."
          />
        </div>
      </SectionCard>
    </>
  )
}

function Row({
  icon,
  tone,
  title,
  detail
}: {
  icon: string
  tone: 'primary' | 'secondary' | 'warning'
  title: string
  detail: string
}): ReactNode {
  const toneClass = {
    primary: 'text-primary',
    secondary: 'text-secondary',
    warning: 'text-warning'
  }[tone]
  return (
    <div className="flex items-start gap-space-base omni-inset rounded px-space-base py-space-base">
      <Icon name={icon} size={17} className={`${toneClass} shrink-0 mt-space-2xs`} />
      <div className="min-w-0">
        <p className="font-headline-md text-headline-md text-on-surface">{title}</p>
        <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">{detail}</p>
      </div>
    </div>
  )
}

const HOTKEYS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'Tab', label: 'Switch pane focus', icon: 'swap_horiz' },
  { key: 'Space', label: 'Tag item and step down', icon: 'check_box' },
  { key: 'Shift+↑↓', label: 'Extend selection', icon: 'select_all' },
  { key: 'Enter', label: 'Open folder or file', icon: 'subdirectory_arrow_left' },
  { key: 'Backspace', label: 'Go to parent folder', icon: 'drive_folder_upload' },
  { key: 'F3', label: 'Quick look (local files)', icon: 'visibility' },
  { key: 'F4', label: 'Open in external editor', icon: 'edit' },
  { key: 'F5', label: 'Copy to the other pane', icon: 'content_copy' },
  { key: 'F6', label: 'Move to the other pane', icon: 'drive_file_move' },
  { key: 'Shift+F6', label: 'Rename in place', icon: 'text_fields' },
  { key: 'F7', label: 'Create folder', icon: 'create_new_folder' },
  { key: 'F8 / Del', label: 'Delete permanently', icon: 'delete' },
  { key: 'F9', label: 'Action menu', icon: 'menu' },
  { key: 'F10', label: 'Quit', icon: 'power_settings_new' },
  { key: 'Ctrl+A', label: 'Select all', icon: 'done_all' },
  { key: 'Ctrl+*', label: 'Invert selection', icon: 'flip' },
  { key: 'Ctrl+R', label: 'Refresh listing', icon: 'refresh' },
  { key: 'Ctrl+H', label: 'Toggle hidden files', icon: 'visibility_off' },
  { key: 'Ctrl+T', label: 'New tab', icon: 'add' },
  { key: 'Ctrl+W', label: 'Close tab', icon: 'close' }
]

function HotkeysPanel(): ReactNode {
  return (
    <SectionCard
      icon="keyboard"
      title="Keyboard shortcuts"
      subtitle="Total Commander conventions. These are fixed in this build; remapping is not implemented yet."
      aside={<Pill tone="neutral">TC classic</Pill>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-2xs">
        {HOTKEYS.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center gap-space-base omni-inset rounded px-space-base py-space-sm"
          >
            <span className="font-keybind-label text-keybind-label text-primary bg-primary/10 px-space-xs py-space-2xs rounded-sm min-w-[74px] text-center shrink-0">
              {entry.key}
            </span>
            <span className="flex-1 font-body-lg text-body-lg text-on-surface truncate">
              {entry.label}
            </span>
            <Icon name={entry.icon} size={15} className="text-on-surface-variant shrink-0" />
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
