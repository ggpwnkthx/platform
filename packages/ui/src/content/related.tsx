import { Anchor, Group, Stack, Text } from '@mantine/core'
import { countLinked } from '@platform/core'
import { Link } from 'react-router'
import type { Field } from '../fields/types.ts'
import { useDb, usePlace } from '../session/hooks.ts'

/**
 * The rows that point at this one: how many there are, and where they are. They are read
 * here and left to the collection they are in — the one-to-many side is not edited here.
 */
export function RelatedRows({ fields, id }: { fields: Field[]; id: string }) {
  const place = usePlace()
  const counted = useDb(
    ['related', place.ws, id, fields.map((f) => f.name)],
    async (one) => {
      const out: Record<string, number> = {}
      for (const f of fields) out[f.name] = await countLinked(one, f.link!.path, id)
      return out
    },
    !!id && fields.length > 0
  )
  if (!fields.length) return null
  return (
    <Stack gap={4}>
      <Text fw={650}>Rows that point here</Text>
      {fields.map((f) => {
        const path = f.link!.path
        return (
          <Group key={f.name} justify="space-between" gap="xs">
            <Text size="sm">{f.label}</Text>
            <Anchor
              component={Link}
              size="sm"
              to={place.to('/data/records', {
                c: path.table,
                [`f.${path.fk}`]: `eq.${id}`,
              })}
              title={`Every ${path.table} that points at this row`}
            >
              {counted.data?.[f.name] ?? '…'}
            </Anchor>
          </Group>
        )
      })}
    </Stack>
  )
}
