import type { Field, FieldType } from './types.ts'

const types: FieldType[] = []
/** Adds a field type; one that takes the name of a type already held replaces it. */
export function registerFieldType(type: FieldType) {
  const held = types.findIndex((one) => one.name === type.name)
  if (held >= 0) types.splice(held, 1)
  types.push(type)
}
export const fieldTypeNamed = (name: string) => types.find((type) => type.name === name)
export const fieldTypeFor = (field: Omit<Field, 'type'>) =>
  types.reduce((best, type) => (type.claims(field) >= best.claims(field) ? type : best))
