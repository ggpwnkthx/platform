import { MIGRATIONS } from '../migrations.ts'
import { type Applied, manifestOf } from '../folder.ts'

/**
 * A short name for a set of texts: the same texts give the same name, and a change to any of
 * them gives another. It tells one installation from the next, and keeps nothing secret.
 */
export function fingerprintOf(texts: string[]): string {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (const text of texts) {
    // The length goes in first, so that where one text ends and the next begins is said.
    for (const code of [text.length, ...Array.from(text, (c) => c.charCodeAt(0))]) {
      high = Math.imul(high ^ code, 2654435761)
      low = Math.imul(low ^ code, 1597334677)
    }
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909)
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36)
}

/**
 * How an installation is made, as far as a database that is kept can tell: all at once. One
 * kept from a build that installed the platform and then the folder's files may hold the first
 * without the second, and is not looked for again.
 */
const making = 'all at once'

/**
 * What an installation is made from, as a name: the platform's scripts and the folder's
 * files, and how they are installed. A database kept from an earlier build is known to be of
 * another making by it.
 */
export function fingerprintFor(applied: Applied): string {
  return fingerprintOf([
    making,
    ...MIGRATIONS.map((script) => script.sql),
    JSON.stringify(manifestOf(applied)),
    applied.migration ?? '',
    applied.demo ?? '',
  ])
}
