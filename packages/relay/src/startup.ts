/**
 * The startup packet: the first thing a client sends, and the only thing the relay reads.
 * A session that does not begin with one is refused: an SSL request, a cancel request, or
 * anything else to PostgreSQL's port.
 */

/** The most a startup packet may hold: PostgreSQL's own limit. */
export const MAX_STARTUP = 10000

export interface Startup {
  length: number
  /** The role the client asks to be logged in as. PostgreSQL is the judge of who it is. */
  user: string
}

/**
 * The first packet of a session. `null` says it is not all here yet; `false` says it is not a
 * startup packet at all.
 */
export const startupPacket = (bytes: Buffer): Startup | null | false => {
  if (bytes.length < 8) return null
  const length = bytes.readInt32BE(0)
  if (length < 8 || length > MAX_STARTUP) return false
  if (bytes.length < length) return null
  if (bytes.readInt32BE(4) >>> 16 !== 3) return false
  return { length, user: startupUser(bytes.subarray(8, length)) }
}

/** The `user` of a startup packet: the role the client asks to be logged in as. */
const startupUser = (params: Buffer) => {
  const said = params.toString('latin1').split('\0')
  for (let at = 0; at + 1 < said.length; at += 2) {
    if (!said[at]) break
    if (said[at] === 'user') return said[at + 1] ?? ''
  }
  return ''
}
