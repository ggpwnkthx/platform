import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { Button } from './button.tsx'
import { CloseIcon } from './icons.tsx'

/**
 * The native dialog element, opened and closed as it should be: shown as a modal when it is
 * to be open, closed when it is not.
 */
function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return ref
}

/**
 * A drawer from the right, on the native dialog element: it traps focus, closes on Escape
 * and returns focus where it came from, as the platform does.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ComponentChildren
  subtitle?: ComponentChildren
  children: ComponentChildren
  footer?: ComponentChildren
  wide?: boolean
}) {
  const ref = useDialog(open)
  // A click on the backdrop closes it; the keyboard closes it with Escape, through onCancel.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it, through the dialog's cancel event
    <dialog
      ref={ref}
      class={clsx('drawer', wide && 'drawer-wide')}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div class="drawer-panel">
          <header class="drawer-head">
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </header>
          <div class="drawer-body">{children}</div>
          {footer && <footer class="drawer-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

export function Confirm({
  open,
  title,
  children,
  confirm,
  tone = 'danger',
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ComponentChildren
  confirm: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useDialog(open)
  return (
    <dialog
      ref={ref}
      class="confirm"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      {open && (
        <div class="confirm-panel">
          <h2>{title}</h2>
          <div class="confirm-body">{children}</div>
          <div class="confirm-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button tone={tone} busy={busy} onClick={onConfirm}>
              {confirm}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}

/** A small menu under a button. Closes on Escape, on a choice and on a click elsewhere. */
export function Menu({
  open,
  onClose,
  children,
  align = 'end',
}: {
  open: boolean
  onClose: () => void
  children: ComponentChildren
  align?: 'start' | 'end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => {
      if (ref.current && !ref.current.parentElement?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    ref.current?.querySelector<HTMLElement>('button, a, input, select')?.focus()
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  if (!open) return null
  return (
    <div ref={ref} class={clsx('menu', `menu-${align}`)}>
      {children}
    </div>
  )
}
