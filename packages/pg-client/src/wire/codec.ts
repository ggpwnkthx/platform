/**
 * The values that go on the wire, and the values that come back.
 *
 * The messages themselves are the protocol's own: `pg-protocol` writes them and reads them,
 * so that this package holds no framing of its own. What is here is what the protocol
 * carries in the way the platform wants it: a value in text form, and a value read as the
 * type it is.
 */
import { parse as parseArrayLiteral } from 'postgres-array'

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()
export const kvsep = '\x01'

/** A value bound to a parameter, in text form; null is SQL NULL. */
export function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return arrayLiteral(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A one-dimensional PostgreSQL array literal, every element quoted. */
function arrayLiteral(values: unknown[]): string {
  const items = values.map((value) => {
    const text = serialize(value)
    if (text === null) return 'NULL'
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  })
  return `{${items.join(',')}}`
}

/** Parses a one-dimensional array in text form into strings and nulls. */
export function parseArray(text: string): (string | null)[] {
  if (text.length < 2 || text[0] !== '{') return [text]
  try {
    return parseArrayLiteral(text) as (string | null)[]
  } catch {
    return [text]
  }
}

const arrayElement: Record<number, number> = {
  1000: 16, // bool[]
  1005: 21, // int2[]
  1007: 23, // int4[]
  1016: 20, // int8[]
  1021: 700, // float4[]
  1022: 701, // float8[]
  1028: 26, // oid[]
  1003: 19, // name[]
  1009: 25, // text[]
  1015: 1043, // varchar[]
  1231: 1700, // numeric[]
  2951: 2950, // uuid[]
}

/**
 * A value in text form, read as the type it is. Integers that fit a JavaScript number become
 * numbers; numeric, dates and times stay as PostgreSQL wrote them, so nothing is rounded or
 * moved to another time zone on the way to the screen.
 */
export function parseValue(type: number, text: string): unknown {
  switch (type) {
    case 16:
      return text === 't'
    case 21:
    case 23:
    case 26:
      return Number(text)
    case 20: {
      const value = Number(text)
      return Number.isSafeInteger(value) ? value : text
    }
    case 700:
    case 701:
      return Number(text)
    case 114:
    case 3802:
      return JSON.parse(text)
  }
  const element = arrayElement[type]
  if (element !== undefined)
    return parseArray(text).map((item) => (item === null ? null : parseValue(element, item)))
  return text
}
