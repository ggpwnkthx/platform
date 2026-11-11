/**
 * The proof of a domain (spec §10.18).
 *
 * The owner of a domain proves that it owns it by publishing a TXT
 * record that carries the challenge of its route, and the platform reads
 * the record to prove it. The name of the record is `_access` of the
 * domain: a name of its own, that no other service of the tenant needs.
 *
 * A name that does not resolve, and a record that does not exist, are
 * the same answer: the domain is not proven. The resolver of the machine
 * of the deployment is the one that answers, and a deployment that
 * resolves nothing proves no domain.
 */

import { resolveTxt } from 'node:dns/promises'

/**
 * The values of the TXT records of a name.
 *
 * The values are the ones the resolver answers, and a name that does not
 * resolve answers none of them.
 *
 * @param name the name of the record.
 */
export async function txtOf(name: string): Promise<readonly string[]> {
  try {
    const records = await resolveTxt(name)
    return records.map((record) => record.join('').trim()).filter((value) => value !== '')
  } catch {
    return []
  }
}
