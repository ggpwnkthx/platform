/**
 * The store of the certificate, in the shared state of the deployment.
 *
 * The state is a Redis server: the certificate, the challenges and the
 * lease of the renewal are three keys of the server, and the prefix of the
 * keys keeps the environments of one server apart.
 */

import type { DeploymentCertificate } from '../certificate'
import { parseCertificate } from '../certificate'
import type { CertificateStore } from '../store'

/**
 * The part of a Redis client the store needs.
 *
 * The domain does not know the client of the runtime: it knows the
 * commands it sends, and the platform builds a client that speaks them.
 */
export interface RedisCommandPort {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>
  del(key: string): Promise<number>
  pexpire(key: string, ms: number): Promise<number>
}

export interface RedisCertificateStoreOptions {
  /** The client of the server. */
  client: RedisCommandPort
  /** Prefix of every key, so several environments can share one server. */
  keyPrefix?: string
}

export class RedisCertificateStore implements CertificateStore {
  readonly #client: RedisCommandPort
  readonly #prefix: string

  constructor(options: RedisCertificateStoreOptions) {
    this.#client = options.client
    this.#prefix = options.keyPrefix ?? 'platform:gateway:'
  }

  #key(name: string): string {
    return `${this.#prefix}${name}`
  }

  async read(): Promise<DeploymentCertificate | null> {
    const value = await this.#client.get(this.#key('tls:certificate'))
    return parseCertificate(value)
  }

  async write(certificate: DeploymentCertificate): Promise<void> {
    await this.#client.set(this.#key('tls:certificate'), JSON.stringify(certificate))
  }

  async claimLease(ttlMs: number): Promise<boolean> {
    const answer = await this.#client.set(
      this.#key('tls:lease'),
      String(Date.now()),
      'NX',
      'PX',
      ttlMs
    )
    // The server answers "OK" when the key was written, and nothing when
    // the key was already there.
    return answer === 'OK' || answer === true
  }

  async releaseLease(): Promise<void> {
    await this.#client.del(this.#key('tls:lease'))
  }

  async putChallenge(token: string, keyAuthorization: string, ttlMs: number): Promise<void> {
    const key = this.#key(`tls:challenge:${token}`)
    await this.#client.set(key, keyAuthorization)
    await this.#client.pexpire(key, ttlMs)
  }

  async challenge(token: string): Promise<string | null> {
    return await this.#client.get(this.#key(`tls:challenge:${token}`))
  }

  async removeChallenge(token: string): Promise<void> {
    await this.#client.del(this.#key(`tls:challenge:${token}`))
  }
}
