import { PARAMETER_STATUS, roleInSetting } from './startup.ts'
import type { Session } from './types.ts'

/**
 * Reads what PostgreSQL says about the session: the role it has signed the session in as.
 * Only the settings are read; the rows and the results are carried as they are. It
 * answers whether the session was refused, in which case the bytes are not carried.
 */
export function readRole(
  session: Session,
  chunk: Buffer,
  onRole: (role: string) => boolean
): boolean {
  let refused = false
  let at = 0
  while (at < chunk.length) {
    const scan = session.scan
    if (scan.skip > 0) {
      const take = Math.min(scan.skip, chunk.length - at)
      scan.skip -= take
      at += take
      continue
    }
    if (scan.want > 0) {
      const take = Math.min(scan.want, chunk.length - at)
      scan.body = Buffer.concat([scan.body, chunk.subarray(at, at + take)])
      scan.want -= take
      at += take
      if (scan.want === 0) {
        const role = roleInSetting(scan.body)
        scan.body = Buffer.alloc(0)
        if (role && onRole(role)) refused = true
      }
      continue
    }
    const take = Math.min(5 - scan.head.length, chunk.length - at)
    scan.head = Buffer.concat([scan.head, chunk.subarray(at, at + take)])
    at += take
    if (scan.head.length < 5) continue
    const type = scan.head[0]
    const body = scan.head.readInt32BE(1) - 4
    scan.head = Buffer.alloc(0)
    if (type === PARAMETER_STATUS && body > 0 && body <= 1024) {
      scan.want = body
      scan.body = Buffer.alloc(0)
    } else {
      scan.skip = Math.max(0, body)
    }
  }
  return refused
}
