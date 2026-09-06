import type { ReactNode } from 'react'

export function Icon({
  name,
  size = 14,
  className = ''
}: {
  name: string
  size?: number
  className?: string
}): ReactNode {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: `${size}px`, width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

export type Tone = 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger' | 'neutral'

const PILL_TONE: Record<Tone, string> = {
  primary: 'text-primary bg-primary/15',
  secondary: 'text-secondary bg-secondary/15',
  tertiary: 'text-tertiary bg-tertiary/15',
  warning: 'text-warning bg-warning/15',
  danger: 'text-danger bg-danger/15',
  neutral: 'text-on-surface-variant bg-surface-container-high'
}

export function Pill({
  children,
  tone = 'neutral',
  className = ''
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}): ReactNode {
  return (
    <span
      className={`font-data-tabular-sm text-data-tabular-sm px-space-xs py-space-2xs rounded whitespace-nowrap ${PILL_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/** The circular connection LED — the one place a full radius is allowed. */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }): ReactNode {
  const color: Record<Tone, string> = {
    primary: 'bg-primary',
    secondary: 'bg-secondary',
    tertiary: 'bg-tertiary',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-outline'
  }
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${color[tone]} ${pulse ? 'animate-pulse' : ''}`}
    />
  )
}

export function KeyBadge({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="font-keybind-label text-keybind-label text-primary bg-primary/10 px-space-xs py-space-2xs rounded-sm">
      {children}
    </span>
  )
}

/** 4px telemetry gauge with the cyan-to-green fill from the design. */
export function ProgressBar({
  value,
  tone = 'gradient',
  height = 4
}: {
  value: number
  tone?: 'gradient' | 'primary' | 'secondary' | 'danger'
  height?: number
}): ReactNode {
  const fill =
    tone === 'gradient'
      ? 'bg-gradient-to-r from-primary-container to-secondary'
      : tone === 'primary'
        ? 'bg-primary-container'
        : tone === 'secondary'
          ? 'bg-secondary'
          : 'bg-danger'
  return (
    <div
      className="w-full omni-inset rounded-sm overflow-hidden"
      style={{ height: `${height}px` }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full ${fill} transition-[width] duration-150 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export function SectionCard({
  icon,
  title,
  subtitle,
  aside,
  children
}: {
  icon: string
  title: string
  subtitle?: string
  aside?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section className="bg-surface-container-low rounded-lg border border-outline-variant/30 p-space-lg">
      <header className="flex items-start justify-between gap-space-base mb-space-lg">
        <div className="flex items-start gap-space-sm min-w-0">
          <span className="w-6 h-6 rounded flex items-center justify-center bg-primary/10 text-primary shrink-0 mt-space-2xs">
            <Icon name={icon} size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="font-headline-lg text-headline-lg text-on-surface">{title}</h2>
            {subtitle !== undefined && (
              <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** A labelled metric tile, as used across the queue header. */
export function StatTile({
  label,
  value,
  unit,
  aside,
  footer,
  tone = 'primary'
}: {
  label: string
  value: string
  unit?: string
  aside?: ReactNode
  footer?: ReactNode
  tone?: Tone
}): ReactNode {
  const valueColor: Record<Tone, string> = {
    primary: 'text-primary',
    secondary: 'text-secondary',
    tertiary: 'text-tertiary',
    warning: 'text-warning',
    danger: 'text-danger',
    neutral: 'text-on-surface'
  }
  return (
    <div className="flex-1 min-w-0 bg-surface-container-low rounded-lg border border-outline-variant/30 px-space-lg py-space-base">
      <div className="flex items-center justify-between gap-space-sm mb-space-xs">
        <span className="font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {aside}
      </div>
      <div className="flex items-baseline gap-space-xs">
        <span className={`font-headline-xl text-headline-xl ${valueColor[tone]}`}>{value}</span>
        {unit !== undefined && (
          <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant">
            {unit}
          </span>
        )}
      </div>
      {footer !== undefined && (
        <div className="flex items-center justify-between gap-space-sm mt-space-sm font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
          {footer}
        </div>
      )}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  detail,
  action
}: {
  icon: string
  title: string
  detail?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-space-sm py-space-xl px-space-lg text-center">
      <Icon name={icon} size={28} className="text-outline" />
      <p className="font-headline-md text-headline-md text-on-surface-variant">{title}</p>
      {detail !== undefined && (
        <p className="font-body-md text-body-md text-outline max-w-[46ch]">{detail}</p>
      )}
      {action}
    </div>
  )
}
