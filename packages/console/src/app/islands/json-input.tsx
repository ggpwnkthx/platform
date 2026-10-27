/**
 * A field of json: it says whether the text is json while it is typed,
 * and it lays the text out on demand.
 *
 * The text area is not controlled: the server renders the text, the
 * reader types, and the island reads what was typed.
 */

import { useRef, useState } from 'hono/jsx'

function problemOf(text: string, required: boolean): string | null {
  if (text.trim() === '') return required ? 'a value is required' : null
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null) return 'the value is not an object or an array'
    return null
  } catch (error) {
    return (error as Error).message
  }
}

export default function JsonInput(props: {
  name: string
  initial: string
  required?: boolean
  rows?: number
  id?: string
}) {
  const [text, setText] = useState(props.initial)
  const area = useRef<HTMLTextAreaElement>(null)
  const problem = problemOf(text, props.required ?? false)
  return (
    <span class="stack" style="gap: 0.3rem">
      <textarea
        ref={area}
        id={props.id}
        name={props.name}
        class="code"
        rows={props.rows ?? 8}
        spellcheck={false}
        aria-invalid={problem ? 'true' : undefined}
        onInput={(event: Event) => setText((event.target as HTMLTextAreaElement).value)}
      >
        {props.initial}
      </textarea>
      <span class="row spread">
        <span class={problem ? 'problem small' : 'hint'}>{problem ?? 'json'}</span>
        <button
          type="button"
          class="link-button small"
          disabled={problem !== null || text.trim() === ''}
          onClick={() => {
            const formatted = JSON.stringify(JSON.parse(text), null, 2)
            if (area.current) area.current.value = formatted
            setText(formatted)
          }}
        >
          format
        </button>
      </span>
    </span>
  )
}
