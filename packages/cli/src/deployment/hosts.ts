/**
 * The deployment's names on this machine.
 *
 * A name has to answer in three places: in the browser, which opens the issuer and the
 * relay; in the PostgreSQL container, which fetches the issuer's keys; and in the operator's
 * own tools, which connect to the database. The containers are given the names directly, by
 * the Compose file; this machine is given them in its hosts file, so that `idp.<domain>` and
 * its neighbours mean the stack that runs here.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { platform } from 'node:os'
import { join } from 'node:path'
import type { DeployRuntime } from './runtime.ts'

/** Where this machine keeps the names of its hosts. */
function hostsFile(): string {
  if (platform() === 'win32')
    return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  return '/etc/hosts'
}

/** Where a name answers, if it answers at all. */
async function answersOn(name: string): Promise<string | null> {
  try {
    return (await lookup(name)).address
  } catch {
    return null
  }
}

/**
 * Makes the deployment's names answer on this machine, and says what it did.
 *
 * A name under `.localhost` is answered by the resolver itself and needs nothing here. A
 * name under `.local` is answered by multicast DNS, which may be another machine on the
 * network: that is said plainly, because it is a surprise otherwise. Anything else goes in
 * the hosts file, which is a system file: the operator is asked before it is touched, and
 * when they cannot be asked, the line to add is printed.
 */
export async function ensureHosts(names: string[], r: DeployRuntime): Promise<void> {
  const file = hostsFile()
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const wanted: string[] = []
  for (const name of names) {
    const address = await answersOn(name)
    if (address === '127.0.0.1' || address === '::1') continue
    if (address) {
      // Something else answers for it: on a network with multicast DNS, that is often
      // another machine, and a wildcard resolver may answer with anything at all. The
      // hosts file is read first, so the name is put there all the same.
      r.note(`Names: ${name} answers at ${address}, not on this machine.`)
    }
    if (new RegExp(`\\b${name.replace(/\./g, '\\.')}\\b`).test(text)) continue
    wanted.push(name)
  }
  if (!wanted.length) return
  const line = `127.0.0.1 ${wanted.join(' ')}`
  if (!r.interactive) {
    // Nobody is there to ask: the line is printed, and the file is left alone.
    r.note(
      `Names: ${wanted.join(', ')} do not answer on this machine, or answer elsewhere. Add this line to ${file}:\n  ${line}`
    )
    return
  }
  if (!(await r.confirm('hosts', `Add "${line}" to ${file}?`))) {
    r.note(
      `Names: add this line to ${file} yourself, or the stack cannot be reached:\n  ${line}`,
      'warn'
    )
    return
  }
  try {
    appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`)
    r.note(`Names: added "${line}" to ${file}.`, 'success')
  } catch {
    r.note(
      `Names: ${wanted.join(', ')} do not answer on this machine, or answer elsewhere. Add this line to ${file}:\n  ${line}`,
      'warn'
    )
  }
}
