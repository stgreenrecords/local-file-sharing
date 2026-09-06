import type { ChangeEvent, ReactNode } from 'react'
import { Icon } from './primitives'

export function Button({
  children,
  onClick,
  icon,
  variant = 'ghost',
  disabled = false,
  title,
  className = ''
}: {
  children?: ReactNode
  onClick?: () => void
  icon?: string
  variant?: 'ghost' | 'filled' | 'accent' | 'danger'
  disabled?: boolean
  title?: string
  className?: string
}): ReactNode {
  const variants = {
    ghost:
      'bg-surface-container border border-outline-variant/40 text-on-surface hover:bg-surface-container-high',
    filled: 'bg-surface-container-high border border-outline-variant/60 text-on-surface hover:bg-surface-bright',
    accent: 'bg-primary-container/90 border border-primary-container text-on-primary-container hover:bg-primary-container font-medium',
    danger: 'bg-error-container/25 border border-error/40 text-error hover:bg-error-container/40'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-space-xs px-space-base h-7 rounded font-body-md text-body-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {icon !== undefined && <Icon name={icon} size={15} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  onClick,
  title,
  active = false,
  size = 14,
  disabled = false
}: {
  icon: string
  onClick?: () => void
  title: string
  active?: boolean
  size?: number
  disabled?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`w-5 h-5 flex items-center justify-center rounded transition-colors disabled:opacity-30 ${
        active
          ? 'bg-surface-container-high text-primary'
          : 'text-on-surface-variant hover:bg-surface-bright hover:text-on-surface'
      }`}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  detail
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  detail?: ReactNode
}): ReactNode {
  return (
    <label className="flex items-start gap-space-sm cursor-pointer group">
      <span
        onClick={(e) => {
          e.preventDefault()
          onChange(!checked)
        }}
        className={`mt-space-2xs w-[14px] h-[14px] rounded-sm shrink-0 flex items-center justify-center transition-colors ${
          checked
            ? 'bg-primary-container'
            : 'border border-outline group-hover:border-on-surface-variant'
        }`}
      >
        {checked && <Icon name="check" size={12} className="text-surface-container-lowest" />}
      </span>
      <span className="min-w-0">
        <span className="block font-body-lg text-body-lg text-on-surface">{label}</span>
        {detail !== undefined && (
          <span className="block font-body-md text-body-md text-on-surface-variant mt-space-2xs">
            {detail}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function Radio({
  checked,
  onChange,
  label,
  aside,
  detail,
  footer
}: {
  checked: boolean
  onChange: () => void
  label: string
  aside?: ReactNode
  detail?: string
  footer?: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`text-left w-full rounded border p-space-base transition-colors ${
        checked
          ? 'border-primary-container/60 bg-primary-container/10'
          : 'border-outline-variant/40 bg-surface-container-low hover:border-outline-variant'
      }`}
    >
      <span className="flex items-center justify-between gap-space-sm">
        <span className="flex items-center gap-space-sm min-w-0">
          <span
            className={`w-[14px] h-[14px] rounded-full border-2 shrink-0 flex items-center justify-center ${
              checked ? 'border-primary-container' : 'border-outline'
            }`}
          >
            {checked && <span className="w-1.5 h-1.5 rounded-full bg-primary-container" />}
          </span>
          <span
            className={`font-headline-md text-headline-md truncate ${
              checked ? 'text-primary' : 'text-on-surface'
            }`}
          >
            {label}
          </span>
        </span>
        {aside}
      </span>
      {detail !== undefined && (
        <span className="block font-body-md text-body-md text-on-surface-variant mt-space-sm">
          {detail}
        </span>
      )}
      {footer !== undefined && <span className="block mt-space-sm">{footer}</span>}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`w-10 h-[22px] rounded-full p-space-2xs transition-colors shrink-0 ${
        checked ? 'bg-secondary-container' : 'bg-surface-container-highest'
      }`}
    >
      <span
        className={`block w-[16px] h-[16px] rounded-full bg-surface-container-lowest transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className = ''
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}): ReactNode {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const match = options.find((o) => String(o.value) === raw)
          if (match !== undefined) onChange(match.value)
        }}
        className="w-full appearance-none bg-surface-container-lowest border border-outline-variant/50 rounded pl-space-base pr-space-xl h-7 font-data-tabular-md text-data-tabular-md text-on-surface focus:border-primary-container focus:outline-none"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="expand_more"
        size={14}
        className="absolute right-space-sm top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
      />
    </div>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono = true,
  icon,
  onSubmit,
  className = ''
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
  icon?: string
  onSubmit?: () => void
  className?: string
}): ReactNode {
  return (
    <div
      className={`flex items-center gap-space-sm omni-inset border border-outline-variant/50 rounded px-space-base h-7 focus-within:border-primary-container ${className}`}
    >
      {icon !== undefined && <Icon name={icon} size={14} className="text-on-surface-variant" />}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit !== undefined) onSubmit()
        }}
        className={`flex-1 min-w-0 bg-transparent border-0 outline-none text-on-surface placeholder:text-outline select-text ${
          mono
            ? 'font-data-tabular-md text-data-tabular-md'
            : 'font-body-md text-body-md'
        }`}
      />
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
}): ReactNode {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 appearance-none bg-surface-container-highest rounded-full accent-primary-container disabled:opacity-40 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-container"
    />
  )
}
