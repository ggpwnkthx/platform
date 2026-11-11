/**
 * The passwords of the local providers (spec §5.4).
 *
 * A password is never stored: the service stores the argon2id verifier
 * of the password, and it checks a password against the verifier. The
 * verifier is salted and it is slow on purpose: a stolen database is
 * expensive to grind.
 *
 * The verification against nothing costs what a real verification costs:
 * a sign-in that names no account takes the same time as a sign-in that
 * names one, and the answer of the two is the same. The accounts of a
 * tenant are not something a caller may guess.
 */

import type { PasswordHasher } from '../../domains/identity'

/** The algorithm of the verifier of a password. */
const ALGORITHM = 'argon2id'

/**
 * The verifier of a password that names no account.
 *
 * It is a verifier of a random string: it is never the verifier of a
 * password, and it costs what a real one costs.
 */
const NOTHING =
  '$argon2id$v=19$m=65536,t=2,p=1$GX4z4MFFfQosW8qHcY3WvtwDvcG0tdHBnRh9RwMRA4U$vav96360Yz4Iqf7zWgxOWjdWdUmP8FodEaB5etJHJRM'

/** The hasher of the passwords, on the argon2id of the runtime. */
export class BunPasswordHasher implements PasswordHasher {
  /** The argon2id verifier of a password. */
  async hash(clear: string): Promise<string> {
    return await Bun.password.hash(clear, { algorithm: ALGORITHM })
  }

  /** Reports whether a password is the one of a verifier. */
  async verify(hash: string, clear: string): Promise<boolean> {
    try {
      return await Bun.password.verify(clear, hash)
    } catch {
      // A verifier that is not one is a password that is not it.
      return false
    }
  }

  /**
   * A verification against nothing.
   *
   * It returns false and it costs what a real verification costs.
   */
  async verifyNothing(clear: string): Promise<boolean> {
    return await this.verify(NOTHING, clear)
  }
}
