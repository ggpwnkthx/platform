import type { OnDelete } from '@platform/core'

/**
 * The words the constraint editor and the constraint panels share: what a constraint is
 * being drafted as, and the small questions they ask of the catalog.
 */

export type Kind = 'unique' | 'check' | 'foreign'

export interface Draft {
  kind: Kind
  /** The fields the constraint is about. */
  columns: string[]
  /** What a check tests. */
  expression: string
  /** The collection a foreign key points at, as `schema.table`. */
  target: string
  /** What happens to the row that points at a row that goes. */
  onDelete: OnDelete
  /** The name the constraint is given, when it is not the one PostgreSQL would give. */
  name: string
}

export const emptyDraft = (): Draft => ({
  kind: 'unique',
  columns: [],
  expression: '',
  target: '',
  onDelete: 'restrict',
  name: '',
})

/** Two keys over the same fields, in any order. */
export const sameColumns = (one: string[], other: string[]) =>
  one.length === other.length && [...one].sort().join() === [...other].sort().join()

/** The fields every collection is made with: their emptiness is the platform's own. */
export const systemish = (name: string) =>
  ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version'].includes(name)

/** The delete rule PostgreSQL keeps, said the way the editor offers it. */
export const ruleOf = (code: string): OnDelete =>
  code === 'c' ? 'cascade' : code === 'n' ? 'set_null' : 'restrict'

/** A change that is made to a constraint: what it says, and the SQL it runs. */
export interface Change {
  title: string
  statements: string[]
  danger?: boolean
}
