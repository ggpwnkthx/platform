import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { type TableInfo, collectionStatements } from '@platform/core'
import { Share2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Change } from '../bits/change.tsx'

/**
 * A many-to-many relation, made the way PostgreSQL makes it: a collection of its own, with
 * a key to each side and the pair unique. It is an ordinary collection after that — the
 * interface reads it as the links between the two, and psql reads it as a table.
 */
export function ManyToMany({
  schema,
  table,
  tables,
}: {
  schema: string
  table: string
  tables: TableInfo[]
}) {
  const [opened, setOpened] = useState(false)
  const [other, setOther] = useState<string | null>(null)
  const [join, setJoin] = useState('')
  const [left, setLeft] = useState(table)
  const [right, setRight] = useState('')

  const statements = useCallback(() => {
    if (!other) throw new Error('Choose the collection on the other side.')
    if (!join.trim()) throw new Error('Name the table that holds the links.')
    if (!left.trim() || !right.trim()) throw new Error('Name both of the keys.')
    return collectionStatements(
      schema,
      join.trim(),
      `The links between ${table} and ${other}.`,
      [
        { name: left.trim(), type: 'relation', relation: table },
        { name: right.trim(), type: 'relation', relation: other },
      ],
      [[left.trim(), right.trim()]]
    )
  }, [schema, table, other, join, left, right])

  return (
    <>
      <Button variant="default" leftSection={<Share2 size={16} />} onClick={() => setOpened(true)}>
        Many to many
      </Button>
      <Change
        title="Many to many"
        opened={opened}
        onClose={() => setOpened(false)}
        statements={statements}
      >
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            A many-to-many relation is a table of its own: a key to {table}, a key to the collection
            on the other side, and the pair unique — a link, and not a copy. The interface reads it
            as the links between the two; psql reads it as a table.
          </Text>
          <Select
            label="And the other side is"
            searchable
            data={tables
              .filter((one) => one.name !== table && one.kind !== 'v')
              .map((one) => one.name)}
            value={other}
            onChange={(next) => {
              setOther(next)
              if (next && !right) setRight(next)
              if (next && !join) setJoin(`${table}_${next}`)
            }}
          />
          <TextInput
            label="The links are held in"
            className="mono"
            value={join}
            onChange={(e) => setJoin(e.currentTarget.value)}
          />
          <Group grow>
            <TextInput
              label={`The key to ${table}`}
              className="mono"
              value={left}
              onChange={(e) => setLeft(e.currentTarget.value)}
            />
            <TextInput
              label="The key to the other side"
              className="mono"
              value={right}
              onChange={(e) => setRight(e.currentTarget.value)}
            />
          </Group>
          <Text size="xs" c="dimmed">
            The new collection is made with row security on and no policy: its owner administers it.
            Give the other roles their rights in its Access tab.
          </Text>
        </Stack>
      </Change>
    </>
  )
}
