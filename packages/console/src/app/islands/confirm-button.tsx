/**
 * A button that sends its form once the reader confirmed it.
 *
 * The acts that cannot be undone — a revocation, a deletion, the removal
 * of a field from a model — ask first.
 */

export default function ConfirmButton(props: {
  label: string
  message: string
  tone?: 'danger' | 'quiet' | 'primary'
  small?: boolean
  name?: string
  value?: string
}) {
  const tone = props.tone === 'primary' ? '' : (props.tone ?? 'danger')
  return (
    <button
      type="submit"
      class={`button ${tone} ${props.small ? 'small' : ''}`.trim()}
      name={props.name}
      value={props.value}
      onClick={(event: Event) => {
        if (!window.confirm(props.message)) event.preventDefault()
      }}
    >
      {props.label}
    </button>
  )
}
