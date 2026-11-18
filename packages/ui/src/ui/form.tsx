import clsx from 'clsx'
import type { ComponentChildren, JSX } from 'preact'
import { useId } from 'preact/hooks'
import { CheckIcon, ChevronDownIcon } from './icons.tsx'

export function Field({
  label,
  hint,
  error,
  required,
  children,
  wide,
  id,
  aside,
}: {
  label: ComponentChildren
  hint?: ComponentChildren
  error?: string | null
  required?: boolean
  wide?: boolean
  id?: string
  aside?: ComponentChildren
  children: ComponentChildren
}) {
  return (
    <div class={clsx('field', wide && 'field-wide', error && 'has-error')}>
      <div class="field-head">
        <label class="field-label" for={id}>
          {label}
          {required && (
            <span class="required">
              <span aria-hidden="true">*</span>
              <span class="sr-only">required</span>
            </span>
          )}
        </label>
        {aside}
      </div>
      {children}
      {error ? <p class="field-error">{error}</p> : hint ? <p class="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Input({
  mono,
  class: extra,
  ...props
}: JSX.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input class={clsx('input', mono && 'mono', extra as string)} {...props} />
}

export function TextArea({
  mono,
  class: extra,
  ...props
}: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return <textarea class={clsx('input', 'textarea', mono && 'mono', extra as string)} {...props} />
}

export function Select({
  class: extra,
  children,
  ...props
}: JSX.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span class={clsx('select', extra as string)}>
      <select {...props}>{children}</select>
      <ChevronDownIcon size={16} aria-hidden="true" />
    </span>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ComponentChildren
  disabled?: boolean
  hint?: ComponentChildren
}) {
  const id = useId()
  return (
    <div class={clsx('checkbox', disabled && 'is-disabled')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span class="checkbox-box" aria-hidden="true">
        <CheckIcon size={13} strokeWidth={3} />
      </span>
      <label for={id}>
        {label}
        {hint && <small>{hint}</small>}
      </label>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      class={clsx('toggle', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
      <span>{label}</span>
    </button>
  )
}
