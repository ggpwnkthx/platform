export const PARAMETER_STATUS = 0x53

/** The close code for a session the relay refuses: the policy does not allow it. */
export const REFUSED = 1008

/**
 * How much a session may send before PostgreSQL has signed it in: a startup packet and a
 * token, with room to spare, and nothing like a statement.
 */
export const BEFORE_LOGIN = 64 * 1024

/** The longest startup packet PostgreSQL itself reads. */
const STARTUP_PACKET = 10000

/**
 * What the client's first bytes are: a whole startup packet of protocol 3, the beginning of
 * one, or something else. The packet is its length, the protocol's version and the settings
 * the client asks for; the version's upper half is 3 for a login, and 1234 for the requests
 * that are not one.
 */
export function startupPacketIn(bytes: Buffer): 'whole' | 'partial' | 'refused' {
  if (bytes.length < 8) return 'partial'
  const length = bytes.readInt32BE(0)
  if (length < 8 || length > STARTUP_PACKET) return 'refused'
  if (bytes.readInt32BE(4) >>> 16 !== 3) return 'refused'
  return bytes.length >= length ? 'whole' : 'partial'
}

/** How much the relay holds for a browser that is behind before a session is beyond help. */
export const HELD_FOR_BROWSER = 16 * 1024 * 1024

/** Reads a NUL-terminated string at a place in a buffer. */
function cstring(buffer: Buffer, at: number): { value: string; next: number } | null {
  const end = buffer.indexOf(0, at)
  if (end < 0) return null
  return { value: buffer.toString('utf8', at, end), next: end + 1 }
}

/**
 * The role a setting message reports, when it is the one that names the session's role.
 */
export function roleInSetting(body: Buffer): string | null {
  const key = cstring(body, 0)
  if (key?.value !== 'session_authorization') return null
  const value = cstring(body, key.next)
  return value?.value ?? null
}

/**
 * The key a role is counted under. PostgreSQL's role names are as they are written, but a
 * cap is about a person, and a person does not get a second budget by spelling their name
 * differently.
 */
export function keyOf(role: string): string {
  return role.toLowerCase()
}
