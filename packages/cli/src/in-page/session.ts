import { ident } from '@platform/vocabulary'

/**
 * The statement that makes this page one person, as a login is one token. The role is a name,
 * and it is quoted as one: a role may hold a quote of its own.
 */
export const sessionAuthorization = (role: string): string =>
  `SET SESSION AUTHORIZATION ${ident(role)}`
