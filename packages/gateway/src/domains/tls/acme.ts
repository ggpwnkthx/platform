/**
 * The certificates of the deployment, from an authority of certificates.
 *
 * The gateway asks the authority for a certificate of the names of the
 * deployment and renews it before it expires. The certificate is a secret:
 * it lives in the shared state, and the account of the authority is a
 * secret of the deployment too — the replicas of a deployment share it, so
 * they share the account and the budget of the authority.
 */

import type { AuthorityChallenge, CertificateAuthority } from './authority'
import type { DeploymentCertificate } from './certificate'
import { expiryOf } from './expiry'
import type { CertificateStore } from './store'

/** The challenge of the authority that answers with a record of DNS. */
export interface DnsWriter {
  /** Publishes the value of a challenge. */
  put(name: string, value: string): Promise<void>
  /** Removes the value of a challenge. */
  remove(name: string): Promise<void>
}

export interface AcmeOptions {
  /** The authority of the certificates of the deployment. */
  authority: CertificateAuthority
  /** The store of the certificate and of the challenges. */
  store: CertificateStore
  /** The names the certificate covers. */
  names: string[]
  /**
   * The challenge the deployment answers.
   *
   * `http-01` is answered by the gateway itself, on the plain listener.
   * `dns-01` is answered by the writer of the deployment.
   */
  challenge: 'http-01' | 'dns-01'
  /** The writer of the records of DNS, for the `dns-01` challenge. */
  dns?: DnsWriter
  /** The lifetime of a published challenge, in milliseconds. */
  challengeTtlMs?: number
  /** The number of days before the expiry that the certificate is renewed. */
  renewalDays?: number
  /** Reports what the manager does. */
  log?: (message: string, details?: Record<string, unknown>) => void
}

/** The name of the record of DNS of a challenge of a name. */
export function dnsChallengeName(name: string): string {
  return `_acme-challenge.${name.trim().toLowerCase()}`
}

/**
 * Obtains and renews the certificate of the deployment.
 *
 * The manager is the writer of the certificate: it takes the lease of the
 * renewal, it asks the authority for a certificate and it publishes it. The
 * replicas that do not hold the lease wait for the certificate of the one
 * that does.
 */
export class AcmeCertificates {
  readonly #options: AcmeOptions

  constructor(options: AcmeOptions) {
    this.#options = options
  }

  /** The names the certificate covers. */
  get names(): string[] {
    return [...this.#options.names]
  }

  /**
   * Obtains a certificate, unless the deployment already has one.
   *
   * It returns the certificate of the deployment, whether it obtained it
   * now or read it from the store.
   */
  async ensure(now: number = Date.now()): Promise<DeploymentCertificate | null> {
    const current = await this.#options.store.read()
    if (current !== null && !this.#needsRenewal(current, now)) return current
    const lease = await this.#options.store.claimLease(this.#leaseMs())
    if (!lease) {
      // Another replica of the deployment is ordering a certificate: the
      // certificate it writes is the certificate of the deployment.
      return current
    }
    try {
      const obtained = await this.#order()
      if (obtained !== null) await this.#options.store.write(obtained)
      return obtained ?? current
    } finally {
      await this.#options.store.releaseLease()
    }
  }

  /** Reports whether a certificate has to be renewed. */
  #needsRenewal(certificate: DeploymentCertificate, now: number): boolean {
    const window = (this.#options.renewalDays ?? 30) * 24 * 60 * 60 * 1000
    return certificate.expiresAt - now <= window
  }

  /** The lifetime of the lease of the renewal, in milliseconds. */
  #leaseMs(): number {
    return 10 * 60 * 1000
  }

  /** Asks the authority for a certificate of the names of the deployment. */
  async #order(): Promise<DeploymentCertificate | null> {
    const names = this.#options.names.filter((name) => name.trim() !== '')
    if (names.length === 0) return null
    const log = this.#options.log ?? ((): void => {})
    try {
      const obtained = await this.#options.authority.order({
        names,
        challenge: this.#options.challenge,
        publish: async (challenge: AuthorityChallenge): Promise<void> => {
          await this.#publish(challenge)
        },
        withdraw: async (challenge: AuthorityChallenge): Promise<void> => {
          await this.#withdraw(challenge)
        },
      })
      if (obtained === null) return null
      log('the certificate of the deployment was issued', { names })
      return {
        key: obtained.key,
        cert: obtained.cert,
        names,
        expiresAt: expiryOf(obtained.cert),
      }
    } catch (error) {
      log('the certificate of the deployment could not be issued', {
        names,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /** Publishes the answer of a challenge of the authority. */
  async #publish(challenge: AuthorityChallenge): Promise<void> {
    if (this.#options.challenge === 'dns-01') {
      const writer = this.#options.dns
      if (!writer) {
        throw new Error(
          `the challenge of the name "${challenge.name}" is a challenge of DNS and the deployment has no writer of records of DNS`
        )
      }
      await writer.put(dnsChallengeName(challenge.name), challenge.keyAuthorization)
      return
    }
    await this.#options.store.putChallenge(
      challenge.token,
      challenge.keyAuthorization,
      this.#options.challengeTtlMs ?? 60 * 60 * 1000
    )
  }

  /** Withdraws the answer of a challenge of the authority. */
  async #withdraw(challenge: AuthorityChallenge): Promise<void> {
    if (this.#options.challenge === 'dns-01') {
      await this.#options.dns?.remove(dnsChallengeName(challenge.name))
      return
    }
    await this.#options.store.removeChallenge(challenge.token)
  }
}
