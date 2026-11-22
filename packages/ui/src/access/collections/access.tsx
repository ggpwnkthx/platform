import { useState } from 'preact/hooks'
import {
  type RoleInfo,
  type TableInfo,
  columnsOf,
  grants as readGrants,
  policies as readPolicies,
  reach as readReach,
  roles as readRoles,
} from '@platform/data'
import { describe, useLoad, useSession } from '../../session.tsx'
import { Loading, Notice } from '../../ui/bits.tsx'
import { FieldAccessDrawer } from '../fields/access.tsx'
import { FieldAccessTable } from '../fields/table.tsx'
import { GrantDrawer } from '../grants/drawer.tsx'
import type { GrantTarget } from '../grants/target.tsx'
import { CollectionGrants } from './grants.tsx'
import { InheritingTable } from './inheriting.tsx'
import { granteesOf, reaches } from '../model.ts'
import { CollectionPolicies } from './policies.tsx'

/**
 * Who holds one field, opened from wherever the field is listed. The collection's grants are
 * read when a field is asked about, and not before.
 */
export function FieldAccess({
  schema,
  table,
  column,
  onClose,
}: {
  schema: string
  table: string
  /** Null while nothing is asked about. */
  column: string | null
  onClose: () => void
}) {
  const { catalog } = useSession()
  const asking = column !== null
  const grants = useLoad(asking ? (db) => readGrants(db, schema) : null, [schema, catalog, asking])
  const found = useLoad(asking ? (db) => readRoles(db) : null, [catalog, asking])
  return (
    <FieldAccessDrawer
      schema={schema}
      table={table}
      column={grants.data ? column : null}
      grants={grants.data ?? []}
      roles={found.data?.roles ?? []}
      onClose={onClose}
      onDone={grants.reload}
    />
  )
}

/**
 * The access to one collection, read from the collection: the roles its ACL names and what
 * each holds, the roles that reach it through them, who holds each field, and its row
 * security. Its owner changes all of it here; everyone else reads what the database shows.
 */
export function CollectionAccess({ table }: { table: TableInfo }) {
  const { catalog } = useSession()
  const schema = table.schema
  const grants = useLoad((db) => readGrants(db, schema), [schema, catalog])
  const found = useLoad((db) => readRoles(db), [catalog])
  const reach = useLoad(
    (db) => readReach(db, schema, { table: table.name }),
    [schema, table.name, catalog]
  )
  const policies = useLoad((db) => readPolicies(db), [catalog])
  const [granting, setGranting] = useState<GrantTarget | null>(null)
  const [field, setField] = useState<string | null>(null)
  const roles: RoleInfo[] = found.data?.roles ?? []
  const memberships = found.data?.memberships ?? []
  const columns = columnsOf(catalog, schema, table.name)
  const all = grants.data ?? []
  const grantees = granteesOf(all, table.name, table.owner)
  const answers = reach.data ?? []
  // The roles that reach the collection without being named in its ACL: through a group.
  const inheriting = answers.filter(
    (row) =>
      row.role !== 'public' &&
      row.role !== table.owner &&
      !grantees.includes(row.role) &&
      reaches(row) &&
      !roles.find((role) => role.name === row.role)?.superuser
  )
  const reload = () => {
    grants.reload()
    reach.reload()
    policies.reload()
  }
  if (grants.error) return <Notice tone="danger" title={describe(grants.error).title} />
  if (!grants.data) return <Loading />
  return (
    <>
      <CollectionGrants
        table={table}
        grants={all}
        roles={roles}
        answers={answers}
        fields={columns.length}
        onGrant={() => setGranting({ table: table.name })}
        onEdit={(grantee) => setGranting({ table: table.name, grantee })}
      />
      {inheriting.length > 0 && (
        <section class="section">
          <header class="section-head">
            <div>
              <h2>Reaching it through a group</h2>
              <p>
                Roles the ACL does not name that the database lets in all the same, because they
                inherit from one it does. What they may do changes with the group’s grants and with
                their membership.
              </p>
            </div>
          </header>
          <InheritingTable
            table={table.name}
            grants={all}
            memberships={memberships}
            roles={roles}
            rows={inheriting}
          />
        </section>
      )}
      <section class="section">
        <header class="section-head">
          <div>
            <h2>Fields</h2>
            <p>
              Who reads and writes each field. A field left out of a role’s SELECT is withheld from
              it everywhere: in the records, in a filter, and in the field’s own metadata.
            </p>
          </div>
        </header>
        <FieldAccessTable table={table} grants={all} onOpen={setField} />
      </section>
      {table.kind !== 'v' && (
        <CollectionPolicies
          schema={schema}
          table={table}
          policies={(policies.data ?? []).filter(
            (p) => p.schema === schema && p.table === table.name
          )}
          roles={roles}
          onDone={reload}
        />
      )}
      <GrantDrawer
        schema={schema}
        target={granting}
        grants={all}
        roles={roles}
        memberships={memberships}
        onClose={() => setGranting(null)}
        onDone={reload}
      />
      <FieldAccessDrawer
        schema={schema}
        table={table.name}
        column={field}
        grants={all}
        roles={roles}
        onClose={() => setField(null)}
        onDone={reload}
      />
    </>
  )
}
