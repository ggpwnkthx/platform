/**
 * An identifier, and the button that copies it.
 */

import { useState } from 'hono/jsx'

export default function CopyText(props: { text: string; short?: boolean }) {
  const [copied, setCopied] = useState(false)
  const shown = props.short && props.text.length > 13 ? `${props.text.slice(0, 8)}…` : props.text
  return (
    <span class="row" style="gap: 0.3rem; display: inline-flex">
      <code title={props.text}>{shown}</code>
      <button
        type="button"
        class="link-button small"
        aria-label={`Copy ${props.text}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}
