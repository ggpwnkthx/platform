import clsx from 'clsx'
import type { Kind } from '@platform/data'
import type { FieldRenderers, Situation } from '@platform/vocabulary'
import { choiceTone, fill, grouped, numberOf, safeHref, textOf } from './text.ts'
import type { Draw, Field, RenderValue } from './types.ts'

/**
 * How a value is drawn.
 *
 * A value is not one thing drawn one way. The same field is a cell in the records grid, a
 * value in the record form and a value in the filter builder, and each of those wants a
 * different drawing: a uuid is eight characters in a cell and thirty-six in a record, a JSON
 * document is a clipped line in a cell and a document in a record, a number is a column of
 * digits in a cell and a number with separators in a record.
 *
 * A field's own type says how its values are drawn where nothing else is said: that is the
 * `default` renderer, and it is why a field that says nothing is already drawn differently in
 * each place. A renderer is one more way of drawing a value, which an owner may choose
 * instead — the platform holds a handful, and an installation may add its own with
 * `registerRenderer`. Which of them draws a value is said by the field itself, in its own
 * metadata, one situation at a time; a value whose saying names a renderer that does not
 * exist, or one that does not fit its kind of value, is drawn as the platform draws it.
 *
 * A renderer draws; it does not decide. It never says who may read a value, never changes
 * one, and never reaches for the database: PostgreSQL's own rights decided that before the
 * renderer was called.
 */

/** One option a renderer takes, and how it is written. */
export interface RendererOption {
  /** The name of the option, as the owner writes it. */
  name: string
  /** What the option is, in a sentence. */
  label: string
  /** A number is written as a number; anything else as text. */
  type?: 'text' | 'number'
  /** An example of the option, shown under it. */
  placeholder?: string
}

/** One way of drawing a value. */
export interface Renderer {
  /** The name the owner says it by. */
  name: string
  /** What it draws, in a sentence. */
  label: string
  /** The kinds of value it draws; empty means any kind. */
  kinds: Kind[]
  /** The situations it draws in; empty means any situation. */
  situations: Situation[]
  /** The options it takes, if any. */
  options?: RendererOption[]
  /** Draws the value. */
  render: Draw
}

/** The renderers the platform holds, by name. */
const registry = new Map<string, Renderer>()

/**
 * Adds a renderer of the installation's own. A renderer is one way of drawing a value: it
 * is given the value and the situation it is drawn in, and it draws. It may be said of any
 * field by name, in any situation.
 */
export function registerRenderer(renderer: Renderer): void {
  registry.set(renderer.name, renderer)
}

/** The renderer of that name, if there is one. */
export function rendererNamed(name: string): Renderer | null {
  return registry.get(name) ?? null
}

/** Every renderer the platform holds, in the order they were added. */
export function knownRenderers(): Renderer[] {
  return [...registry.values()]
}

/** Does this renderer draw this kind of value in this situation? */
export function appliesTo(renderer: Renderer, kind: Kind, situation: Situation): boolean {
  if (renderer.kinds.length && !renderer.kinds.includes(kind)) return false
  if (renderer.situations.length && !renderer.situations.includes(situation)) return false
  return true
}

/** The renderers that may draw this kind of value in this situation. */
export function renderersFor(kind: Kind, situation: Situation): Renderer[] {
  return knownRenderers().filter((renderer) => appliesTo(renderer, kind, situation))
}

/**
 * The renderer that draws a value: the one the field says, when it is one that may draw it,
 * and the platform's own when it is not.
 */
export function resolveRenderer(
  kind: Kind,
  situation: Situation,
  saying: FieldRenderers | undefined
): Renderer {
  const choice = saying?.[situation]
  if (choice) {
    const renderer = rendererNamed(choice.renderer)
    if (renderer && appliesTo(renderer, kind, situation)) return renderer
  }
  return rendererNamed('default')!
}

/** A number the owner gave, or the one the renderer falls back to. */
function numberOption(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The way the platform draws a value: the way its field's own type draws it, in the place it
 * is drawn. A filter is drawn as the record is, unless the type says otherwise.
 */
function drawDefault(value: RenderValue) {
  const { draw } = value.field.type
  return (draw[value.situation] ?? draw.record)(value)
}

/** The text of a value, in full, wrapped where it falls. */
function drawText(value: RenderValue) {
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
function drawTruncate(value: RenderValue) {
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
function drawParagraph(value: RenderValue) {
  return <span class="value-paragraph">{textOf(value.value)}</span>
}

/** A number, with the thousands marked. */
function drawNumber(value: RenderValue) {
  return <span class={clsx('mono', 'cell-number')}>{grouped(value.value)}</span>
}

/** A yes or a no, in words. */
function drawBoolean(value: RenderValue) {
  const yes = value.value === true || value.value === 'true'
  const no = value.value === false || value.value === 'false'
  if (!yes && !no) return <span class="mono">{textOf(value.value)}</span>
  return <span class={clsx('value-boolean', yes && 'is-true')}>{yes ? 'Yes' : 'No'}</span>
}

/** A moment, a date or a time of day, as PostgreSQL wrote it. */
function drawMoment(value: RenderValue) {
  return <span class="mono value-moment">{textOf(value.value)}</span>
}

/** A uuid, whole. */
function drawUuid(value: RenderValue) {
  return <span class="mono value-uuid">{textOf(value.value)}</span>
}

/** A JSON document, as a document. */
function drawJson(value: RenderValue) {
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
function drawChoice(value: RenderValue) {
  const text = textOf(value.value)
  return <span class={clsx('choice', `choice-${choiceTone(text)}`)}>{text}</span>
}

/** A text that names something else: a link. */
function drawLink(value: RenderValue) {
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
function drawTemplate(value: RenderValue) {
  const text = textOf(value.value)
  const template = typeof value.options.template === 'string' ? value.options.template : '{value}'
  return <span class="value-text">{fill(template, text)}</span>
}

/** A number drawn as a bar: how much of the whole it is. */
function drawBar(value: RenderValue) {
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

/** A value as PostgreSQL wrote it, and nothing more. */
function drawRaw(value: RenderValue) {
  return <span class="mono value-raw">{textOf(value.value)}</span>
}

/* The renderers the platform holds. */
registerRenderer({
  name: 'default',
  label: 'As the platform draws it',
  kinds: [],
  situations: [],
  render: drawDefault,
})
registerRenderer({
  name: 'text',
  label: 'The text, in full',
  kinds: ['text', 'other'],
  situations: [],
  render: drawText,
})
registerRenderer({
  name: 'truncate',
  label: 'Shortened, with an ellipsis',
  kinds: ['text', 'other'],
  situations: [],
  options: [
    {
      name: 'length',
      label: 'Characters to keep',
      type: 'number',
      placeholder: '40',
    },
  ],
  render: drawTruncate,
})
registerRenderer({
  name: 'paragraph',
  label: 'As a paragraph, as it was typed',
  kinds: ['text', 'other'],
  situations: ['record', 'filter'],
  render: drawParagraph,
})
registerRenderer({
  name: 'number',
  label: 'A number, with the thousands marked',
  kinds: ['integer', 'number'],
  situations: [],
  render: drawNumber,
})
registerRenderer({
  name: 'boolean',
  label: 'Yes or no, in words',
  kinds: ['boolean'],
  situations: [],
  render: drawBoolean,
})
registerRenderer({
  name: 'moment',
  label: 'The whole moment, as PostgreSQL wrote it',
  kinds: ['moment', 'date', 'time'],
  situations: [],
  render: drawMoment,
})
registerRenderer({
  name: 'uuid',
  label: 'The whole uuid',
  kinds: ['uuid'],
  situations: [],
  render: drawUuid,
})
registerRenderer({
  name: 'json',
  label: 'As a document',
  kinds: ['json'],
  situations: [],
  render: drawJson,
})
registerRenderer({
  name: 'choice',
  label: 'As the choice it is',
  kinds: ['text'],
  situations: [],
  render: drawChoice,
})
registerRenderer({
  name: 'link',
  label: 'As a link',
  kinds: ['text'],
  situations: [],
  options: [
    {
      name: 'href',
      label: 'The address',
      placeholder: 'https://example.com/{value}',
    },
  ],
  render: drawLink,
})
registerRenderer({
  name: 'template',
  label: 'As the owner wrote it',
  kinds: [],
  situations: [],
  options: [
    {
      name: 'template',
      label: 'The text',
      placeholder: 'Due {value}',
    },
  ],
  render: drawTemplate,
})
registerRenderer({
  name: 'bar',
  label: 'As a bar of a whole',
  kinds: ['integer', 'number'],
  situations: [],
  options: [
    {
      name: 'max',
      label: 'The whole',
      type: 'number',
      placeholder: '100',
    },
  ],
  render: drawBar,
})
registerRenderer({
  name: 'raw',
  label: 'As PostgreSQL wrote it, and nothing more',
  kinds: [],
  situations: [],
  render: drawRaw,
})

/**
 * A value, drawn the way its field says it is drawn, in the situation it is drawn in.
 *
 * A value that is null is drawn as null, whatever the saying: there is nothing to draw.
 */
export function Value({
  value,
  field,
  situation,
  label,
}: {
  value: unknown
  /** The field the value belongs to: its type, and what it says of its values. */
  field: Field
  /** Where it is drawn: the records grid, the record form or the filter builder. */
  situation: Situation
  /** The name of the row a relation points at, when the reader may read it. */
  label?: string | null
}) {
  if (value === null || value === undefined) return <span class="null">null</span>
  const renderer = resolveRenderer(field.kind, situation, field.renderers)
  return (
    <>
      {renderer.render({
        value,
        field,
        column: field.column,
        kind: field.kind,
        relation: field.relation,
        choices: field.choices,
        situation,
        label,
        options: field.renderers[situation]?.options ?? {},
      })}
    </>
  )
}
