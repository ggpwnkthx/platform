/**
 * The authority of the certificates of the deployment.
 *
 * The authority is asked for a certificate of the names of the deployment,
 * and it asks the deployment to prove that it owns them. The domain knows
 * the protocol of the exchange; the client of the authority is an adapter.
 */

/** A challenge of the authority of the certificates. */
export interface AuthorityChallenge {
  /** The name the authority proves the ownership of. */
  name: string
  /** The token of the challenge. */
  token: string
  /** The key authorization of the challenge: the answer of the challenge. */
  keyAuthorization: string
}

/** The authority of the certificates of the deployment. */
export interface CertificateAuthority {
  /**
   * Asks the authority for a certificate of the names.
   *
   * The authority asks the deployment to prove that it owns a name, and
   * the deployment publishes the answer of the challenge with `publish` and
   * withdraws it with `withdraw`. It returns the certificate and its key,
   * or nothing when the authority refused.
   */
  order(options: {
    names: string[]
    challenge: 'http-01' | 'dns-01'
    publish: (challenge: AuthorityChallenge) => Promise<void>
    withdraw: (challenge: AuthorityChallenge) => Promise<void>
  }): Promise<{ cert: string; key: string } | null>
}
