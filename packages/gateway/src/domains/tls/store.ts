/**
 * The store of the certificate of the deployment.
 *
 * The certificate is shared: the replicas of a deployment serve the same
 * certificate, and one of them obtains it. The store holds the
 * certificate, the key authorizations of the pending challenges and the
 * lease of the renewal.
 */

import type { DeploymentCertificate } from './certificate'

/** The store of the certificate of the deployment. */
export interface CertificateStore {
  /** The certificate of the deployment, when there is one. */
  read(): Promise<DeploymentCertificate | null>
  /** Writes the certificate of the deployment. */
  write(certificate: DeploymentCertificate): Promise<void>
  /**
   * Takes the lease of the renewal.
   *
   * Only one replica of a deployment obtains the certificate at a time: the
   * authority of the certificates counts the certificates it issues for the
   * same names, and five replicas that order at the same time spend the
   * budget of the week.
   */
  claimLease(ttlMs: number): Promise<boolean>
  /** Gives the lease of the renewal back. */
  releaseLease(): Promise<void>
  /** Publishes the key authorization of a challenge of the authority. */
  putChallenge(token: string, keyAuthorization: string, ttlMs: number): Promise<void>
  /** The key authorization of a challenge, when it is still published. */
  challenge(token: string): Promise<string | null>
  /** Removes the key authorization of a challenge. */
  removeChallenge(token: string): Promise<void>
}

/** The store of the certificate of a process that stands alone. */
export class MemoryCertificateStore implements CertificateStore {
  #certificate: DeploymentCertificate | null = null
  #challenges = new Map<string, { value: string; expiresAt: number }>()
  #leaseUntil = 0

  async read(): Promise<DeploymentCertificate | null> {
    return this.#certificate
  }

  async write(certificate: DeploymentCertificate): Promise<void> {
    this.#certificate = certificate
  }

  async claimLease(ttlMs: number): Promise<boolean> {
    const now = Date.now()
    if (this.#leaseUntil > now) return false
    this.#leaseUntil = now + ttlMs
    return true
  }

  async releaseLease(): Promise<void> {
    this.#leaseUntil = 0
  }

  async putChallenge(token: string, keyAuthorization: string, ttlMs: number): Promise<void> {
    this.#challenges.set(token, { value: keyAuthorization, expiresAt: Date.now() + ttlMs })
  }

  async challenge(token: string): Promise<string | null> {
    const found = this.#challenges.get(token)
    if (!found) return null
    if (found.expiresAt <= Date.now()) {
      this.#challenges.delete(token)
      return null
    }
    return found.value
  }

  async removeChallenge(token: string): Promise<void> {
    this.#challenges.delete(token)
  }
}
