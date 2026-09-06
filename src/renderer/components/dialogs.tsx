import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatBytes, formatMtime } from '@shared/format'
import type { ConflictPrompt } from '@shared/types'
import { Button, TextInput } from './controls'
import { Icon } from './primitives'

/**
 * Level-3 surface: blurred acrylic, 8px radius, deep shadow. Escape always
 * cancels, and Enter confirms wherever a primary action exists.
 */
export function Modal({
  title,
  icon,
  children,
  onClose,
  footer,
  width = 480
}: {
  title: string
  icon: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: number
}): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    // Capture phase so the global commander key handler never sees it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-surface-container/95 backdrop-blur-md border border-outline/60 rounded-lg shadow-[0_16px_36px_-8px_rgba(0,0,0,0.85)] flex flex-col max-h-[80vh]"
        style={{ width: `${width}px` }}
      >
        <header className="flex items-center gap-space-sm px-space-lg h-header-height border-b border-outline-variant/40">
          <Icon name={icon} size={16} className="text-primary" />
          <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
        </header>
        <div className="px-space-lg py-space-lg overflow-y-auto omni-scroll">{children}</div>
        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-space-sm px-space-lg py-space-base border-t border-outline-variant/40">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function PromptDialog({
  title,
  icon,
  label,
  initialValue,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string
  icon: string
  label: string
  initialValue: string
  confirmLabel: string
  onConfirm: (value: string) => void
  onClose: () => void
}): ReactNode {
  const [value, setValue] = useState(initialValue)
  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed === '') return
    onConfirm(trimmed)
  }

  return (
    <Modal
      title={title}
      icon={icon}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={submit} disabled={value.trim() === ''}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <label className="block font-body-md text-body-md text-on-surface-variant mb-space-sm">
        {label}
      </label>
      <TextInput value={value} onChange={setValue} onSubmit={submit} />
    </Modal>
  )
}

export function ConfirmDialog({
  title,
  icon = 'warning',
  message,
  detail,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose
}: {
  title: string
  icon?: string
  message: string
  detail?: ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactNode {
  return (
    <Modal
      title={title}
      icon={icon}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'accent'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="font-body-lg text-body-lg text-on-surface">{message}</p>
      {detail !== undefined && <div className="mt-space-base">{detail}</div>}
    </Modal>
  )
}

/** Shown when a target file already exists and the policy is "ask". */
export function ConflictDialog({
  prompt,
  onResolve
}: {
  prompt: ConflictPrompt
  onResolve: (resolution: 'overwrite' | 'skip' | 'keep-both' | 'cancel-batch') => void
}): ReactNode {
  const newer = prompt.source.mtimeMs > prompt.target.mtimeMs
  return (
    <Modal
      title="File already exists on the target"
      icon="file_copy"
      width={560}
      onClose={() => onResolve('skip')}
      footer={
        <>
          <Button variant="danger" onClick={() => onResolve('cancel-batch')}>
            Cancel batch
          </Button>
          <span className="flex-1" />
          <Button onClick={() => onResolve('skip')}>Skip</Button>
          <Button onClick={() => onResolve('keep-both')}>Keep both</Button>
          <Button variant="accent" onClick={() => onResolve('overwrite')}>
            Overwrite
          </Button>
        </>
      }
    >
      <p className="font-data-tabular-md text-data-tabular-md text-on-surface-variant break-all mb-space-lg">
        {prompt.targetPath}
      </p>
      <div className="grid grid-cols-2 gap-space-base">
        <FileFacts
          label="Source"
          tone={newer ? 'text-secondary' : 'text-on-surface'}
          size={prompt.source.size}
          mtimeMs={prompt.source.mtimeMs}
          badge={newer ? 'newer' : undefined}
        />
        <FileFacts
          label="Already on target"
          tone={newer ? 'text-on-surface' : 'text-secondary'}
          size={prompt.target.size}
          mtimeMs={prompt.target.mtimeMs}
          badge={newer ? undefined : 'newer'}
        />
      </div>
    </Modal>
  )
}

function FileFacts({
  label,
  tone,
  size,
  mtimeMs,
  badge
}: {
  label: string
  tone: string
  size: number
  mtimeMs: number
  badge?: string
}): ReactNode {
  return (
    <div className="omni-inset rounded p-space-base">
      <div className="flex items-center justify-between mb-space-sm">
        <span className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {badge !== undefined && (
          <span className="font-data-tabular-sm text-data-tabular-sm text-secondary">{badge}</span>
        )}
      </div>
      <p className={`font-data-tabular-lg text-data-tabular-lg ${tone}`}>{formatBytes(size)}</p>
      <p className="font-data-tabular-md text-data-tabular-md text-on-surface-variant mt-space-2xs">
        {formatMtime(mtimeMs)}
      </p>
    </div>
  )
}

/** PIN entry for pairing with a discovered peer. */
export function PairDialog({
  peerName,
  fingerprint,
  onConfirm,
  onClose,
  busy
}: {
  peerName: string
  fingerprint: string
  onConfirm: (pin: string) => void
  onClose: () => void
  busy: boolean
}): ReactNode {
  const [pin, setPin] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const digits = pin.replace(/\D/g, '')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <Modal
      title={`Pair with ${peerName}`}
      icon="key"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="accent"
            disabled={digits.length !== 6 || busy}
            onClick={() => onConfirm(digits)}
          >
            {busy ? 'Pairing…' : 'Pair'}
          </Button>
        </>
      }
    >
      <p className="font-body-lg text-body-lg text-on-surface-variant mb-space-lg">
        Open OmniCommander on <span className="text-on-surface">{peerName}</span>, go to Network
        Discovery, and type the 6-digit code it shows.
      </p>
      <input
        ref={inputRef}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 7))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && digits.length === 6) onConfirm(digits)
        }}
        inputMode="numeric"
        placeholder="000000"
        className="w-full omni-inset border border-outline-variant/50 rounded px-space-base h-10 font-data-tabular-lg text-[20px] tracking-[0.4em] text-center text-on-surface placeholder:text-outline focus:border-primary-container focus:outline-none select-text"
      />
      {fingerprint !== '' && (
        <p className="font-data-tabular-sm text-data-tabular-sm text-outline mt-space-base">
          Peer identity fingerprint: {fingerprint}
        </p>
      )}
    </Modal>
  )
}
