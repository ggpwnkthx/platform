import { expiryOf } from './expiry'

/**
 * The certificate of the deployment.
 *
 * The gateway terminates the TLS of the callers when it has a certificate,
 * and the certificate is a secret: the private key of the deployment is in
 * it. The certificate is kept in the shared state, so the replicas of the
 * deployment serve the same certificate and the deployment holds one.
 */

/** A certificate of the deployment. */
export interface DeploymentCertificate {
  /** The private key, in PEM. */
  key: string
  /** The certificate and its chain, in PEM. */
  cert: string
  /** The names the certificate covers. */
  names: string[]
  /** The moment the certificate stops being valid, in milliseconds. */
  expiresAt: number
}

/**
 * Reads a certificate out of a value of the shared state.
 *
 * A value that is not a certificate is no certificate: a certificate that
 * cannot be read is a certificate that is not served, and a deployment that
 * cannot serve TLS says so in its log.
 */
export function parseCertificate(value: string | null | undefined): DeploymentCertificate | null {
  if (value === null || value === undefined || value.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Partial<DeploymentCertificate>
  if (typeof candidate.key !== 'string' || candidate.key === '') return null
  if (typeof candidate.cert !== 'string' || candidate.cert === '') return null
  if (!Array.isArray(candidate.names)) return null
  if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return null
  return {
    key: candidate.key,
    cert: candidate.cert,
    names: candidate.names.filter((name): name is string => typeof name === 'string'),
    expiresAt: candidate.expiresAt,
  }
}

/** Reports whether a certificate stops being valid within a number of days. */
export function expiresWithin(
  certificate: DeploymentCertificate,
  days: number,
  now: number = Date.now()
): boolean {
  return certificate.expiresAt - now <= days * 24 * 60 * 60 * 1000
}

/** The names of a certificate, without the port and without the case. */
export function namesOf(certificate: DeploymentCertificate): string[] {
  return certificate.names.map((name) => name.trim().toLowerCase())
}

/** Reports whether a certificate covers a name. */
export function coversName(certificate: DeploymentCertificate, name: string): boolean {
  const wanted = name.trim().toLowerCase()
  return namesOf(certificate).some((covered) => covered === wanted)
}

/**
 * Reads a certificate of a file.
 *
 * A deployment that manages its certificate outside the gateway — a
 * certificate of a secret, a certificate of a renewal outside — hands the
 * gateway a file, and the gateway reads it again when it changes.
 */
export function certificateOfFile(
  certPem: string,
  keyPem: string,
  names: string[]
): DeploymentCertificate {
  return {
    key: keyPem,
    cert: certPem,
    names: [...names],
    expiresAt: expiryOf(certPem),
  }
}
