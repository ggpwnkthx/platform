import { ActionIcon, Tooltip } from '@mantine/core'
import { Columns3, KeyRound, Link2, Rows3, Tags } from 'lucide-react'
import { Link } from 'react-router'
import type { usePlace } from '../session/hooks.ts'

/** The parts of a collection, each an icon in the header rather than a tab under the title. */
export const parts = [
  { value: 'fields', label: 'Fields', Icon: Columns3 },
  { value: 'constraints', label: 'Constraints', Icon: Link2 },
  { value: 'metadata', label: 'Metadata', Icon: Tags },
  { value: 'access', label: 'Access', Icon: KeyRound },
] as const

/** The part a collection is shown in: the one asked for, or its fields. */
export const partOf = (asked: string | null): string =>
  parts.some((p) => p.value === asked) ? asked! : 'fields'

/** The header of a collection: a way into each of its parts, and a way into its records. */
export function CollectionParts({
  place,
  part,
}: {
  place: ReturnType<typeof usePlace>
  part: string
}) {
  return (
    <>
      {parts.map(({ value, label, Icon }) => (
        <Tooltip key={value} label={label} withArrow>
          <ActionIcon
            size={36}
            radius="sm"
            variant={part === value ? 'filled' : 'default'}
            aria-label={label}
            aria-pressed={part === value}
            onClick={() => place.set({ tab: value === 'fields' ? null : value })}
          >
            <Icon size={18} />
          </ActionIcon>
        </Tooltip>
      ))}
      <Tooltip label="Records" withArrow>
        <ActionIcon
          size={36}
          radius="sm"
          variant="default"
          component={Link}
          to={place.to('/data/records', { c: place.c })}
          aria-label="Records"
        >
          <Rows3 size={18} />
        </ActionIcon>
      </Tooltip>
    </>
  )
}
