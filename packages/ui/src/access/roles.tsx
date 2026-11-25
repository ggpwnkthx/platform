import { Box } from '@mui/material'
import {
  createRoleStatements,
  dropRoleStatement,
  type MembershipInfo,
  membershipStatement,
  reservedRole,
  type RoleInfo,
  roles as readRoles,
} from '@platform/core'
import { BooleanInput, SelectArrayInput, SelectInput, TextInput, useGetList } from 'react-admin'
import { Link } from 'react-router-dom'
import { defineKind } from '../data/kinds.ts'
import { RoleName, Tag } from '../kit/marks.tsx'
import { mono } from '../model/collections.tsx'
/** Who there is: PostgreSQL's roles and their memberships, as the caller may see them. */
export const named = (names: readonly string[]) => names.map((id) => ({ id, name: id }))
const everyRole = { pagination: { page: 1, perPage: 1000 } }
/** The roles the caller may see, to choose one of; any other may be typed where PostgreSQL knows it. */
export function RoleInput(props: {
  source: string
  label: string
  many?: boolean
  groups?: boolean
  everyone?: boolean
  /** Only the roles the reader may admit members to. */
  admitted?: boolean
}) {
  const roles = useGetList<RoleInfo & { id: string }>('roles', everyRole)
  const known = (roles.data ?? [])
    .filter(
      (r) => !reservedRole(r.name) && (!props.groups || !r.login) && (!props.admitted || r.admits)
    )
    .map((r) => r.name)
  const Input = props.many ? SelectArrayInput : SelectInput
  return (
    <Input
      source={props.source}
      label={props.label}
      choices={named(props.everyone ? [...known, 'public'] : known)}
      {...mono}
    />
  )
}
/** A role, as a link to its page: a group where PostgreSQL says it may not sign in. */
export function Role({ name }: { name: string }) {
  const known = useGetList<RoleInfo & { id: string }>('roles', everyRole).data?.find(
    (role) => role.name === name
  )
  return (
    <Box
      component={Link}
      to={`/roles/${encodeURIComponent(name)}`}
      sx={{ color: 'inherit', textDecoration: 'none' }}
    >
      <RoleName name={name} group={known ? !known.login : undefined} />
    </Box>
  )
}

export const roles = defineKind<RoleInfo, object, { name: string; login: boolean }>({
  name: 'roles',
  title: 'Roles',
  note: 'A user is a person who signs in, named by their email; a group gathers users so that rights are granted once. PostgreSQL calls both roles. You see the roles you may use; an operator sees them all.',
  noun: 'role',
  empty: 'No role that you may see.',
  read: async (db) => (await readRoles(db)).roles.filter((r) => !/^pg_/.test(r.name)),
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Role', render: (row) => <Role name={row.name} /> },
    {
      source: 'login',
      label: 'Kind',
      render: (row) => (row.login ? 'User: may sign in' : 'Group'),
    },
    {
      source: 'superuser',
      label: 'Attributes',
      render: (row) => (
        <>
          {row.superuser && <Tag color="warning">SUPERUSER</Tag>}{' '}
          {row.create_role && <Tag>CREATEROLE</Tag>}{' '}
          {row.bypass_rls && <Tag color="warning">BYPASSRLS</Tag>}{' '}
          {row.admits && <Tag color="primary">you admit members</Tag>}
        </>
      ),
    },
  ],
  may: (_where, { identity }) => identity.is_operator,
  Inputs: () => (
    <>
      <TextInput source="name" label="Name: a person's email, or a group's name" {...mono} />
      <BooleanInput
        source="login"
        label="A person who signs in (a user). Off, it is a group"
        helperText={false}
      />
    </>
  ),
  defaults: () => ({ login: false }),
  create: (form) => createRoleStatements({ name: form.name ?? '', login: !!form.login }),
  remove: (row) => [dropRoleStatement(row.name)],
})

export const memberships = defineKind<
  MembershipInfo,
  { role?: string; member?: string },
  { role: string; member: string; admin: boolean }
>({
  name: 'memberships',
  title: 'Memberships',
  note: 'Who belongs to which group, as far as you may see.',
  noun: 'membership',
  empty: 'None that you may see.',
  read: async (db, where) =>
    (await readRoles(db)).memberships.filter(
      (m) => (!where.role || m.role === where.role) && (!where.member || m.member === where.member)
    ),
  key: (row) => `${row.member} in ${row.role}`,
  columns: [
    { source: 'member', label: 'Member', render: (row) => <Role name={row.member} /> },
    { source: 'role', label: 'Belongs to', render: (row) => <Role name={row.role} /> },
    {
      source: 'admin_option',
      label: 'Admits others',
      render: (row) => (row.admin_option ? <Tag color="primary">WITH ADMIN OPTION</Tag> : null),
    },
  ],
  // PostgreSQL's answer: the roles the caller holds WITH ADMIN OPTION.
  may: (where, { identity }) =>
    where.role ? identity.admits.includes(where.role) : identity.admits.length > 0,
  mayRow: (row, _where, { identity }) => identity.admits.includes(row.role),
  Inputs: ({ where }) => (
    <>
      {!where.member && <RoleInput source="member" label="Member" />}
      {!where.role && <RoleInput source="role" label="Belongs to" groups admitted />}
      <BooleanInput source="admin" label="May admit others to it" helperText={false} />
    </>
  ),
  defaults: (where) => ({ ...where, admin: false }),
  create: (form) => [
    membershipStatement({ role: form.role, member: form.member, admin: form.admin }),
  ],
  remove: (row) => [membershipStatement(row, true)],
})
