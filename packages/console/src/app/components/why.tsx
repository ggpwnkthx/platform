/**
 * The pieces that draw what the reader may do, and say why something is
 * not allowed.
 *
 * A control the reader can see and not use is drawn disabled, with its
 * reason: on hover, and on focus for a reader on the keyboard, and in
 * the description a screen reader reads. A control the reader should
 * not know about is not drawn at all; that choice is the page's.
 *
 * The pieces ask the ability of the caller, and the reason they show is
 * the one of the rule that decides: a page never writes a refusal of
 * its own.
 */

import type { Child } from 'hono/jsx'
import {
  type AbilitySubject,
  type Capability,
  type ConsoleAbility,
  reasonOf,
} from '../../domains/ability'

/** What the reader can do about a refusal. */
export const ASK_AN_OPERATOR =
  'An operator of your tenant can grant a right that allows it; Data decides what each right allows.'

/** The mark of something that is closed to the reader. */
export function Lock() {
  return (
    <svg
      class="lock"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

/**
 * Draws its children when the ability allows the action, and the
 * refusal otherwise.
 *
 * The refusal is drawn by `otherwise`, which is handed the reason of
 * the rule that decides. A page that names no `otherwise` draws nothing:
 * it is the page that chose not to show the control at all.
 */
export function Can(props: {
  ability: ConsoleAbility
  /** The action, as the rule names it. */
  I: string
  /** What the action is about: a kind of thing, or one thing with its facts. */
  a: AbilitySubject
  field?: string
  children: Child
  otherwise?: (reason: string) => Child
}) {
  const reason = reasonOf(props.ability, props.I, props.a, props.field)
  if (reason === null) return <>{props.children}</>
  return <>{props.otherwise ? props.otherwise(reason) : null}</>
}

/** An action the reader may not take: a disabled button, and why. */
export function DisabledAction(props: {
  id: string
  label: Child
  reason: string
  small?: boolean
  tone?: 'danger' | 'quiet' | 'primary'
  /**
   * What the reader can do about it, after the reason. The default is
   * the one of the data of a workspace; a reason that already says it
   * names none.
   */
  ask?: string | false
  /** The side the reason opens on: the end of the control, or its start. */
  align?: 'end' | 'start'
}) {
  const tip = `${props.id}-why`
  const tone = props.tone === 'primary' ? '' : (props.tone ?? 'quiet')
  const ask = props.ask === false ? '' : (props.ask ?? ASK_AN_OPERATOR)
  return (
    <span class={`why ${props.align === 'start' ? 'start' : ''}`.trim()}>
      <button
        type="button"
        class={`button ${tone} ${props.small ? 'small' : ''} is-disabled`
          .replace(/\s+/g, ' ')
          .trim()}
        aria-disabled="true"
        aria-describedby={tip}
      >
        <Lock />
        {props.label}
      </button>
      <span class="why-tip" role="tooltip" id={tip}>
        {`${props.reason} ${ask}`.trim()}
      </span>
    </span>
  )
}

/**
 * A link the reader follows when the ability allows the action, and
 * the same control disabled, with its reason, when it does not.
 */
export function ActionLink(props: {
  ability: ConsoleAbility
  I: string
  a: AbilitySubject
  /** Names the reason of the refusal for the readers of the screen. */
  id: string
  href: string
  label: string
  tone?: 'quiet' | 'primary'
  small?: boolean
  ask?: string | false
  align?: 'end' | 'start'
}) {
  const tone = props.tone === 'quiet' ? 'quiet' : ''
  return (
    <Can
      ability={props.ability}
      I={props.I}
      a={props.a}
      otherwise={(reason) => (
        <DisabledAction
          id={props.id}
          label={props.label}
          reason={reason}
          small={props.small}
          ask={props.ask}
          align={props.align}
        />
      )}
    >
      <a class={`button ${tone} ${props.small ? 'small' : ''}`.trim()} href={props.href}>
        {props.label}
      </a>
    </Can>
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

/**
 * A list of what somebody may and may not do: one line per capability,
 * a yes or a no, and under a no its reason or the key that would open
 * it.
 */
export function Capabilities(props: {
  items: readonly Capability[]
  /**
   * What stands under a no: the reason of the rule, for the reader the
   * ability is about, or the key that is missing, on a page about
   * somebody else.
   */
  explain?: 'reason' | 'key'
}) {
  return (
    <ul class="capabilities">
      {props.items.map((item) => (
        <li class={`capability ${item.allowance.allowed ? 'can' : 'cannot'}`}>
          <span class="capability-mark" aria-hidden="true">
            {item.allowance.allowed ? '✓' : '–'}
          </span>
          <span class="capability-text">
            <span class="capability-label">
              <span class="sr-only">{item.allowance.allowed ? 'Yes: ' : 'No: '}</span>
              {item.label}
            </span>
            {item.allowance.allowed ? null : props.explain === 'key' ? (
              <span class="small muted">
                needs <code>{item.key}</code>
              </span>
            ) : (
              <span class="small muted">{item.allowance.reason}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
