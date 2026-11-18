import clsx from 'clsx'
import type { ComponentChildren, JSX } from 'preact'
import { SpinnerIcon } from './icons.tsx'

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon'> {
  tone?: Tone
  icon?: ComponentChildren
  busy?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function Button({
  tone = 'secondary',
  icon,
  busy,
  small,
  type = 'button',
  class: extra,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={clsx(
        'button',
        `button-${tone}`,
        small && 'button-small',
        busy && 'is-busy',
        extra as string
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <SpinnerIcon class="spin" size={16} aria-hidden="true" /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
}

/** The round action in a page header: the main thing the page does. */
export function Action({
  tone = 'primary',
  label,
  icon,
  busy,
  disabled,
  href,
  onClick,
}: {
  tone?: Tone
  label: string
  icon: ComponentChildren
  busy?: boolean
  disabled?: boolean
  href?: string
  onClick?: () => void
}) {
  const body = busy ? <SpinnerIcon class="spin" size={20} aria-hidden="true" /> : icon
  if (href && !disabled)
    return (
      <a class={clsx('action', `action-${tone}`)} href={href} aria-label={label} title={label}>
        {body}
      </a>
    )
  return (
    <button
      type="button"
      class={clsx('action', `action-${tone}`)}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {body}
    </button>
  )
}
