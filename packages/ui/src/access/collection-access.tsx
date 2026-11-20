import { useState } from 'preact/hooks'
import {
  type GrantInfo,
  type Hold,
  type RoleInfo,
  type TableInfo,
  columnsOf,
  grants as readGrants,
  policies as readPolicies,
  reach as readReach,
  roles as readRoles,
} from '@platform/data'
import { describe, useLoad, useSession } from '../session.tsx'
import { Badge, Loading, Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { EditIcon, GrantIcon, KeyIcon } from '../ui/icons.tsx'
import { FieldAccessDrawer, GrantDrawer, type GrantTarget } from './grant-editor.tsx'
import {
  alsoHeld,
  asked,
  drawn,
  everyone,
  granteesOf,
  heldBy,
  heldOf,
  holdOf,
  holdsField,
  perField,
  reaches,
  reachOf,
  throughOf,
} from './model.ts'
import { CollectionPolicies } from './policies.tsx'
import { Legend, Mark, RoleLabel } from './rights.tsx'

/** One privilege in a table of marks: the mark, and how many fields a half one covers. */
export function HoldCell({
  hold,
  privilege,
  fields,
  of,
}: {
  hold: Hold
  privilege: string
  /** The fields a privilege held on some of them covers, when the ACL says which. */
  fields?: string[]
  /** How many fields the collection has. */
  of?: number
}) {
  const words =
    hold === 'all' ? 'on the whole collection' : hold === 'some' ? 'on some fields' : 'not held'
  const label = `${privilege}: ${words}${hold === 'some' && fields?.length ? ` (${fields.join(', ')})` : ''}`
  return (
    <td class="matrix-cell">
      <Mark hold={hold} label={label} />
      <span class="sr-only">{words}</span>
      {hold === 'some' && fields && of ? (
        <small class="cell-count" aria-hidden="true">
          {fields.length}/{of}
        </small>
      ) : null}
    </td>
  )
}

/** The heads of the privileges every table of marks carries. */
export const PrivilegeHeads = () => (
  <>
    {drawn.map((privilege) => (
      <th key={privilege} class="matrix-cell mono">
        {privilege}
      </th>
    ))}
  </>
)

/**
 * Who reads and writes each field, as the collection's ACL records it. A role that holds a
 * privilege on the whole collection holds it on every field, and is drawn quieter than one
 * granted the field by name; a field nobody is listed against is its owner's alone.
 */
export function FieldAccessTable({
  table,
  grants,
  onOpen,
}: {
  table: TableInfo
  grants: GrantInfo[]
  onOpen: (column: string) => void
}) {
  const { catalog } = useSession()
  const columns = columnsOf(catalog, table.schema, table.name)
  const grantees = granteesOf(grants, table.name, table.owner)
  const holdings = grantees.map((grantee) => ({
    grantee,
    held: heldBy(grants, table.name, grantee),
  }))
  return (
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Field</th>
            {perField.map((privilege) => (
              <th key={privilege} class="mono">
                {privilege}
              </th>
            ))}
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.name}>
              <td class="mono strong">{column.name}</td>
              {perField.map((privilege) => {
                const who = holdings.filter((h) =>
                  holdsField(heldOf(h.held, privilege), column.name)
                )
                return (
                  <td key={privilege}>
                    {who.length ? (
                      <span class="who">
                        {who.map((h) => (
                          <span
                            key={h.grantee}
                            class={
                              heldOf(h.held, privilege).whole ? 'who-role is-whole' : 'who-role'
                            }
                            title={
                              heldOf(h.held, privilege).whole
                                ? `${h.grantee} holds ${privilege} on the whole collection`
                                : `${h.grantee} is granted ${privilege} on this field`
                            }
                          >
                            {h.grantee}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span class="cell-muted">owner only</span>
                    )}
                  </td>
                )
              })}
              <td class="grid-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Access to ${column.name}`}
                  title={table.can_alter ? 'Change who holds this field' : 'Who holds this field'}
                  onClick={() => onOpen(column.name)}
                >
                  <KeyIcon size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="grid-note">
        <span class="who">
          <span class="who-role">role</span> granted the field by name
        </span>
        <span class="who">
          <span class="who-role is-whole">role</span> holds the whole collection
        </span>
      </p>
    </div>
  )
}

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
  const owner = table.can_alter
  const columns = columnsOf(catalog, schema, table.name)
  const all = grants.data ?? []
  const grantees = granteesOf(all, table.name, table.owner)
  const answers = reach.data ?? []
  const answerFor = (grantee: string) => answers.find((row) => row.role === asked(grantee))
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
      <section class="section">
        <header class="section-head">
          <div>
            <h2>Grants</h2>
            <p>
              The roles the ACL of <span class="mono">{table.name}</span> names, and what each may
              do with it. A group is granted once for all its members.
            </p>
          </div>
          {owner && (
            <Button
              icon={<GrantIcon size={16} />}
              onClick={() => setGranting({ table: table.name })}
            >
              Grant to a role
            </Button>
          )}
        </header>
        <div class="grid-wrap">
          <table class="grid matrix">
            <thead>
              <tr>
                <th>Role</th>
                <PrivilegeHeads />
                <th>Also</th>
                <th class="grid-actions">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <RoleLabel name={table.owner} roles={roles} />
                  <Badge tone="outline">owner</Badge>
                </td>
                {drawn.map((privilege) => (
                  <HoldCell key={privilege} hold="all" privilege={privilege} />
                ))}
                <td class="cell-muted">every privilege, and its row policies do not filter it</td>
                <td class="grid-actions" />
              </tr>
              {grantees.map((grantee) => {
                const held = heldBy(all, table.name, grantee)
                const answer = answerFor(grantee)
                return (
                  <tr key={grantee}>
                    <td>
                      <RoleLabel name={grantee} roles={roles} />
                      {grantee === everyone && <Badge>everyone</Badge>}
                      {answer && !answer.usage && (
                        <Badge
                          tone="warning"
                          title={`Without USAGE on ${schema} the database refuses every statement on a collection inside`}
                        >
                          no USAGE on {schema}
                        </Badge>
                      )}
                    </td>
                    {drawn.map((privilege) => (
                      <HoldCell
                        key={privilege}
                        hold={holdOf(held[privilege])}
                        privilege={privilege}
                        fields={heldOf(held, privilege).columns}
                        of={columns.length}
                      />
                    ))}
                    <td class="mono cell-muted">{alsoHeld(held).join(', ')}</td>
                    <td class="grid-actions">
                      {owner && (
                        <button
                          type="button"
                          class="icon-button"
                          aria-label={`Change what ${grantee} holds on ${table.name}`}
                          title="Change"
                          onClick={() => setGranting({ table: table.name, grantee })}
                        >
                          <EditIcon size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div class="grid-note">
            <Legend />
            {!grantees.length && (
              <span>No role is granted anything: only the owner reaches it.</span>
            )}
          </div>
        </div>
        {!owner && (
          <p class="panel-note">
            The database gives grants on {table.name} to its owner, {table.owner}, and its members.
          </p>
        )}
      </section>
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
          <div class="grid-wrap">
            <table class="grid matrix">
              <thead>
                <tr>
                  <th>Role</th>
                  <PrivilegeHeads />
                  <th>Through</th>
                </tr>
              </thead>
              <tbody>
                {inheriting.map((row) => {
                  const through = throughOf(row.role, table.name, all, memberships)
                  return (
                    <tr key={row.role}>
                      <td>
                        <RoleLabel name={row.role} roles={roles} />
                      </td>
                      {drawn.map((privilege) => (
                        <HoldCell
                          key={privilege}
                          hold={reachOf(row, privilege)}
                          privilege={privilege}
                        />
                      ))}
                      <td class="cell-muted">
                        {through.length ? (
                          <span class="mono">{through.join(', ')}</span>
                        ) : (
                          'a group you may not see'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
