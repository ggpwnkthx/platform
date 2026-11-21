import { role } from '../core.ts'
import { InvalidName } from '../errors.ts'

/** The privileges a collection may carry, as PostgreSQL writes them. */
export const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const

/**
 * The privileges PostgreSQL may limit to fields. The others always cover the whole
 * collection: a row that may be deleted is deleted whatever its fields say.
 */
export const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const

/** The privileges a workspace's schema may carry. */
export const schemaPrivileges = ['USAGE', 'CREATE'] as const

/**
 * The same privileges as a manifest writes them, in lower case. A manifest is written by
 * hand, and PostgreSQL writes its privileges in capitals; these are the two spellings of
 * one vocabulary, kept side by side so that they cannot drift apart.
 */
export const tablePrivilegeNames = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'all',
] as const

export const schemaPrivilegeNames = ['usage', 'create', 'all'] as const

export const columnPrivilegeNames = ['select', 'insert', 'update', 'references'] as const

/** Every privilege at once. PostgreSQL takes no field list with it. */
export const allPrivileges = 'ALL PRIVILEGES'

/** A privilege as PostgreSQL writes it, whatever case it was written in. */
export function privilege(name: string): string {
  const upper = name.trim().toUpperCase()
  if (upper === 'ALL') return allPrivileges
  return upper
}

/** Who a statement names: PUBLIC is PostgreSQL's own word for everyone. */
export function grantee(name: string): string {
  const who = name.trim()
  if (!who) throw new InvalidName('Choose who receives it')
  return who.toLowerCase() === 'public' ? 'PUBLIC' : role(who)
}

/** The actions a relation's foreign key may take when the row it points at goes. */
export const onDeleteActions = ['restrict', 'cascade', 'set_null'] as const

export type OnDelete = (typeof onDeleteActions)[number]

/** The action as a statement writes it. */
export const onDeleteAction = (action: OnDelete): string =>
  ({ restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' })[action]
