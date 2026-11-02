/**
 * The moment a certificate stops being valid.
 *
 * The chain is read with the reader of the authority of the certificates:
 * the leaf of the chain is the certificate of the deployment, and its
 * `notAfter` is the moment the deployment has to renew it. A chain that
 * cannot be read has no known expiry, and the deployment treats it as one
 * that expires now.
 */

import { crypto } from 'acme-client'

/** The moment a certificate stops being valid, in milliseconds. */
export function expiryOf(certificatePem: string, now: number = Date.now()): number {
  try {
    const info = crypto.readCertificateInfo(certificatePem)
    return info.notAfter.getTime()
  } catch {
    return now
  }
}
