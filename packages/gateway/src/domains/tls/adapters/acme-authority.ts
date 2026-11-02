/**
 * The client of the authority of the certificates.
 *
 * The client speaks the protocol of the authority (RFC 8555): it creates
 * the account of the deployment, it orders a certificate of the names, it
 * answers the challenges of the authority and it downloads the
 * certificate.
 */

import { Client, crypto } from 'acme-client'
import type { Authorization } from 'acme-client'
import type { Challenge } from 'acme-client/types/rfc8555'
import type { AuthorityChallenge, CertificateAuthority } from '../authority'

export interface AcmeAuthorityOptions {
  /** The directory of the authority. */
  directoryUrl: string
  /** The key of the account of the deployment, in PEM. */
  accountKey: string
  /** The contact of the account. */
  email?: string
  /** Reports what the client does. */
  log?: (message: string, details?: Record<string, unknown>) => void
}

export class AcmeAuthority implements CertificateAuthority {
  readonly #options: AcmeAuthorityOptions

  constructor(options: AcmeAuthorityOptions) {
    this.#options = options
  }

  async order(options: {
    names: string[]
    challenge: 'http-01' | 'dns-01'
    publish: (challenge: AuthorityChallenge) => Promise<void>
    withdraw: (challenge: AuthorityChallenge) => Promise<void>
  }): Promise<{ cert: string; key: string } | null> {
    const client = new Client({
      directoryUrl: this.#options.directoryUrl,
      accountKey: this.#options.accountKey,
    })
    const [key, csr] = await crypto.createCsr({
      commonName: options.names[0]!,
      altNames: options.names.slice(1),
    })
    const priority = options.challenge === 'http-01' ? ['http-01'] : ['dns-01']
    const cert = await client.auto({
      csr,
      email: this.#options.email,
      termsOfServiceAgreed: true,
      challengePriority: priority,
      challengeCreateFn: async (
        authorization: Authorization,
        challenge: Challenge,
        keyAuthorization: string
      ): Promise<void> => {
        await options.publish({
          name: authorization.identifier.value,
          token: challenge.token,
          keyAuthorization,
        })
      },
      challengeRemoveFn: async (
        authorization: Authorization,
        challenge: Challenge
      ): Promise<void> => {
        await options.withdraw({
          name: authorization.identifier.value,
          token: challenge.token,
          keyAuthorization: '',
        })
      },
    })
    return { cert, key: key.toString() }
  }
}
