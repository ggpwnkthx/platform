import { Stack, Text } from '@mantine/core'
import { type Hold, tableOf } from '@platform/core'
import { Privilege } from '../bits/marks.tsx'
import { Tag } from '../bits/page.tsx'
import { usePolicies } from '../access/shared.tsx'
import type { Field } from '../fields/types.ts'
import { useSession } from '../session/context.ts'
/** The reader's own rights on a collection and the row policies that apply to them. */
export function CollectionAside({
  schema,
  table,
  fields,
}: {
  schema: string
  table: string
  fields: Field[]
}) {
  const { catalog } = useSession()
  const info = tableOf(catalog, schema, table)
  const rules = usePolicies(schema, table)
  if (!info) return null
  const held = (
    whole: boolean,
    right: 'can_select' | 'can_insert' | 'can_update'
  ): [Hold, string] => {
    const some = fields.filter((f) => f.column?.[right]).length
    return [whole ? 'all' : some ? 'some' : 'none', `${some}/${fields.length}`]
  }
  const applying = (rules.data ?? []).filter((p) => p.applies)
  return (
    <Stack gap="lg">
      <div>
        <Text fw={650} mb={4}>
          Collection
        </Text>
        <Text fz="sm" c="dimmed">
          {info.comment}
        </Text>
        <Text fz="sm" className="mono">
          {schema}.{table}
        </Text>
        <Text fz="sm" c="dimmed">
          Owned by <span className="mono">{info.owner}</span>
        </Text>
      </div>
      <div>
        <Text fw={650} mb={4}>
          What you may do
        </Text>
        <Stack gap={4}>
          {info.can_alter && <Tag color="dark">owner</Tag>}
          {(['SELECT', 'INSERT', 'UPDATE'] as const).map((name) => {
            const [hold, count] = held(
              info[`can_${name.toLowerCase()}` as 'can_select'],
              `can_${name.toLowerCase()}` as 'can_select'
            )
            return <Privilege key={name} name={name} held={hold} count={count} />
          })}
          <Privilege name="DELETE" held={info.can_delete} />
        </Stack>
      </div>
      <div>
        <Text fw={650} mb={4}>
          Row security
        </Text>
        {!info.rls && (
          <Text fz="sm" c="dimmed">
            Row security is off: grants alone decide which rows you reach.
          </Text>
        )}
        {info.rls && !applying.length && (
          <Text fz="sm" c="dimmed">
            {info.can_alter
              ? 'No policy applies to you; as an owner you are not held to them.'
              : 'No policy applies to you: PostgreSQL shows you no row.'}
          </Text>
        )}
        {applying.map((p) => (
          <div key={p.name}>
            <Text fz="sm">
              <span className="mono">{p.name}</span> <Tag color="blue">{p.command}</Tag>
            </Text>
            <Text fz="xs" className="mono" c="blue.8">
              {p.using ?? p.check}
            </Text>
          </div>
        ))}
      </div>
    </Stack>
  )
}
