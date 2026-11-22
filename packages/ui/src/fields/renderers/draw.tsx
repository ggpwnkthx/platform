import clsx from 'clsx'
import { choiceTone, fill, grouped, numberOf, safeHref, textOf } from '../text.ts'
import type { RenderValue } from '../field.ts'

function numberOption(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The way the platform draws a value: the way its field's own type draws it, in the place it
 * is drawn. A filter is drawn as the record is, unless the type says otherwise.
 */
export function drawDefault(value: RenderValue) {
  const { draw } = value.field.type
  return (draw[value.situation] ?? draw.record)(value)
}

/** The text of a value, in full, wrapped where it falls. */
export function drawText(value: RenderValue) {
  const text = textOf(value.value)
  if (value.situation === 'list')
    return (
      <span class="clip" title={text}>
        {text}
      </span>
    )
  return <span class="value-text">{text}</span>
}

/** The text of a value, shortened to a length the owner chose. */
export function drawTruncate(value: RenderValue) {
  const text = textOf(value.value)
  const length = numberOption(value.options.length, 40)
  if (text.length <= length)
    return (
      <span class="clip" title={text}>
        {text}
      </span>
    )
  return (
    <span class="clip" title={text}>
      {text.slice(0, Math.max(0, length))}…
    </span>
  )
}

/** The text of a value, as a paragraph: as it was typed, line breaks and all. */
export function drawParagraph(value: RenderValue) {
  return <span class="value-paragraph">{textOf(value.value)}</span>
}

/** A number, with the thousands marked. */
export function drawNumber(value: RenderValue) {
  return <span class={clsx('mono', 'cell-number')}>{grouped(value.value)}</span>
}

/** A yes or a no, in words. */
export function drawBoolean(value: RenderValue) {
  const yes = value.value === true || value.value === 'true'
  const no = value.value === false || value.value === 'false'
  if (!yes && !no) return <span class="mono">{textOf(value.value)}</span>
  return <span class={clsx('value-boolean', yes && 'is-true')}>{yes ? 'Yes' : 'No'}</span>
}

/** A moment, a date or a time of day, as the database wrote it. */
export function drawMoment(value: RenderValue) {
  return <span class="mono value-moment">{textOf(value.value)}</span>
}

/** A uuid, whole. */
export function drawUuid(value: RenderValue) {
  return <span class="mono value-uuid">{textOf(value.value)}</span>
}

/** A JSON document, as a document. */
export function drawJson(value: RenderValue) {
  if (value.value === null || value.value === undefined) return <span class="null">null</span>
  let text: string
  try {
    text = JSON.stringify(value.value, null, 2)
  } catch {
    text = textOf(value.value)
  }
  return <pre class="mono value-json">{text}</pre>
}

/** A value chosen from a list, drawn as the choice it is. */
export function drawChoice(value: RenderValue) {
  const text = textOf(value.value)
  return <span class={clsx('choice', `choice-${choiceTone(text)}`)}>{text}</span>
}

/** A text that names something else: a link. */
export function drawLink(value: RenderValue) {
  const text = textOf(value.value)
  const template = typeof value.options.href === 'string' ? value.options.href : ''
  const href = safeHref(fill(template, text, true))
  if (!href) return <span class="value-text">{text}</span>
  return (
    <a class="value-link" href={href} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  )
}

/** A value drawn as the owner wrote it: a template with the value put in it. */
export function drawTemplate(value: RenderValue) {
  const text = textOf(value.value)
  const template = typeof value.options.template === 'string' ? value.options.template : '{value}'
  return <span class="value-text">{fill(template, text)}</span>
}

/** A number drawn as a bar: how much of the whole it is. */
export function drawBar(value: RenderValue) {
  const number = numberOf(value.value)
  const max = numberOption(value.options.max, 100)
  const share = number === null || max === 0 ? 0 : Math.max(0, Math.min(1, number / max))
  return (
    <span class="value-bar">
      <span class="value-bar-fill" style={{ width: `${(share * 100).toFixed(1)}%` }} />
      <span class="mono">{textOf(value.value)}</span>
    </span>
  )
}

/** A value as the database wrote it, and nothing more. */
export function drawRaw(value: RenderValue) {
  return <span class="mono value-raw">{textOf(value.value)}</span>
}
