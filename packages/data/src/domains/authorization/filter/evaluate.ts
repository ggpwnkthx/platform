/**
 * The evaluator of the filters (spec §9.3).
 *
 * The evaluator reads a filter against a row that is already in memory.
 * It uses the same rules as the compiled form, so a row that is
 * accepted in memory is the row the statement would find.
 */

import type { FieldType } from '../../schema'
import { canonicalJson, isNull } from './compile'
import { resolveSubstitutions } from './parse'
import type { FilterNode, SubstitutionContext } from './types'

/**
 * Evaluates a filter against a row that is already in memory.
 *
 * The evaluation is used by the write rules, where the row is locked and
 * its values are known, and by the representation of a single record.
 * It uses the same rules as the compiled form, so a row that is accepted
 * in memory is the row the statement would find.
 *
 * **The null follows the three valued logic of the database.** A
 * comparison with a null value is unknown and never true: `status <> 'x'`
 * does not match a row whose status is null, exactly as the statement
 * does not match it. Only `_is_null` matches a null value. The two
 * evaluations have to agree: a row that the read hides because the
 * statement does not match it may not be written, and its fields may not
 * be shown, because the rules of the write path would answer otherwise.
 */
export function evaluateFilter(
  node: FilterNode,
  row: Readonly<Record<string, unknown>>,
  context: SubstitutionContext
): boolean {
  return evaluateTruth(node, row, context) === true
}

/**
 * The truth of a predicate: true, false, or unknown.
 *
 * The unknown is the third value of the logic of the database. It is not
 * an answer that a caller may read: the predicate is true only when the
 * database says it is true, and the negation of an unknown is an
 * unknown.
 */
type Truth = boolean | null

/** Evaluates a filter with the three valued logic of the database. */
function evaluateTruth(
  node: FilterNode,
  row: Readonly<Record<string, unknown>>,
  context: SubstitutionContext
): Truth {
  const resolved = resolveSubstitutions(node, context)
  const walk = (current: FilterNode): Truth => {
    if (current.kind === 'all') return true
    if (current.kind === 'not') {
      const inner = walk(current.node)
      if (inner === null) return null
      return !inner
    }
    if (current.kind === 'and') {
      let unknown = false
      for (const entry of current.nodes) {
        const value = walk(entry)
        if (value === false) return false
        if (value === null) unknown = true
      }
      return unknown ? null : true
    }
    if (current.kind === 'or') {
      let unknown = false
      for (const entry of current.nodes) {
        const value = walk(entry)
        if (value === true) return true
        if (value === null) unknown = true
      }
      return unknown ? null : false
    }
    const value = row[current.field]
    const operand = current.value
    if (current.operator === '_is_null') {
      return operand === true ? isNull(value) : !isNull(value)
    }
    // Every other operator compares a value with the null of the column:
    // the answer of the database is unknown and it is never true.
    if (isNull(value)) return null
    switch (current.operator) {
      case '_eq':
        return compareTyped(current.type, value, operand) === 0
      case '_neq':
        return compareTyped(current.type, value, operand) !== 0
      case '_lt':
        return compareTyped(current.type, value, operand) < 0
      case '_lte':
        return compareTyped(current.type, value, operand) <= 0
      case '_gt':
        return compareTyped(current.type, value, operand) > 0
      case '_gte':
        return compareTyped(current.type, value, operand) >= 0
      case '_in':
        return (current.values ?? []).some(
          (entry) => compareTyped(current.type, value, entry) === 0
        )
      case '_nin':
        return !(current.values ?? []).some(
          (entry) => compareTyped(current.type, value, entry) === 0
        )
      default:
        return false
    }
  }
  return walk(resolved)
}

/**
 * Compares two values with the rules of the type of the field.
 *
 * The statement of the database compares with the type of the column:
 * the text with the collation "C", the numbers as numbers, the decimals
 * exactly, the timestamps as instants and the json as a value. The
 * evaluation in memory uses the same rules, and it needs the type of
 * the field to do it.
 *
 * Without the type, one comparison would serve every field, and the
 * comparisons of the two evaluations would disagree: the text "10" is
 * greater than the text "9" for the database and it is smaller for a
 * comparison that reads the two as numbers.
 */
function compareTyped(type: FieldType | undefined, left: unknown, right: unknown): number {
  if (type === undefined) return compareText(String(left), String(right))
  switch (type) {
    case 'integer':
      return compareInteger(left, right)
    case 'decimal':
      return compareDecimals(decimalText(left), decimalText(right))
    case 'timestamp':
      return compareInstants(left, right)
    case 'boolean':
      if (left === right) return 0
      return left === false ? -1 : 1
    case 'json':
      return canonicalJson(left) === canonicalJson(right) ? 0 : 1
    case 'uuid':
      return compareText(String(left).toLowerCase(), String(right).toLowerCase())
    case 'string':
    case 'text':
    case 'enum':
      return compareText(String(left), String(right))
  }
}

/**
 * Compares two texts the way the database compares them.
 *
 * The statement compares the text with the collation "C", which is the
 * comparison of the bytes of the UTF-8. The comparison of the characters
 * of the language is the comparison of the units of the UTF-16, and the
 * two orders differ for the characters that are outside the plane of the
 * basic multilingual one: the code point U+1F600 is after the code
 * point U+FFFD for the bytes and before it for the units.
 */
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/** Compares two integers, exactly. */
function compareInteger(left: unknown, right: unknown): number {
  const a = toBigInt(left)
  const b = toBigInt(right)
  return a < b ? -1 : a > b ? 1 : 0
}

/** The integer of a value, exactly. */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  const text = String(value).trim()
  if (/^-?\d+$/.test(text)) return BigInt(text)
  return BigInt(Math.trunc(Number(text)))
}

/** The text of a decimal. */
function decimalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value)
}

/** Compares two timestamps, as instants. */
function compareInstants(left: unknown, right: unknown): number {
  const a = instantOf(left)
  const b = instantOf(right)
  if (a === null || b === null) return compareText(String(left), String(right))
  return a < b ? -1 : a > b ? 1 : 0
}

/** The instant of a value, in microseconds since the epoch. */
function instantOf(value: unknown): bigint | null {
  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isNaN(time)) return null
    return BigInt(time) * 1000n
  }
  if (typeof value === 'number') return BigInt(Math.trunc(value)) * 1000n
  if (typeof value !== 'string') return null
  return parseInstant(value)
}

/**
 * Parses a timestamp with an explicit offset into microseconds.
 *
 * The fraction of a second of the database is a microsecond, and the
 * parser of the language keeps at most a millisecond. A predicate that
 * compares the fraction of a second would then be compared at the
 * millisecond in the memory and at the microsecond in the statement,
 * and the two answers would not agree.
 */
function parseInstant(value: string): bigint | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:\d{2})$/.exec(
      value.trim()
    )
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction, offset] = match
  const zone = offset ?? 'Z'
  const date = new Date(0)
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0)
  const base = date.getTime()
  if (Number.isNaN(base)) return null
  let micros = 0n
  if (fraction) {
    micros = BigInt(fraction.slice(0, 6).padEnd(6, '0'))
    // The database rounds the fraction to the microsecond.
    if (fraction.length > 6 && fraction[6]! >= '5') micros += 1n
  }
  let offsetMinutes = 0
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '-' ? -1 : 1
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  }
  // The instant is in microseconds: a minute is sixty million of them.
  return BigInt(base) * 1000n + micros - BigInt(offsetMinutes) * 60n * 1_000_000n
}

/** Compares two decimal strings exactly. */
export function compareDecimals(left: string, right: string): number {
  const normalize = (value: string): { sign: number; integer: string; fraction: string } => {
    const negative = value.startsWith('-')
    const body = negative ? value.slice(1) : value
    const [integer = '0', fraction = ''] = body.split('.')
    return {
      sign: negative ? -1 : 1,
      integer: integer.replace(/^0+(?=\d)/, ''),
      fraction,
    }
  }
  const a = normalize(left)
  const b = normalize(right)
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  if (a.integer.length !== b.integer.length) {
    return a.integer.length < b.integer.length ? -1 : 1
  }
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1
  const length = Math.max(a.fraction.length, b.fraction.length)
  const leftFraction = a.fraction.padEnd(length, '0')
  const rightFraction = b.fraction.padEnd(length, '0')
  if (leftFraction === rightFraction) return 0
  return leftFraction < rightFraction ? -1 : 1
}
