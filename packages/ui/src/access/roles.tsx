import { Box } from '@mui/material'
import {
  createRoleStatements,
  platformUsers,
  renameRoleStatement,
  roleAttributesStatement,
  dropRoleStatement,
  reservedRole,
  type RoleInfo,
  roles as readRoles,
} from '@platform/core'
import {
  BooleanInput,
  NumberInput,
  SelectArrayInput,
  SelectInput,
  TextInput,
  useGetList,
} from 'react-admin'
import { Link } from 'react-router-dom'
import { choices, defineKind, mono } from '../data/kinds.ts'
import { RoleName, Tag } from '../kit/marks.tsx'
/** Who there is: PostgreSQL's roles and their memberships, as the caller may see them. */
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
      choices={choices(props.everyone ? [...known, 'public'] : known)}
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

type RoleRow = RoleInfo & { user: boolean }
type RoleForm = {
  name: string
  login: boolean
  create_role: boolean
  inherit: boolean
  connection_limit: number
}
export const roles = defineKind<RoleRow, object, RoleForm>({
  name: 'roles',
  title: 'Roles',
  note: 'Database roles. A role with LOGIN signs in, and is named by a person’s email; a role with NOLOGIN is a group role whose privileges its members inherit. You see the roles you are a member of; an operator sees them all.',
  noun: 'role',
  empty: 'No role that you may see.',
  async read(db) {
    const { roles, memberships } = await readRoles(db)
    const users = new Set(memberships.filter((m) => m.role === platformUsers).map((m) => m.member))
    return roles.filter((r) => !/^pg_/.test(r.name)).map((r) => ({ ...r, user: users.has(r.name) }))
  },
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Role', render: (row) => <Role name={row.name} /> },
    {
      source: 'login',
      label: 'Kind',
      render: (row) => (row.login ? 'LOGIN' : 'NOLOGIN'),
    },
    {
      source: 'superuser',
      label: 'Attributes',
      render: (row) => (
        <>
          {row.superuser && <Tag color="warning">SUPERUSER</Tag>}{' '}
          {row.create_role && <Tag>CREATEROLE</Tag>}{' '}
          {row.bypass_rls && <Tag color="warning">BYPASSRLS</Tag>}{' '}
          {!row.inherit && <Tag>NOINHERIT</Tag>}{' '}
          {row.connection_limit >= 0 && <Tag>{`${row.connection_limit} sessions at most`}</Tag>}{' '}
          {row.admits && <Tag color="primary">you admit members</Tag>}
        </>
      ),
    },
  ],
  may: (_where, { identity }) => identity.is_operator,
  // PostgreSQL alters a role for whoever holds CREATEROLE and ADMIN OPTION on it.
  mayRow: (row, _where, { identity }) =>
    identity.is_operator && row.admits && !reservedRole(row.name),
  Inputs: ({ row }) => (
    <>
      <TextInput source="name" label="Role name" {...mono} />
      <BooleanInput source="login" label="LOGIN (off: NOLOGIN, a group role)" helperText={false} />
      {row && (
        <>
          <BooleanInput source="create_role" label="CREATEROLE" helperText={false} />
          <BooleanInput source="inherit" label="INHERIT" helperText={false} />
          <NumberInput
            source="connection_limit"
            label="CONNECTION LIMIT (-1: none)"
            helperText={false}
          />
        </>
      )}
    </>
  ),
  defaults: (_where, row) =>
    row
      ? {
          name: row.name,
          login: row.login,
          create_role: row.create_role,
          inherit: row.inherit,
          connection_limit: row.connection_limit,
        }
      : { login: false },
  create: (form) => createRoleStatements({ name: form.name ?? '', login: !!form.login }),
  update(form, _where, row) {
    const out: string[] = []
    const attributes = roleAttributesStatement(row.name, row, {
      ...form,
      connection_limit: form.connection_limit ?? -1,
    })
    if (attributes) out.push(attributes)
    // A person can sign in once they belong to the platform's users.
    if (form.login && !row.user) out.push(createRoleStatements({ name: row.name, login: true })[1]!)
    const name = form.name?.trim() || row.name
    if (name !== row.name) out.push(renameRoleStatement(row.name, name))
    return out
  },
  loses: () => 'PostgreSQL refuses while the role owns anything or holds a right: those go first.',
  remove: (row) => [dropRoleStatement(row.name)],
})
