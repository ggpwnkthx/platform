/**
 * The certificate of the deployment, as the runtime sees it.
 *
 * The manager reads the certificate of the shared state, it asks the
 * authority for one when the deployment has none, and it gives the
 * certificate to the listener when it changes. The certificate of a
 * deployment is renewed before it expires: a renewal that is late is an
 * outage of every caller of the deployment.
 */

import { readFile } from 'node:fs/promises'
import type { CertificateStore, DeploymentCertificate } from '../domains/tls'
import { certificateOfFile, type AcmeCertificates } from '../domains/tls'
import type { Logger } from '../observability'
import { isConnectionError } from '../platform/redis'

export interface CertificateManagerOptions {
  /** The store of the certificate of the deployment. */
  store: CertificateStore
  /**
   * The authority of the certificates of the deployment.
   *
   * It is absent when the deployment does not obtain its certificate: the
   * ingress of the deployment terminates the TLS, and the manager reads the
   * certificate of the deployment when there is one.
   */
  acme?: AcmeCertificates
  /** The number of milliseconds between two reads of the certificate. */
  refreshMs?: number
  /**
   * The files of the certificate of the deployment.
   *
   * A deployment that manages its certificate outside the gateway gives
   * the gateway the files of the certificate, and the gateway reads them
   * again when they change. When the files are there, the gateway does not
   * ask an authority of certificates for one.
   */
  certificateFile?: { certPath: string; keyPath: string }
  /** The names the certificate of the files covers. */
  names?: string[]
  /** Called when the certificate of the deployment changes. */
  onCertificate: (certificate: DeploymentCertificate) => void
  /** The logger of the runtime. */
  logger: Logger
}

/** Reads the certificate of the deployment and keeps it fresh. */
export class CertificateManager {
  readonly #options: CertificateManagerOptions
  #current: DeploymentCertificate | null = null
  #stopped = false
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: CertificateManagerOptions) {
    this.#options = options
  }

  /** The certificate the deployment serves, when it has one. */
  get current(): DeploymentCertificate | null {
    return this.#current
  }

  /** Reads the certificate of the deployment and starts to keep it fresh. */
  async start(): Promise<void> {
    await this.refresh()
    if (this.#stopped) return
    this.#timer = setTimeout(() => {
      void this.tick()
    }, this.#options.refreshMs ?? 60_000)
    this.#timer.unref?.()
  }

  /** Stops reading the certificate of the deployment. */
  stop(): void {
    this.#stopped = true
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  /** Reads the certificate of the deployment and schedules the next read. */
  async tick(): Promise<void> {
    await this.refresh()
    if (this.#stopped) return
    this.#timer = setTimeout(() => {
      void this.tick()
    }, this.#options.refreshMs ?? 60_000)
    this.#timer.unref?.()
  }

  /** Reads the certificate of the files of the deployment. */
  async #readFile(): Promise<DeploymentCertificate | null> {
    const files = this.#options.certificateFile
    if (!files) return null
    const [cert, key] = await Promise.all([
      readFile(files.certPath, 'utf8'),
      readFile(files.keyPath, 'utf8'),
    ])
    return certificateOfFile(cert, key, this.#options.names ?? [])
  }

  /**
   * Reads the certificate of the deployment.
   *
   * When the deployment has an authority of certificates, the authority is
   * asked for a certificate when the deployment has none or when the one it
   * has is about to expire. The certificate of the shared state is the
   * certificate of the deployment: the replicas share it.
   */
  async refresh(): Promise<void> {
    let certificate: DeploymentCertificate | null = null
    try {
      certificate = this.#options.certificateFile
        ? await this.#readFile()
        : this.#options.acme
          ? await this.#options.acme.ensure()
          : await this.#options.store.read()
    } catch (error) {
      // The certificate of the deployment lives in the shared state,
      // and a shared state that cannot be reached takes the
      // certificate with it: the log names the shared state and not
      // only a certificate that could not be read. An operator that
      // reads "the certificate could not be read" looks for a
      // certificate that is wrong, and the certificate is not wrong:
      // the state that holds it is not there.
      if (isConnectionError(error)) {
        this.#options.logger.warn(
          'the shared state is not reachable, and the certificate of the deployment lives in it',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        )
        return
      }
      this.#options.logger.warn('the certificate of the deployment could not be read', {
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (certificate === null) return
    if (this.#current !== null && this.#current.expiresAt === certificate.expiresAt) return
    this.#current = certificate
    this.#options.logger.info('the certificate of the deployment is active', {
      names: certificate.names,
      expiresAt: new Date(certificate.expiresAt).toISOString(),
    })
    this.#options.onCertificate(certificate)
  }
}
