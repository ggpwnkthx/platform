import { databaseGrantStatement, databasePrivileges } from '@platform/core'
import { type Granted, grantKind } from './granted.tsx'

/** Who may connect to the database, make schemas in it, and make temporary tables. */
export const databaseGrants = grantKind<Granted, object>({
  name: 'database-grants',
  title: 'Database privileges',
  note: 'CONNECT lets a role connect to this database; CREATE lets it create schemas; TEMPORARY lets it create temporary tables.',
  noun: 'privileges on the database',
  empty: 'No role but the database’s owner holds a privilege on it.',
  view: ['access_database_grants', [], '1, 2'],
  may: (_where, { identity }) => identity.is_operator,
  privileges: () => databasePrivileges,
  start: () => ({ privileges: ['CONNECT'] }),
  statement: (grant, revoke, _where, { identity }) =>
    databaseGrantStatement(identity.database, grant, revoke),
})
