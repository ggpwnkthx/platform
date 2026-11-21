/**
 * The access the platform grants, written once.
 *
 * A privilege, a row policy, a membership and a role are the same things whether the
 * operator's tools grant them from a manifest or the interface grants them in the browser:
 * the same statement, with the same rules about what may be limited to which fields. The
 * operator's tools converge a database on a manifest; the interface shows the reader the
 * statement before it runs. The statement itself is written here, once, so that the two
 * cannot drift apart.
 */
export * from './access/grants.ts'
export * from './access/policies.ts'
export * from './access/privileges.ts'
export * from './access/roles.ts'
export * from './access/workspace.ts'
