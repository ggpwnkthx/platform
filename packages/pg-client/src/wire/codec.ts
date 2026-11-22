export const encoder = new TextEncoder()
export const decoder = new TextDecoder()
export const kvsep = '\x01'

/** Builds one message: a type byte, then a length that counts itself and the body. */
export class Writer {
  private parts: Uint8Array[] = []
  private size = 0
  private push(bytes: Uint8Array) {
    this.parts.push(bytes)
    this.size += bytes.length
  }
  int32(value: number) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setInt32(0, value)
    this.push(bytes)
    return this
  }
  int16(value: number) {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setInt16(0, value)
    this.push(bytes)
    return this
  }
  /** A NUL-terminated string. A NUL inside it would end it early, so it is refused. */
  cstring(value: string) {
    if (value.includes('\0')) throw new TypeError('A protocol string cannot contain NUL')
    this.push(encoder.encode(value))
    this.push(new Uint8Array(1))
    return this
  }
  bytes(value: Uint8Array) {
    this.push(value)
    return this
  }
  /** The message, framed. With no type it is the startup message, which has none. */
  frame(type?: string): Uint8Array {
    const header = type ? 5 : 4
    const out = new Uint8Array(header + this.size)
    const view = new DataView(out.buffer)
    if (type) out[0] = type.charCodeAt(0)
    view.setInt32(type ? 1 : 0, this.size + 4)
    let at = header
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

/** Reads the body of one message. */
export class Reader {
  private at = 0
  private view: DataView
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  int32() {
    const value = this.view.getInt32(this.at)
    this.at += 4
    return value
  }
  int16() {
    const value = this.view.getInt16(this.at)
    this.at += 2
    return value
  }
  byte() {
    return this.bytes[this.at++] ?? 0
  }
  cstring() {
    const end = this.bytes.indexOf(0, this.at)
    const value = decoder.decode(this.bytes.subarray(this.at, end))
    this.at = end + 1
    return value
  }
  take(length: number) {
    const value = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return value
  }
  get done() {
    return this.at >= this.bytes.length
  }
}

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
  const out: (string | null)[] = []
  let i = 1
  while (i < text.length - 1) {
    if (text[i] === ',') {
      i++
      continue
    }
    if (text[i] === '"') {
      let value = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++
        value += text[i]
        i++
      }
      i++
      out.push(value)
    } else {
      let end = text.indexOf(',', i)
      if (end === -1) end = text.length - 1
      const value = text.slice(i, end)
      out.push(value === 'NULL' ? null : value)
      i = end
    }
  }
  return out
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
