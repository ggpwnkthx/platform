/**
 * The members of a group.
 *
 * A group of the access service names its members by the identity the
 * provider gives them, and an operator names them by their e-mail: the
 * picker shows the users of the tenant by their names and writes their
 * identities into the form.
 */

import { useState } from 'hono/jsx'

interface Candidate {
  readonly subject: string
  readonly label: string
}

export default function MemberPicker(props: {
  name: string
  candidates: readonly Candidate[]
  selected: readonly string[]
}) {
  const [members, setMembers] = useState<string[]>([...props.selected])
  const [query, setQuery] = useState('')
  const labelOf = (subject: string) =>
    props.candidates.find((candidate) => candidate.subject === subject)?.label ?? subject
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? props.candidates
        .filter((candidate) => !members.includes(candidate.subject))
        .filter(
          (candidate) =>
            candidate.label.toLowerCase().includes(needle) ||
            candidate.subject.toLowerCase().includes(needle)
        )
        .slice(0, 8)
    : []

  return (
    <div class="stack" style="gap: 0.5rem">
      {members.map((subject) => (
        <input type="hidden" name={props.name} value={subject} />
      ))}
      <div class="chips">
        {members.length === 0 ? <span class="small muted">The group has no member.</span> : null}
        {members.map((subject) => (
          <span class="chip">
            {labelOf(subject)}
            <button
              type="button"
              aria-label={`Remove ${labelOf(subject)}`}
              onClick={() => setMembers(members.filter((member) => member !== subject))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="search"
        placeholder="Add a user: type a name, an e-mail or an identity"
        value={query}
        aria-label="Add a member"
        onInput={(event: Event) => setQuery((event.target as HTMLInputElement).value)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          const first = matches[0]
          if (first) {
            setMembers([...members, first.subject])
            setQuery('')
          }
        }}
      />
      {matches.length > 0 ? (
        <div class="chips">
          {matches.map((candidate) => (
            <button
              type="button"
              class="chip"
              onClick={() => {
                setMembers([...members, candidate.subject])
                setQuery('')
              }}
            >
              + {candidate.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
