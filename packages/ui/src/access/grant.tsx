import {
  Autocomplete,
  Checkbox,
  Group,
  MultiSelect,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core'
import {
  columnsOf,
  type Wanted,
  grantChangeStatements,
  grantStatement,
  narrows,
  reservedRole,
  tablePrivileges,
} from '@platform/core'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import { Privilege, PrivilegeLegend } from '../bits/marks.tsx'
import { useSession } from '../session/context.ts'
import { heldBy, same, useGrants, useRoles, useSchemaReach } from './shared.tsx'

/**
 * One role on one collection: each privilege not held, held on the whole collection, or held
 * on chosen fields. What runs is the difference between what the ACL records and what is asked.
 */
export function GrantEditor({
  schema,
  table,
  role: given,
  onClose,
}: {
  schema: string
  table: string
  role?: string
  onClose(): void
}) {
  const { catalog } = useSession()
  const [role, setRole] = useState(given ?? '')
  const [edits, setEdits] = useState<Record<string, Wanted>>({})
  const [usage, setUsage] = useState(true)
  const known = useRoles()
  const grants = useGrants(schema)
  const reached = useSchemaReach(schema)
  const columns = columnsOf(catalog, schema, table).map((c) => c.name)
  const held = heldBy(grants.data ?? [], table, role)
  const wanted = (p: string): Wanted =>
    edits[p] ?? (held[p]?.whole ? 'all' : held[p]?.columns.length ? held[p]!.columns : 'none')
  const owner = catalog.schemas.find((s) => s.name === schema)?.can_alter
  // A grant on a collection is of no use without USAGE on the workspace.
  const lacksUsage = !!role && !reached.data?.find((r) => same(r.role, role))?.usage
  return (
    <Change
      title={`Grant on ${table}`}
      opened
      onClose={onClose}
      statements={() => {
        if (!role.trim()) throw new Error('Choose the role the grant is for.')
        const statements = grantChangeStatements({
          schema,
          table,
          grantee: role,
          held,
          wanted: edits,
        })
        const grantsSomething = statements.some((s) => s.startsWith('GRANT'))
        return [
          ...(lacksUsage && owner && usage && grantsSomething
            ? [grantStatement({ schema, table: null, privileges: ['USAGE'], grantee: role })]
            : []),
          ...statements,
        ]
      }}
    >
      <Autocomplete
        label="Role"
        description="The roles you may see are offered; any other may be typed."
        className="mono"
        disabled={!!given}
        data={[
          ...(known.data?.roles ?? []).map((r) => r.name).filter((name) => !reservedRole(name)),
          'public',
        ]}
        value={role}
        onChange={(next) => {
          setRole(next)
          setEdits({})
        }}
      />
      <PrivilegeLegend />
      {tablePrivileges.map((p) => {
        const want = wanted(p)
        const narrowable = narrows(p)
        return (
          <Stack key={p} gap={6}>
            <Group justify="space-between">
              <Privilege
                name={p}
                held={want === 'all' ? 'all' : want === 'none' ? 'none' : 'some'}
                count={Array.isArray(want) ? `${want.length}/${columns.length}` : undefined}
              />
              <SegmentedControl
                size="xs"
                value={Array.isArray(want) ? 'fields' : want}
                data={[
                  { value: 'none', label: 'Not held' },
                  { value: 'all', label: 'Whole collection' },
                  ...(narrowable ? [{ value: 'fields', label: 'Chosen fields' }] : []),
                ]}
                onChange={(next) =>
                  setEdits({
                    ...edits,
                    [p]:
                      next === 'fields'
                        ? held[p]?.columns.length
                          ? held[p]!.columns
                          : columns
                        : (next as Wanted),
                  })
                }
              />
            </Group>
            {Array.isArray(want) && (
              <MultiSelect
                data={columns}
                value={want}
                onChange={(next) => setEdits({ ...edits, [p]: next })}
                className="mono"
                description={
                  held[p]?.whole
                    ? 'A field added later will not be among the ones named.'
                    : undefined
                }
              />
            )}
          </Stack>
        )
      })}
      {lacksUsage &&
        (owner ? (
          <Checkbox
            label={`Also GRANT USAGE on ${schema}: without it the grant is of no use`}
            checked={usage}
            onChange={(e) => setUsage(e.currentTarget.checked)}
          />
        ) : (
          <Text fz="sm" c="dimmed">
            {role} holds no USAGE on {schema}; its owner grants that.
          </Text>
        ))}
    </Change>
  )
}
