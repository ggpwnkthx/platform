import { type MembershipInfo, membershipStatement, roles as readRoles } from '@platform/core'
import { BooleanInput } from 'react-admin'
import { defineKind } from '../data/kinds.ts'
import { Tag } from '../kit/marks.tsx'
import { Role, RoleInput } from './roles.tsx'

/** Who belongs to which group: PostgreSQL's memberships, as the caller may see them. */
export const memberships = defineKind<
  MembershipInfo,
  { role?: string; member?: string },
  { role: string; member: string; admin: boolean }
>({
  name: 'memberships',
  title: 'Memberships',
  note: 'Which role is a member of which, as far as you may see (pg_auth_members).',
  noun: 'role membership',
  verbs: { create: 'Grant', remove: 'Revoke' },
  empty: 'None that you may see.',
  read: async (db, where) =>
    (await readRoles(db)).memberships.filter(
      (m) => (!where.role || m.role === where.role) && (!where.member || m.member === where.member)
    ),
  key: (row) => `${row.member} in ${row.role}`,
  columns: [
    { source: 'member', label: 'Member', render: (row) => <Role name={row.member} /> },
    { source: 'role', label: 'Member of', render: (row) => <Role name={row.role} /> },
    {
      source: 'admin_option',
      label: 'ADMIN OPTION',
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
      {!where.role && <RoleInput source="role" label="Member of" groups admitted />}
      <BooleanInput source="admin" label="WITH ADMIN OPTION" helperText={false} />
    </>
  ),
  defaults: (where) => ({ ...where, admin: false }),
  create: (form) => [
    membershipStatement({ role: form.role, member: form.member, admin: form.admin }),
  ],
  remove: (row) => [membershipStatement(row, true)],
})
