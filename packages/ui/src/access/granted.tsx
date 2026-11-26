import type { ReactNode } from 'react'
import { BooleanInput, SelectArrayInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { type Column, type Ctx, choices, defineKind, fromView, mono } from '../data/kinds.ts'
import { Tag } from '../kit/marks.tsx'
import { Role, RoleInput } from './roles.tsx'

/**
 * Grants beyond the tables: what new objects start with (default privileges), what is
 * held on a schema's sequences, functions and types, and what is held on the database.
 * Each row is one role's privileges on one thing, read from the ACLs; a change is a GRANT or a
 * REVOKE that PostgreSQL judges, and a grant it only warns changed nothing is a refusal.
 */
export interface Granted {
  grantee: string
  privileges: string[]
  grantable: boolean
}
type Held<Row> = Row & { privilege: string }
/** The ACL's rows, one privilege each, gathered into one row per role and thing. */
function gathered<Row extends Granted>(rows: Held<Row>[], by: (row: Row) => string) {
  const out = new Map<string, Row>()
  for (const row of rows) {
    const key = `${by(row)}\0${row.grantee}`
    const held = out.get(key) ?? { ...row, privileges: [], grantable: false }
    held.privileges.push(row.privilege)
    held.grantable ||= row.grantable
    out.set(key, held)
  }
  return [...out.values()]
}
const holds = {
  source: 'privileges',
  label: 'Holds',
  wide: true,
  render: (row: Granted) => (
    <>
      {row.privileges.map((p) => (
        <Tag key={p}>{p}</Tag>
      ))}{' '}
      {row.grantable && <Tag color="primary">WITH GRANT OPTION</Tag>}
    </>
  ),
}
const grantee = {
  source: 'grantee',
  label: 'Role',
  render: (row: Granted) => <Role name={row.grantee} />,
}

/**
 * The difference between what a row holds and what the form asks: a REVOKE of what is given
 * up, then a GRANT of what is added, or of everything kept where the grant option changes.
 */
function regrant(
  row: Granted,
  form: { privileges?: string[]; grantable?: boolean },
  statement: (privileges: string[], revoke: boolean, grantable?: boolean) => string
) {
  const gone = row.privileges.filter((p) => !form.privileges?.includes(p))
  const added = (form.privileges ?? []).filter(
    (p) => !row.privileges.includes(p) || !!form.grantable !== row.grantable
  )
  return [
    ...(gone.length ? [statement(gone, true)] : []),
    ...(added.length ? [statement(added, false, form.grantable)] : []),
  ]
}

/** What one kind of grant says of itself; the rest of the kind is the same for all of them. */
interface GrantSpec<Row extends Granted, Where> {
  name: string
  title: string
  note: string
  noun: string
  empty: string
  /** Its access view, the parts of the place it is read by, and its order. */
  view: [string, string[], string]
  /** What a row is granted on, beside its grantee. */
  on?(row: Row): string
  columns?: Column<Row>[]
  may(where: Where, ctx: Ctx): boolean
  /** What a new grant asks before whom it is for: the thing it is on. */
  On?(props: { where: Where }): ReactNode
  /** The privileges the thing chosen can hold. */
  privileges(form: Partial<Row>): readonly string[]
  /** What a new grant starts with. */
  start(where: Where, ctx: Ctx): Partial<Row>
  statement(grant: Row, revoke: boolean, where: Where, ctx: Ctx): string
}
export function grantKind<Row extends Granted, Where extends object>(spec: GrantSpec<Row, Where>) {
  const on = spec.on ?? (() => '')
  const { name, title, note, noun, empty, may, statement } = spec
  return defineKind<Row, Where, Row>({
    ...{ name, title, note, noun, empty, may },
    verbs: { create: 'Grant', update: 'Grant or revoke', remove: 'Revoke' },
    read: async (db, where) => gathered(await fromView<Held<Row>>(...spec.view)(db, where), on),
    key: (row) => `${on(row)} ${row.grantee}`.trim(),
    columns: [...(spec.columns ?? []), grantee, holds],
    // biome-ignore lint/correctness/noComponentHookFactories: made once per kind, as a module loads
    Inputs: ({ where, row }) => (
      <>
        {!row && spec.On && <spec.On where={where} />}
        {!row && <RoleInput source="grantee" label="Receives" everyone />}
        <Privileges of={spec.privileges} />
        <BooleanInput source="grantable" label="WITH GRANT OPTION" helperText={false} />
      </>
    ),
    defaults: (where, row, ctx) => (row ? { ...row } : spec.start(where, ctx)),
    create: (form, where, ctx) => [statement(form, false, where, ctx)],
    update: (form, where, row, ctx) =>
      regrant(row, form, (privileges, revoke, grantable = false) =>
        statement({ ...row, privileges, grantable }, revoke, where, ctx)
      ),
    remove: (row, where, ctx) => [statement(row, true, where, ctx)],
  })
}
function Privileges<Row>({ of }: { of(form: Partial<Row>): readonly string[] }) {
  const form = useWatch() as Partial<Row>
  return (
    <SelectArrayInput
      source="privileges"
      label="Privileges"
      choices={choices(of(form))}
      {...mono}
    />
  )
}
