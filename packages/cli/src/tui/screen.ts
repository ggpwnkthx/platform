/**
 * The screen of the interface.
 *
 * The interface draws on the terminal of the reader: it takes the
 * screen, it reads the keys, and it gives the screen back the way it
 * found it. The screen is a port, and the tests of the interface answer
 * it with a double: a screen that holds the frames it was given and
 * the keys it was told about.
 */

import { decode, type Key } from './keys'

/** The size of the terminal. */
export interface Size {
  /** The number of the columns of the terminal. */
  readonly columns: number
  /** The number of the rows of the terminal. */
  readonly rows: number
}

/** The screen of the interface. */
export interface Screen {
  /** The size of the terminal. */
  size(): Size
  /** Draws a frame, and the frame fills the screen. */
  write(frame: string): void
  /** Waits for the next key of the reader. */
  read(): Promise<Key>
  /** Gives the terminal back the way the interface found it. */
  close(): void
}

/** The escape that takes the screen of the terminal. */
const ALTERNATE = '\u001b[?1049h'

/** The escape that gives the screen of the terminal back. */
const ALTERNATE_OFF = '\u001b[?1049l'

/** The escape that hides the cursor. */
const HIDE = '\u001b[?25l'

/** The escape that shows the cursor. */
const SHOW = '\u001b[?25h'

/** The escape that clears the screen and puts the cursor in its corner. */
const CLEAR = '\u001b[2J\u001b[H'

/** The escape that puts the cursor in the corner of the screen. */
const HOME = '\u001b[H'

/** The escape that erases the rest of the line the cursor is on. */
const ERASE_LINE = '\u001b[K'

/** The escape that erases what is under the cursor, to the end of the screen. */
const ERASE_BELOW = '\u001b[J'

/** The escapes that hold the drawing of a frame back, and that let it go. */
const HOLD = '\u001b[?2026h'
const RELEASE = '\u001b[?2026l'

/** The number of milliseconds the escape key waits for the rest of a sequence. */
const ESCAPE_WAIT = 30

/**
 * The screen of the terminal of the reader.
 *
 * The terminal is taken in raw mode: the reader's keys arrive one by
 * one, and the terminal does not wait for a line. The screen of the
 * terminal is put aside, and the reader's own shell comes back when
 * the interface closes it.
 */
export function terminalScreen(): Screen {
  const input = process.stdin
  const output = process.stdout
  const keys: Key[] = []
  let waiting: ((key: Key) => void) | undefined
  let pending = new Uint8Array(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const push = (key: Key): void => {
    const resolve = waiting
    waiting = undefined
    if (resolve) {
      resolve(key)
      return
    }
    keys.push(key)
  }

  const drain = (): void => {
    for (;;) {
      const decoded = decode(pending)
      if (!decoded) break
      pending = pending.subarray(decoded.length)
      push(decoded.key)
    }
    // A lone escape is the escape of the reader, and not the beginning
    // of a sequence: the rest of the sequence is given a moment to
    // arrive before the escape is read.
    if (pending.length === 1 && pending[0] === 0x1b) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (pending.length === 1 && pending[0] === 0x1b) {
          pending = new Uint8Array(0)
          push({ kind: 'escape' })
        }
      }, ESCAPE_WAIT)
    }
  }

  const onData = (chunk: Uint8Array): void => {
    const together = new Uint8Array(pending.length + chunk.length)
    together.set(pending)
    together.set(chunk, pending.length)
    pending = together
    drain()
  }

  const onResize = (): void => {
    push({ kind: 'resize' })
  }

  input.setRawMode?.(true)
  input.resume()
  input.on('data', onData)
  output.on('resize', onResize)
  output.write(`${ALTERNATE}${HIDE}${CLEAR}`)

  return {
    size(): Size {
      return {
        columns: Math.max(20, output.columns || 80),
        rows: Math.max(6, output.rows || 24),
      }
    },
    write(frame: string): void {
      if (closed) return
      // The frame is drawn over the one before it, line by line, and
      // the screen is never emptied in between: a screen that is
      // cleared before every frame blinks at every key. What is left
      // of a longer line is erased at the end of the line, and a
      // terminal that knows how holds the frame back until it is whole.
      const lines = frame.split('\n').join(`${ERASE_LINE}\n`)
      output.write(`${HOLD}${HOME}${lines}${ERASE_LINE}${ERASE_BELOW}${RELEASE}`)
    },
    async read(): Promise<Key> {
      const held = keys.shift()
      if (held) return held
      return await new Promise<Key>((resolve) => {
        waiting = resolve
      })
    },
    close(): void {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      input.off('data', onData)
      output.off('resize', onResize)
      input.setRawMode?.(false)
      input.pause()
      output.write(`${SHOW}${ALTERNATE_OFF}`)
    },
  }
}
