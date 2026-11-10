/**
 * The keys of the terminal.
 *
 * The terminal speaks bytes and not keys: a key is a sequence of bytes
 * that the terminal sends when the reader presses something. The
 * interface reads the bytes and turns them into the keys it acts on.
 *
 * A key that is still on its way is not a key: the bytes of a key that
 * has not arrived yet are held until the rest of them arrives, and a
 * lone escape is the escape of the reader and not the beginning of a
 * sequence.
 */

/** A key of the terminal. */
export type Key =
  /** A character the reader typed. */
  | { readonly kind: 'char'; readonly char: string }
  /** The reader pressed the enter key. */
  | { readonly kind: 'enter' }
  /** The reader pressed the escape key. */
  | { readonly kind: 'escape' }
  /** The reader pressed the tab key. */
  | { readonly kind: 'tab' }
  /** The reader pressed the shift and the tab keys together. */
  | { readonly kind: 'backtab' }
  /** The reader erased a character. */
  | { readonly kind: 'backspace' }
  /** The reader erased the character after the cursor. */
  | { readonly kind: 'delete' }
  /** The reader moved the cursor up. */
  | { readonly kind: 'up' }
  /** The reader moved the cursor down. */
  | { readonly kind: 'down' }
  /** The reader moved the cursor left. */
  | { readonly kind: 'left' }
  /** The reader moved the cursor right. */
  | { readonly kind: 'right' }
  /** The reader moved the cursor to the beginning of the line. */
  | { readonly kind: 'home' }
  /** The reader moved the cursor to the end of the line. */
  | { readonly kind: 'end' }
  /** The reader turned the page up. */
  | { readonly kind: 'pageup' }
  /** The reader turned the page down. */
  | { readonly kind: 'pagedown' }
  /** The reader held the control key and pressed another one. */
  | { readonly kind: 'ctrl'; readonly char: string }
  /** The terminal changed its size. */
  | { readonly kind: 'resize' }

/** A key and the number of bytes it took. */
export interface Decoded {
  /** The key the bytes are. */
  readonly key: Key
  /** The number of bytes the key took. */
  readonly length: number
}

/** The byte of the escape key. */
const ESCAPE = 0x1b

/** The byte of the enter key. */
const ENTER = 0x0d

/** The byte of the tab key. */
const TAB = 0x09

/** The byte of the backspace key. */
const BACKSPACE = 0x7f

/**
 * The number of bytes of the character that starts with a byte.
 *
 * @param byte the first byte of a character.
 */
function lengthOf(byte: number): number {
  if (byte < 0x80) return 1
  if (byte < 0xc0) return 1
  if (byte < 0xe0) return 2
  if (byte < 0xf0) return 3
  if (byte < 0xf8) return 4
  return 1
}

/**
 * The key of a sequence of bytes that begins with the escape key.
 *
 * The sequences the terminal sends are the ones the interface acts on:
 * the arrows, the page keys, the home and the end, and the tab of the
 * shift key. A sequence the interface does not know is no key, and the
 * reader is left where they were.
 *
 * @param bytes the bytes of the sequence.
 */
function sequenceOf(bytes: Uint8Array): Key {
  const last = bytes[bytes.length - 1] ?? 0
  switch (last) {
    case 0x41:
      return { kind: 'up' }
    case 0x42:
      return { kind: 'down' }
    case 0x43:
      return { kind: 'right' }
    case 0x44:
      return { kind: 'left' }
    case 0x48:
      return { kind: 'home' }
    case 0x46:
      return { kind: 'end' }
    case 0x5a:
      return { kind: 'backtab' }
    case 0x7e: {
      const number = Number.parseInt(new TextDecoder().decode(bytes.subarray(2, -1)), 10)
      switch (number) {
        case 1:
          return { kind: 'home' }
        case 2:
          return { kind: 'delete' }
        case 3:
          return { kind: 'delete' }
        case 4:
          return { kind: 'end' }
        case 5:
          return { kind: 'pageup' }
        case 6:
          return { kind: 'pagedown' }
        default:
          return { kind: 'char', char: '' }
      }
    }
    default:
      return { kind: 'char', char: '' }
  }
}

/**
 * Reads the key the bytes are.
 *
 * The bytes that are not a key yet are no key: the reader reads them
 * again when the rest of them arrives.
 *
 * @param buffer the bytes the terminal sent.
 */
export function decode(buffer: Uint8Array): Decoded | undefined {
  if (buffer.length === 0) return undefined
  const first = buffer[0]!

  if (first === ESCAPE) {
    // The escape key on its own is the escape of the reader, and the
    // beginning of a sequence is not: the bytes that follow tell the
    // two apart.
    if (buffer.length === 1) return { key: { kind: 'escape' }, length: 1 }
    const second = buffer[1]!
    if (second !== 0x5b && second !== 0x4f) return { key: { kind: 'escape' }, length: 1 }
    for (let index = 2; index < buffer.length; index += 1) {
      const byte = buffer[index]!
      // The last byte of a sequence is the one that is not a number
      // and not a semicolon.
      if (byte >= 0x40 && byte <= 0x7e) {
        return { key: sequenceOf(buffer.subarray(0, index + 1)), length: index + 1 }
      }
    }
    // The sequence is not complete yet.
    return undefined
  }

  if (first === ENTER || first === 0x0a) return { key: { kind: 'enter' }, length: 1 }
  if (first === TAB) return { key: { kind: 'tab' }, length: 1 }
  if (first === BACKSPACE || first === 0x08) return { key: { kind: 'backspace' }, length: 1 }
  if (first < 0x20) {
    return { key: { kind: 'ctrl', char: String.fromCharCode(first + 96) }, length: 1 }
  }

  const length = lengthOf(first)
  if (buffer.length < length) return undefined
  const char = new TextDecoder().decode(buffer.subarray(0, length))
  return { key: { kind: 'char', char }, length }
}
