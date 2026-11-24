import { Group, Select, Text } from '@mantine/core'
import {
  columnsOf,
  constraintsOf,
  dropConstraintStatement,
  foreignKeyStatement,
  indexesOf,
  onDeleteActions,
  type OnDelete,
  relationOf,
  tableOf,
} from '@platform/core'
import { useState } from 'react'
import { AddButton } from '../bits/add.tsx'
import { Change } from '../bits/change.tsx'
import { Section } from '../bits/page.tsx'
import type { Field } from '../fields/types.ts'
import { useSession } from '../session/context.ts'
import { ConstraintEditor } from './constraint-editor.tsx'
import { ForeignKeys, UniqueKeys } from './constraint-keys.tsx'
import { Checks, Indexes, RequiredFields } from './constraint-rules.tsx'
import {
  type Change as ConstraintChange,
  type Draft,
  emptyDraft,
  ruleOf,
  sameColumns,
  systemish,
} from './constraint-shared.ts'

/**
 * The constraints of one collection: the keys it points by, the rules its rows are held by,
 * and the ways its rows are found. Every change is shown as the SQL it will run, and runs
 * as the reader, in one transaction.
 */
export function Constraints({
  schema,
  table,
  fields,
}: {
  schema: string
  table: string
  fields: Field[]
}) {
  const { catalog } = useSession()
  const constraints = constraintsOf(catalog, schema, table)
  const indexes = indexesOf(catalog, schema, table)
  const columns = columnsOf(catalog, schema, table).filter((c) => !systemish(c.name))
  const relations = catalog.relations.filter((r) => r.schema === schema && r.table === table)
  const [adding, setAdding] = useState<Draft | null>(null)
  const [change, setChange] = useState<ConstraintChange | null>(null)
  const [rule, setRule] = useState<{ name: string; column: string; onDelete: OnDelete } | null>(
    null
  )
  // A key may point at a collection of another workspace: every collection the reader may
  // use is offered, and the one it belongs to is named with it.
  const tables = catalog.tables
    .filter((t) => t.kind !== 'v' && t.schema !== 'platform')
    .map((t) => ({ schema: t.schema, name: t.name }))
  // Only the owner of a collection may change its constraints: PostgreSQL asks the owner
  // for every one of these statements.
  const canAlter = tableOf(catalog, schema, table)?.can_alter ?? false
  // An index that backs a key is the key's own: it is dropped with it, and is not listed twice.
  const backed = new Set(
    constraints
      .filter((c) => c.type === 'u')
      .flatMap((c) => indexes.filter((i) => i.unique && sameColumns(i.columns, c.columns)))
  )
  const plain = indexes.filter((i) => !i.primary && !backed.has(i))

  return (
    <>
      <Group justify="flex-end" mb="sm">
        {canAlter && <AddButton onClick={() => setAdding(emptyDraft())}>New constraint</AddButton>}
      </Group>
      <Section
        title="Foreign keys"
        note="The rows this collection points at. What happens to a row when the one it points at goes is set on the key."
      >
        <ForeignKeys
          schema={schema}
          table={table}
          constraints={constraints}
          relations={relations}
          canAlter={canAlter}
          onChange={setChange}
          onRule={(key, relation) =>
            setRule({
              name: key.name,
              column: relation.column,
              onDelete: ruleOf(relation.on_delete),
            })
          }
        />
      </Section>

      <Section title="Unique keys" note="The rows a combination of fields is held once by.">
        <UniqueKeys
          schema={schema}
          table={table}
          constraints={constraints}
          canAlter={canAlter}
          onChange={setChange}
        />
      </Section>

      <Section title="Checks" note="The expression every row is held by.">
        <Checks
          schema={schema}
          table={table}
          constraints={constraints}
          canAlter={canAlter}
          onChange={setChange}
        />
      </Section>

      <Section
        title="Required fields"
        note="The fields a row may not leave empty. PostgreSQL refuses the change while any row is empty."
      >
        <RequiredFields
          schema={schema}
          table={table}
          columns={columns}
          canAlter={canAlter}
          onChange={setChange}
        />
      </Section>

      <Section
        title="Indexes"
        note="The ways the rows of this collection are found without a scan. A key's own index is dropped with the key."
      >
        <Indexes schema={schema} indexes={plain} canAlter={canAlter} onChange={setChange} />
      </Section>

      {adding && (
        <ConstraintEditor
          schema={schema}
          table={table}
          fields={fields}
          tables={tables}
          draft={adding}
          onChange={setAdding}
          onClose={() => setAdding(null)}
        />
      )}
      {change && (
        <Change
          title={change.title}
          opened
          danger={change.danger}
          onClose={() => setChange(null)}
          statements={() => change.statements}
        />
      )}
      {rule && (
        <Change
          title={`What happens to ${rule.column}`}
          opened
          onClose={() => setRule(null)}
          statements={() => {
            const relation = relationOf(catalog, schema, table, rule.column)
            if (!relation) throw new Error('That key is not there any more.')
            return [
              dropConstraintStatement(schema, table, rule.name),
              foreignKeyStatement(
                schema,
                table,
                rule.column,
                { schema: relation.target_schema, table: relation.target_table },
                rule.onDelete,
                rule.name
              ),
            ]
          }}
        >
          <Select
            label="When the row it points at goes"
            allowDeselect={false}
            data={Object.keys(onDeleteActions)}
            value={rule.onDelete}
            onChange={(next) => setRule({ ...rule, onDelete: (next as OnDelete) ?? 'restrict' })}
          />
          <Text fz="xs" c="dimmed">
            The key is dropped and made again with the new rule: the rows are left as they are.
          </Text>
        </Change>
      )}
    </>
  )
}
