import type { Column, ColumnType } from './types.ts'

const types: ColumnType[] = []
/** Adds a column type; one that takes the name of a type already held replaces it. */
export function registerColumnType(type: ColumnType) {
  const held = types.findIndex((one) => one.name === type.name)
  if (held >= 0) types.splice(held, 1)
  types.push(type)
}
export const columnTypeNamed = (name: string) => types.find((type) => type.name === name)
export const columnTypeFor = (column: Omit<Column, 'type'>) =>
  types.reduce((best, type) => (type.claims(column) >= best.claims(column) ? type : best))
