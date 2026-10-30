/**
 * The pieces that say why something is not allowed.
 *
 * A control the reader can see and not use is drawn disabled, with its
 * reason: on hover, and on focus for a reader on the keyboard, and in
 * the description a screen reader reads. A control the reader should
 * not know about is not drawn at all; that choice is the page's.
 */

import type { Child } from 'hono/jsx'

/** What the reader can do about a refusal. */
export const ASK_AN_OPERATOR =
  'An operator of your tenant can grant a right that allows it; Data decides what each right allows.'

/** An action the reader may not take: a disabled button, and why. */
export function DisabledAction(props: {
  id: string
  label: Child
  reason: string
  small?: boolean
  tone?: 'danger' | 'quiet' | 'primary'
}) {
  const tip = `${props.id}-why`
  const tone = props.tone === 'primary' ? '' : (props.tone ?? 'quiet')
  return (
    <span class="why">
      <button
        type="button"
        class={`button ${tone} ${props.small ? 'small' : ''} is-disabled`
          .replace(/\s+/g, ' ')
          .trim()}
        aria-disabled="true"
        aria-describedby={tip}
      >
        {props.label}
      </button>
      <span class="why-tip" role="tooltip" id={tip}>
        {props.reason} {ASK_AN_OPERATOR}
      </span>
    </span>
  )
}

/** A value the reader may read and not change, in the place of its control. */
export function ReadOnlyField(props: { label: string; value: Child; reason: string }) {
  return (
    <div class="field readonly">
      <span>{props.label}</span>
      <div class="readonly-value">{props.value}</div>
      <span class="hint">Read-only for you. {props.reason}</span>
    </div>
  )
}

/** A note that a page shows less than there is, and where to read why. */
export function LessShown(props: { children: Child; href?: string }) {
  return (
    <p class="small muted less-shown">
      {props.children}
      {props.href ? (
        <>
          {' '}
          <a href={props.href}>See your access</a>.
        </>
      ) : null}
    </p>
  )
}
