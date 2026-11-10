/**
 * The name servers of a zone of DNS, as the public DNS holds them.
 *
 * The zone of the names of a deployment is delegated at the registrar
 * of the domain, and the delegation names the name servers of the zone
 * that holds the records of the names. The environment of the container
 * apps proves the ownership of a name with a record of DNS, and the
 * record is read in the public DNS: a zone that is delegated to other
 * name servers has no record in the public DNS, and the environment
 * cannot prove the ownership of the name.
 *
 * The resolver of the machine is asked for the name servers of the
 * zone. The answer is the delegation of the zone, and it is the name
 * servers of the zone that is the closest one above it when the zone
 * is delegated to none: a zone that is not delegated is delegated to
 * the zone that holds it.
 */

import { promises } from 'node:dns'

/** The name servers of a zone of DNS. */
export interface Nameservers {
  /**
   * The name servers a zone of DNS is delegated to.
   *
   * @param zone the name of the zone.
   */
  resolve(zone: string): Promise<readonly string[]>
}

/**
 * The name servers of the machine, as the resolver of the machine
 * holds them.
 *
 * The resolver of the machine is the one of the system, and it is the
 * one that answers the way the public DNS answers: a resolver of the
 * machine that is asked for a zone of Azure answers with the name
 * servers of the zone, and the name servers of the zone are the ones
 * the delegation of the zone names.
 */
export const SYSTEM_NAMESERVERS: Nameservers = {
  async resolve(zone: string): Promise<readonly string[]> {
    return await promises.resolveNs(zone)
  },
}

/**
 * The name of a name server, as the DNS writes it.
 *
 * The names of the name servers are the same names in two shapes: the
 * resolver of the machine answers with the name and the stroke that
 * ends it, and the zone of Azure answers with the name alone. The
 * comparison of two sets of names is a comparison of the names and not
 * of their shapes.
 *
 * @param name the name of a name server.
 */
function plainName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * The name servers of a zone, as a set of names.
 *
 * @param names the names of the name servers.
 */
export function serversOf(names: readonly string[]): Set<string> {
  return new Set(names.map(plainName).filter((name) => name !== ''))
}

/**
 * The names of a list, as a sentence of them.
 *
 * The names of the name servers are told as they are, without the
 * stroke that ends them: the operator writes them at the registrar of
 * the domain, and the stroke is not a part of what is written there.
 *
 * @param names the names.
 */
export function listOf(names: readonly string[]): string {
  const list = names.map((name) => name.trim().replace(/\.$/, '')).filter((name) => name !== '')
  if (list.length === 0) return 'no name server'
  if (list.length === 1) return list[0]!
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}
