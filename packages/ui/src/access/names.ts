import { everyone } from './model.ts'

/**
 * The names the access pages write: a role as an ACL spells it, and the roles the database
 * keeps for itself.
 */

/** A role as an ACL names it: PUBLIC in capitals, whatever case it was typed in. */
export const named = (text: string): string => {
  const name = text.trim()
  return name.toLowerCase() === 'public' ? everyone : name
}

/** A role the database keeps for itself: it is not offered, and never drawn. */
export const isSystemRole = (name: string): boolean => name.startsWith('pg_')
