/**
 * The role catalogs are PostgreSQL's, and their access rules belong to the cluster superuser.
 * These statements are what hides them from ordinary connections, so that a psql session no
 * longer reads the whole role graph the way it does by default.
 *
 * Two catalogs, two scopes: pg_auth_members is a shared catalog, so its rule reaches every
 * database in the cluster; pg_roles and pg_user are per-database views, so theirs reaches this
 * database alone. Operators keep the whole of both.
 */
export type HardenMode = 'strict' | 'keep-names' | 'restore'

const operators = 'platform_core, platform_admins'

export const hardenSql = (mode: HardenMode): string => {
  if (mode === 'restore')
    return `-- Restore PostgreSQL's default: every connected user reads the role catalogs again.
GRANT SELECT ON pg_auth_members, pg_roles, pg_user TO PUBLIC;
`
  const names =
    mode === 'keep-names'
      ? `-- Role names stay readable, so pg_dump and GRANT statements keep working for everyone.
GRANT SELECT (oid, rolname) ON pg_roles TO PUBLIC;
GRANT SELECT (usename, usesysid) ON pg_user TO PUBLIC;
`
      : ''
  return `-- Hide the membership graph from ordinary connections. This catalog is shared, so the
-- rule reaches every database in this cluster.
REVOKE SELECT ON pg_auth_members FROM PUBLIC;
-- Hide the role list and its attributes. These views belong to this database alone.
REVOKE SELECT ON pg_roles FROM PUBLIC;
REVOKE SELECT ON pg_user FROM PUBLIC;
${names}-- The operators keep the whole catalog: they administer roles.
GRANT SELECT ON pg_auth_members, pg_roles, pg_user TO ${operators};
`
}

export const hardenNotes = (mode: HardenMode): string[] => {
  if (mode === 'restore')
    return [
      'Every connected user reads the role catalogs again, as PostgreSQL ships them.',
      'Run `bun run cli harden <deployment>` to hide them once more.',
    ]
  const notes = [
    'Ordinary connections can no longer read pg_auth_members: who belongs to which group.',
    'Ordinary connections can no longer read pg_roles or pg_user: the role list and its attributes.',
    'pg_auth_members is a shared catalog, so that rule reaches every database in the cluster.',
  ]
  if (mode === 'keep-names')
    notes.push('Role names remain readable, so pg_dump and GRANT statements keep working.')
  else notes.push('psql \\du and pg_dump need a platform operator or superuser from now on.')
  notes.push(
    'information_schema.applicable_roles still lists the roles of the calling user, and the console shows the caller’s own roles and memberships.'
  )
  return notes
}
