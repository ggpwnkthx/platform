import { MIGRATIONS } from '../migrations.ts'
import { type Applied, manifestOf } from '../folder.ts'

/**
 * A short name for a set of texts: the same texts give the same name, and a change to any of
 * them gives another. It tells one installation from the next, and keeps nothing secret.
 *
 * The name is a digest of the texts, and the digest is the browser's own: the page is what
 * asks for it, and the page may not have a server to ask.
 */
export async function fingerprintOf(texts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(texts.map((text) => `${text.length}\0${text}`).join('\0'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
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
export async function fingerprintFor(applied: Applied): Promise<string> {
  return fingerprintOf([
    making,
    ...MIGRATIONS.map((script) => script.sql),
    JSON.stringify(manifestOf(applied)),
    applied.migration ?? '',
    applied.demo ?? '',
  ])
}
