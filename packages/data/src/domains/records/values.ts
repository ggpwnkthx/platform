/**
 * The values of the fields of the records domain.
 *
 * The module owns the comparison and the normalization of the values of
 * the fields. The two normalizations of the repository have to agree:
 * the validator of a record is computed from one and from the other,
 * and a difference would refuse every write of a record that was read
 * before.
 */

import type { FieldDefinition } from '../schema'

/**
 * Normalizes a value of a row the way the projection of a read does.
 *
 * The value of a timestamp is an UTC timestamp, the value of an integer
 * is a number and the value of a decimal is a string, so the value that
 * is stored and the value that is read are the same.
 */
export function normalizeValue(definition: FieldDefinition, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (definition.type) {
    case 'timestamp':
      if (value instanceof Date) return value.toISOString()
      return value
    case 'integer':
      return typeof value === 'number' ? value : Number(value)
    case 'decimal':
      return typeof value === 'string' ? value : String(value)
    case 'json':
      return value
    default:
      return value
  }
}

/**
 * Reports whether two values of a field are the same.
 *
 * The values of a field are compared after their normalization: the
 * value of a timestamp of the database and the value of the same
 * timestamp of the answer are the same instant, and the value of a
 * json field is compared by its content.
 */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left === 'object' || typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return false
}
