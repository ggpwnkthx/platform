/**
 * The randomness of the login.
 *
 * The proof of the caller of a login is a secret, and the secret has to
 * be one the machine did not choose before. The runtime of the platform
 * holds the source of the randomness, and the core of the CLI only asks
 * for it.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { CryptoPort } from '../domains/contracts'

/** The randomness of the machine. */
export const machineCrypto: CryptoPort = {
  /**
   * Bytes of the machine.
   *
   * @param size the number of the bytes.
   */
  randomBytes(size: number): Uint8Array {
    return new Uint8Array(randomBytes(size))
  },
  /**
   * The digest of the bytes.
   *
   * @param value the bytes to digest.
   */
  sha256(value: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha256').update(value).digest())
  },
}
