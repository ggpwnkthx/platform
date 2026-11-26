import { objectGrantStatement, type ObjectKind, objectPrivileges } from '@platform/core'
import { SelectInput, useGetList } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { choices, mono, ownsSchema } from '../data/kinds.ts'
import { Mono } from '../kit/marks.tsx'
import { type Granted, grantKind } from './granted.tsx'

/** Who may use a schema's sequences, call its functions and use its types. */
type ObjectRow = Granted & { objects: ObjectKind; name: string }
export const objectGrants = grantKind<ObjectRow, { schema: string }>({
  name: 'object-grants',
  title: 'Grants on sequences, functions and types',
  note: 'Who may draw from a sequence (USAGE), call a function (EXECUTE) or use a type (USAGE). A new function may be called by everyone until EXECUTE is revoked from PUBLIC.',
  noun: 'privileges',
  empty: 'This schema holds no sequence, function or type that you may see.',
  view: ['access_object_grants', ['schema'], '2, 3, 4, 5'],
  on: (row) => `${row.objects} ${row.name}`,
  columns: [
    { source: 'name', label: 'Object', render: (row) => <Mono>{row.name}</Mono> },
    { source: 'objects', label: 'Kind', render: (row) => row.objects.toLowerCase() },
  ],
  may: ownsSchema,
  On({ where }) {
    const objects = (useWatch({ name: 'objects' }) ?? 'FUNCTION') as ObjectKind
    const found = useGetList<ObjectRow & { id: string }>('object-grants', {
      filter: where,
      pagination: { page: 1, perPage: 1000 },
    })
    const names = [
      ...new Set((found.data ?? []).filter((o) => o.objects === objects).map((o) => o.name)),
    ]
    return (
      <>
        <SelectInput
          source="objects"
          label="Kind"
          choices={choices(Object.keys(objectPrivileges))}
          {...mono}
        />
        <SelectInput source="name" label="Object" choices={choices(names)} {...mono} />
      </>
    )
  },
  privileges: (form) => objectPrivileges[form.objects ?? 'FUNCTION'] ?? [],
  start: () => ({ objects: 'FUNCTION', privileges: ['EXECUTE'] }),
  statement: (grant, revoke) => objectGrantStatement(grant, revoke),
})
