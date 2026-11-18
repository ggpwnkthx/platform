import clsx from 'clsx'
import { useSession } from '../session.tsx'
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon } from './icons.tsx'

export function Toasts() {
  const { toasts, dismiss } = useSession()
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = { success: SuccessIcon, error: ErrorIcon, info: InfoIcon }[toast.tone]
        return (
          <div
            key={toast.id}
            class={clsx('toast', `toast-${toast.tone}`)}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon size={18} aria-hidden="true" />
            <div>
              <p class="toast-title">{toast.title}</p>
              {toast.detail && <p class="toast-detail">{toast.detail}</p>}
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
