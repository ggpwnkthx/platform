import { useId, useRef, useState } from 'preact/hooks'
import {
  type GrantInfo,
  type MembershipInfo,
  type RoleInfo,
  type SchemaGrantInfo,
  columnsOf,
  reach as readReach,
  tableOf,
  tablesIn,
} from '@platform/data'
import {
  grantChangeStatements,
  narrows,
  schemaGrantStatement,
  schemaPrivileges,
  type Wanted,
} from '@platform/vocabulary'
import { useLoad, useSession } from '../session.tsx'
import { Badge, Notice, Statement } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select } from '../ui/form.tsx'
import { PlusIcon } from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'
import {
  asked,
  count,
  drawn,
  everyone,
  granteesOf,
  heldBy,
  heldOf,
  holdOf,
  others,
  perField,
  reachesMore,
  reachOf,
  throughOf,
  wantedOf,
} from './model.ts'
import { sameWanted, toggleField } from './wishes.ts'
import { Legend, Mark, RoleLabel } from './rights.tsx'
import { useRunner } from './runner.tsx'

/** A role as an ACL names it: PUBLIC in capitals, whatever case it was typed in. */
const named = (text: string): string => {
  const name = text.trim()
  return name.toLowerCase() === 'public' ? everyone : name
}

const isSystemRole = (name: string) => name.startsWith('pg_')

/**
 * A key that changes each time something opens and stays while it closes, so that an editor
 * starts from what the database holds every time it is opened.
 */
export function useOpening(open: boolean): number {
  const opened = useRef(0)
  const was = useRef(false)
  if (open && !was.current) opened.current += 1
  was.current = open
  return opened.current
}

/** What was last asked for, kept while the drawer that shows it closes. */
export function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(value)
  if (value !== null) last.current = value
  return last.current
}

/**
 * Chooses a role by its name. The roles the reader may see are offered, and any other may be
 * typed: the database shows a reader only the roles they belong to, and a collection's owner
 * may still grant to one they cannot see.
 */
export function RoleInput({
  id,
  value,
  onChange,
  roles,
  without = [],
  withEveryone,
  placeholder = 'A role’s name',
}: {
  id: string
  value: string
  onChange: (name: string) => void
  roles: RoleInfo[]
  /** Roles left out of what is offered: the ones already there. */
  without?: string[]
  /** Offer PUBLIC, which is everyone. */
  withEveryone?: boolean
  placeholder?: string
}) {
  const list = useId()
  const offered = roles.filter((role) => !isSystemRole(role.name) && !without.includes(role.name))
  return (
    <>
      <Input
        id={id}
        mono
        list={list}
        value={value}
        autocomplete="off"
        spellcheck={false}
        placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id={list}>
        {withEveryone && !without.includes(everyone) && <option value={everyone}>everyone</option>}
        {offered.map((role) => (
          <option key={role.name} value={role.name}>
            {role.login ? 'user' : 'group'}
          </option>
        ))}
      </datalist>
    </>
  )
}

const modes = [
  { value: 'none', label: 'Not held' },
  { value: 'all', label: 'The whole collection' },
  { value: 'some', label: 'Chosen fields' },
] as const

const explains: Record<string, string> = {
  SELECT: 'Read rows, and name the fields in a filter or a sort.',
  INSERT: 'Add rows, setting the fields it holds.',
  UPDATE: 'Change the fields it holds in rows it reaches.',
  DELETE: 'Remove rows it reaches.',
  TRUNCATE: 'Empty the collection at once, past every row policy.',
  REFERENCES: 'Point a relation of another collection at this one.',
  TRIGGER: 'Attach a trigger to the collection.',
}

/** What the drawer is opened on: the collection, the role, or both; the rest is chosen in it. */
export interface GrantTarget {
  table?: string
  grantee?: string
}

/**
 * What one role holds on one collection, and the statements that change it. Each privilege
 * is not held, held on the whole collection, or held on chosen fields; the statements are
 * the difference between what the ACL records and what is asked for, and they run as the
 * reader, in one transaction.
 */
export function GrantDrawer({
  schema,
  target,
  grants,
  roles,
  memberships,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed. */
  target: GrantTarget | null
  /** The workspace's grants, as its ACLs record them. */
  grants: GrantInfo[]
  roles: RoleInfo[]
  memberships: MembershipInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <GrantEditor
      key={opening}
      open={target !== null}
      schema={schema}
      target={last ?? {}}
      grants={grants}
      roles={roles}
      memberships={memberships}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function GrantEditor({
  open,
  schema,
  target,
  grants,
  roles,
  memberships,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  target: GrantTarget
  grants: GrantInfo[]
  roles: RoleInfo[]
  memberships: MembershipInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const { catalog } = useSession()
  const runner = useRunner()
  const owned = tablesIn(catalog, schema).filter((t) => t.can_alter)
  const [table, setTable] = useState(target.table ?? owned[0]?.name ?? '')
  const [typed, setTyped] = useState(target.grantee ?? '')
  const [edits, setEdits] = useState<Record<string, Wanted>>({})
  const [option, setOption] = useState(false)
  const [withUsage, setWithUsage] = useState(true)
  const grantee = named(typed)
  const info = tableOf(catalog, schema, table)
  const workspace = catalog.schemas.find((s) => s.name === schema)
  const columns = columnsOf(catalog, schema, table).map((c) => c.name)
  const held = heldBy(grants, table, grantee)
  const wanted = (privilege: string): Wanted => edits[privilege] ?? wantedOf(held[privilege])
  const [more, setMore] = useState(() => others.some((p) => holdOf(held[p]) !== 'none'))
  const privileges = more ? [...drawn, ...others] : [...drawn]
  // The database's own answer for the role: what it reaches through its groups and PUBLIC, and
  // whether it may use the workspace at all.
  const answer = useLoad(
    open && grantee && table
      ? (db) => readReach(db, schema, { role: asked(grantee), table })
      : null,
    [open, schema, table, grantee, grants]
  )
  const reach = answer.data?.find((row) => row.role === asked(grantee) && row.table === table)
  const through = throughOf(grantee, table, grants, memberships)
  // Of the roles it inherits from, the ones the ACL gives this privilege to.
  const givers = (privilege: string) =>
    through.filter((giver) => holdOf(heldBy(grants, table, giver)[privilege]) !== 'none')
  const isOwner = info?.owner === grantee
  const set = (privilege: string, next: Wanted) => {
    const stored = wantedOf(held[privilege])
    const rest = { ...edits }
    if (sameWanted(next, stored)) delete rest[privilege]
    else rest[privilege] = next
    setEdits(rest)
  }
  const choose = (privilege: string, mode: string) => {
    if (mode === 'none' || mode === 'all') return set(privilege, mode)
    const now = wanted(privilege)
    // Narrowing the whole collection starts from every field, so that one may be taken out.
    set(privilege, now === 'all' ? [...columns] : now === 'none' ? [] : now)
  }
  const listed = privileges.filter((p) => Array.isArray(wanted(p)))
  let statements: string[] = []
  let problem: string | null = null
  try {
    statements =
      grantee && table && !isOwner
        ? grantChangeStatements({
            schema,
            table,
            grantee,
            held,
            wanted: edits,
            withGrantOption: option,
          })
        : []
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
  }
  const grantsSomething = statements.some((statement) => statement.startsWith('GRANT'))
  const holdsSomething = [...drawn, ...others].some((p) => wanted(p) !== 'none')
  // A grant on a collection is of no use to a role that may not use the workspace it is in.
  const lacksUsage = Boolean(reach && !reach.usage && holdsSomething)
  const mayGrantUsage = Boolean(workspace?.can_alter)
  if (lacksUsage && mayGrantUsage && withUsage && (statements.length || !problem))
    statements = [schemaGrantStatement(schema, ['USAGE'], grantee), ...statements]
  const fixedTable = Boolean(target.table)
  const fixedGrantee = Boolean(target.grantee)
  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={
        <>
          {grantee ? <span class="mono">{grantee}</span> : 'A role'} on{' '}
          <span class="mono">{table || 'a collection'}</span>
        </>
      }
      subtitle="What the role holds on this collection itself. The database lets the collection’s owner change it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone={statements.length && !grantsSomething ? 'danger' : 'primary'}
            busy={runner.busy}
            disabled={!statements.length || !!problem}
            onClick={async () => {
              if (await runner.runStatements(statements, `Changed what ${grantee} holds`)) {
                onDone()
                onClose()
              }
            }}
          >
            {statements.length && !grantsSomething ? 'Revoke' : 'Apply'}
          </Button>
        </>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {(!fixedGrantee || !fixedTable) && (
        <div class="form">
          {!fixedGrantee && (
            <Field
              label="Role"
              id="grant-role"
              required
              wide={fixedTable}
              hint="A group is granted once for all its members. PUBLIC is everyone."
            >
              <RoleInput
                id="grant-role"
                value={typed}
                roles={roles}
                withEveryone
                onChange={(name) => {
                  setTyped(name)
                  setEdits({})
                }}
              />
            </Field>
          )}
          {!fixedTable && (
            <Field label="Collection" id="grant-table" required wide={fixedGrantee}>
              <Select
                id="grant-table"
                value={table}
                onChange={(e) => {
                  setTable(e.currentTarget.value)
                  setEdits({})
                }}
              >
                {owned.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
      {isOwner ? (
        <Notice tone="info" title={`${grantee} owns ${table}`}>
          An owner holds every privilege on what it owns, and its row policies do not filter it.
          There is nothing to grant.
        </Notice>
      ) : (
        <>
          <section class="drawer-section">
            <h3 class="drawer-title">Privileges</h3>
            <ul class="grant-rows">
              {privileges.map((privilege) => {
                const now = wanted(privilege)
                const mode = now === 'none' ? 'none' : now === 'all' ? 'all' : 'some'
                const own = holdOf(held[privilege])
                const reached = reachOf(reach, privilege)
                return (
                  <li key={privilege} class="grant-row">
                    <Mark hold={mode} label="" />
                    <div class="grant-name">
                      <label class="mono" for={`grant-${privilege}`}>
                        {privilege}
                      </label>
                      <small>{explains[privilege]}</small>
                      {reachesMore(reached, own) && (
                        <small class="grant-through">
                          Already reaches{' '}
                          {reached === 'all' ? 'the whole collection' : 'some fields'} through{' '}
                          {givers(privilege).join(', ') || 'a group or PUBLIC'}.
                        </small>
                      )}
                    </div>
                    <Select
                      id={`grant-${privilege}`}
                      value={mode}
                      onChange={(e) => choose(privilege, e.currentTarget.value)}
                    >
                      {modes
                        .filter((m) => m.value !== 'some' || narrows(privilege))
                        .map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.value === 'some' && Array.isArray(now)
                              ? `${now.length} of ${count(columns.length, 'field')}`
                              : m.label}
                          </option>
                        ))}
                    </Select>
                  </li>
                )
              })}
            </ul>
            {!more && (
              <div class="row-actions row-start">
                <Button
                  small
                  tone="ghost"
                  icon={<PlusIcon size={14} />}
                  onClick={() => setMore(true)}
                >
                  TRUNCATE, REFERENCES, TRIGGER
                </Button>
              </div>
            )}
          </section>
          {listed.length > 0 && (
            <section class="drawer-section">
              <h3 class="drawer-title">Fields</h3>
              <p class="drawer-note">
                A privilege limited to fields names them: a field added to the collection later is
                not among them until it is granted too.
              </p>
              <div class="grid-wrap">
                <table class="grid grid-tight">
                  <thead>
                    <tr>
                      <th>Field</th>
                      {listed.map((privilege) => {
                        const chosen = wanted(privilege) as string[]
                        const every = chosen.length === columns.length
                        return (
                          <th key={privilege} class="matrix-cell">
                            <span class="mono">{privilege}</span>
                            <button
                              type="button"
                              class="link-quiet"
                              onClick={() => set(privilege, every ? [] : [...columns])}
                            >
                              {every ? 'none' : 'all'}
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((column) => (
                      <tr key={column}>
                        <td class="mono">{column}</td>
                        {listed.map((privilege) => {
                          const chosen = wanted(privilege) as string[]
                          return (
                            <td key={privilege} class="matrix-cell">
                              <input
                                type="checkbox"
                                aria-label={`${privilege} on ${column}`}
                                checked={chosen.includes(column)}
                                onChange={(e) =>
                                  set(
                                    privilege,
                                    e.currentTarget.checked
                                      ? [...chosen, column]
                                      : chosen.filter((name) => name !== column)
                                  )
                                }
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <Checkbox
            checked={option}
            onChange={setOption}
            label="With grant option"
            hint="The role may pass on what is newly granted here."
          />
          {lacksUsage &&
            (mayGrantUsage ? (
              <Notice tone="warning" title={`${grantee} may not use ${schema} yet`}>
                Without USAGE on the workspace the database refuses every statement on a collection
                inside, whatever is granted here.
                <Checkbox
                  checked={withUsage}
                  onChange={setWithUsage}
                  label={`Grant USAGE on ${schema} too`}
                />
              </Notice>
            ) : (
              <Notice tone="warning" title={`${grantee} may not use ${schema} yet`}>
                Without USAGE on the workspace the database refuses every statement on a collection
                inside. Its owner, {workspace?.owner}, grants it.
              </Notice>
            ))}
          {info?.rls && grantsSomething && (
            <Notice tone="info" title="Row security is on">
              A grant says which statements the role may run; the row policies of {table} say which
              rows they reach. A role no policy applies to reaches no row.
            </Notice>
          )}
        </>
      )}
      {problem ? (
        <Notice tone="warning" title={problem} />
      ) : statements.length ? (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      ) : (
        !isOwner && (
          <p class="drawer-note">
            {grantee ? 'Nothing changes yet: the ACL already says this.' : 'Choose a role.'}
          </p>
        )
      )}
    </Drawer>
  )
}

/**
 * Who holds what on one field, and the statements that change it. A privilege held on the
 * whole collection covers the field with it; taking the field out limits the privilege to
 * the other fields, by name.
 */
export function FieldAccessDrawer({
  schema,
  table,
  column,
  grants,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  table: string
  /** Null while the drawer is closed. */
  column: string | null
  grants: GrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(column !== null)
  const last = useLast(column)
  return (
    <FieldAccessEditor
      key={opening}
      open={column !== null}
      schema={schema}
      table={table}
      column={last ?? ''}
      grants={grants}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function FieldAccessEditor({
  open,
  schema,
  table,
  column,
  grants,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  table: string
  column: string
  grants: GrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const { catalog } = useSession()
  const runner = useRunner()
  const info = tableOf(catalog, schema, table)
  const owner = Boolean(info?.can_alter)
  const every = columnsOf(catalog, schema, table).map((c) => c.name)
  const [edits, setEdits] = useState<Record<string, Record<string, Wanted>>>({})
  const [added, setAdded] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const existing = granteesOf(grants, table, info?.owner ?? '')
  const grantees = [...existing, ...added.filter((name) => !existing.includes(name))]
  const wanted = (grantee: string, privilege: string): Wanted =>
    edits[grantee]?.[privilege] ?? wantedOf(heldBy(grants, table, grantee)[privilege])
  const holds = (grantee: string, privilege: string): boolean => {
    const now = wanted(grantee, privilege)
    return now === 'all' || (Array.isArray(now) && now.includes(column))
  }
  const toggle = (grantee: string, privilege: string, on: boolean) => {
    const stored = wantedOf(heldBy(grants, table, grantee)[privilege])
    const next = toggleField(wanted(grantee, privilege), privilege, column, on, every)
    const mine = { ...edits[grantee] }
    if (sameWanted(next, stored)) delete mine[privilege]
    else mine[privilege] = next
    setEdits({ ...edits, [grantee]: mine })
  }
  let statements: string[] = []
  let problem: string | null = null
  try {
    statements = grantees.flatMap((grantee) =>
      grantChangeStatements({
        schema,
        table,
        grantee,
        held: heldBy(grants, table, grantee),
        wanted: edits[grantee] ?? {},
      })
    )
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
  }
  const narrowed = grantees.some((grantee) =>
    perField.some(
      (privilege) =>
        heldOf(heldBy(grants, table, grantee), privilege).whole &&
        Array.isArray(wanted(grantee, privilege))
    )
  )
  const add = () => {
    const name = named(adding)
    if (!name || grantees.includes(name) || name === info?.owner) return
    setAdded([...added, name])
    setAdding('')
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <>
          Access to <span class="mono">{column}</span>
        </>
      }
      subtitle={`Who may read and write this field of ${table}. A field’s metadata is read by the same roles.`}
      footer={
        owner ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!statements.length || !!problem}
              onClick={async () => {
                if (await runner.runStatements(statements, `Changed who holds ${column}`)) {
                  onDone()
                  onClose()
                }
              }}
            >
              Apply
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <div class="grid-wrap">
        <table class="grid grid-tight">
          <thead>
            <tr>
              <th>Role</th>
              {perField.map((privilege) => (
                <th key={privilege} class="matrix-cell mono">
                  {privilege}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {info && (
              <tr>
                <td>
                  <RoleLabel name={info.owner} roles={roles} plain />
                  <Badge tone="outline">owner</Badge>
                </td>
                {perField.map((privilege) => (
                  <td key={privilege} class="matrix-cell">
                    <Mark hold="all" label={`${privilege}: the owner holds every privilege`} />
                  </td>
                ))}
              </tr>
            )}
            {grantees.map((grantee) => {
              const held = heldBy(grants, table, grantee)
              return (
                <tr key={grantee}>
                  <td>
                    <RoleLabel name={grantee} roles={roles} plain />
                  </td>
                  {perField.map((privilege) => {
                    const whole = heldOf(held, privilege).whole
                    const on = holds(grantee, privilege)
                    return (
                      <td key={privilege} class="matrix-cell">
                        {owner ? (
                          <input
                            type="checkbox"
                            aria-label={`${privilege} on ${column} for ${grantee}`}
                            checked={on}
                            onChange={(e) => toggle(grantee, privilege, e.currentTarget.checked)}
                          />
                        ) : (
                          <Mark
                            hold={on ? 'all' : 'none'}
                            label={`${privilege}: ${on ? 'held' : 'not held'}`}
                          />
                        )}
                        {whole && wanted(grantee, privilege) === 'all' && (
                          <small class="cell-caption">whole collection</small>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!owner && (
          <div class="grid-note">
            <Legend of="field" />
          </div>
        )}
      </div>
      {!grantees.length && (
        <p class="drawer-note">
          No role is granted this field: only the owner of {table} reads and writes it.
        </p>
      )}
      {owner && (
        <div class="form">
          <Field
            label="Another role"
            id="field-role"
            wide
            hint="A role with nothing on this collection yet. PUBLIC is everyone."
          >
            <div class="input-row">
              <RoleInput
                id="field-role"
                value={adding}
                roles={roles}
                without={[...grantees, info?.owner ?? '']}
                withEveryone
                onChange={setAdding}
              />
              <Button icon={<PlusIcon size={16} />} disabled={!named(adding)} onClick={add}>
                Add
              </Button>
            </div>
          </Field>
        </div>
      )}
      {narrowed && (
        <Notice tone="warning" title="A privilege on the whole collection becomes a list of fields">
          The database cannot take one field out of a grant on the whole collection, so the grant is
          revoked and made again on the other fields by name. A field added later is not among them
          until it is granted too.
        </Notice>
      )}
      {owner &&
        (problem ? (
          <Notice tone="warning" title={problem} />
        ) : statements.length ? (
          <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
        ) : null)}
      {!owner && (
        <p class="drawer-note">
          The database gives grants on {table} to its owner, {info?.owner}, and its members.
        </p>
      )}
    </Drawer>
  )
}

/**
 * What one role holds on the workspace's own schema: USAGE, without which nothing inside is
 * reached, and CREATE, which makes collections in it.
 */
export function SchemaGrantDrawer({
  schema,
  target,
  grants,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed; the role when it is opened on one. */
  target: { grantee?: string } | null
  grants: SchemaGrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <SchemaGrantEditor
      key={opening}
      open={target !== null}
      schema={schema}
      fixed={last?.grantee}
      grants={grants}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

const schemaExplains: Record<string, string> = {
  USAGE: 'Reach the collections inside, each under its own grants and row policies.',
  CREATE: 'Make collections here, and own the ones it makes.',
}

function SchemaGrantEditor({
  open,
  schema,
  fixed,
  grants,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  fixed?: string
  grants: SchemaGrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const runner = useRunner()
  const [typed, setTyped] = useState(fixed ?? '')
  const [edits, setEdits] = useState<Record<string, boolean>>({})
  const grantee = named(typed)
  const held = (privilege: string) =>
    grants.some((g) => g.grantee === grantee && g.privilege === privilege)
  // A role with nothing here yet is most often given the workspace to use.
  const fresh = !schemaPrivileges.some(held)
  const wanted = (privilege: string) =>
    edits[privilege] ?? (held(privilege) || (fresh && privilege === 'USAGE'))
  const revoked = schemaPrivileges.filter((p) => held(p) && !wanted(p))
  const granted = schemaPrivileges.filter((p) => !held(p) && wanted(p))
  let statements: string[] = []
  let problem: string | null = null
  try {
    statements = grantee
      ? [
          ...(revoked.length ? [schemaGrantStatement(schema, revoked, grantee, true)] : []),
          ...(granted.length ? [schemaGrantStatement(schema, granted, grantee)] : []),
        ]
      : []
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <>
          {grantee ? <span class="mono">{grantee}</span> : 'A role'} on the workspace{' '}
          <span class="mono">{schema}</span>
        </>
      }
      subtitle="What the role holds on the workspace’s own schema. The database lets the workspace’s owner change it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone={statements.length && !granted.length ? 'danger' : 'primary'}
            busy={runner.busy}
            disabled={!statements.length || !!problem}
            onClick={async () => {
              if (await runner.runStatements(statements, `Changed what ${grantee} holds`)) {
                onDone()
                onClose()
              }
            }}
          >
            {statements.length && !granted.length ? 'Revoke' : 'Apply'}
          </Button>
        </>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {!fixed && (
        <div class="form">
          <Field
            label="Role"
            id="schema-role"
            required
            wide
            hint="A group is granted once for all its members. PUBLIC is everyone."
          >
            <RoleInput
              id="schema-role"
              value={typed}
              roles={roles}
              withEveryone
              onChange={(name) => {
                setTyped(name)
                setEdits({})
              }}
            />
          </Field>
        </div>
      )}
      <section class="drawer-section">
        <h3 class="drawer-title">Privileges</h3>
        <div class="grant-checks">
          {schemaPrivileges.map((privilege) => (
            <Checkbox
              key={privilege}
              checked={wanted(privilege)}
              onChange={(on) => setEdits({ ...edits, [privilege]: on })}
              label={<span class="mono">{privilege}</span>}
              hint={schemaExplains[privilege]}
            />
          ))}
        </div>
      </section>
      {revoked.includes('USAGE') && (
        <Notice tone="warning" title={`${grantee} will reach nothing in ${schema}`}>
          Its grants on the collections inside stay in their ACLs, and the database refuses every
          statement on them until USAGE is granted again.
        </Notice>
      )}
      {problem ? (
        <Notice tone="warning" title={problem} />
      ) : statements.length ? (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      ) : (
        <p class="drawer-note">
          {grantee ? 'Nothing changes yet: the ACL already says this.' : 'Choose a role.'}
        </p>
      )}
    </Drawer>
  )
}
