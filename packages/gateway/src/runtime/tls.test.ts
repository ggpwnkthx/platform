import { describe, expect, test } from 'bun:test'
import type { CertificateStore, DeploymentCertificate } from '../domains/tls'
import type { Logger } from '../observability'
import { CertificateManager } from './tls'

/**
 * The certificate of the deployment, as the runtime reads it.
 *
 * The certificate of the deployment lives in the shared state, and a
 * shared state that cannot be reached takes the certificate with it:
 * the log of the runtime says which of the two it is.
 */

/** The warnings the runtime wrote. */
function warningsOf(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = []
  const logger: Logger = {
    level: 'info',
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string, fields?: Record<string, unknown>) => {
      warnings.push(`${message} ${JSON.stringify(fields ?? {})}`)
    },
    error: () => undefined,
  }
  return { logger, warnings }
}

/** A store of the certificate that cannot be reached. */
function unreachableStore(error: Error): CertificateStore {
  return {
    read: async (): Promise<DeploymentCertificate | null> => {
      throw error
    },
    write: async (): Promise<void> => undefined,
    claimLease: async (): Promise<boolean> => false,
    releaseLease: async (): Promise<void> => undefined,
    putChallenge: async (): Promise<void> => undefined,
    challenge: async (): Promise<string | null> => null,
    removeChallenge: async (): Promise<void> => undefined,
  }
}

describe('the certificate of the deployment', () => {
  test('a shared state that cannot be reached is named in the log', async () => {
    const { logger, warnings } = warningsOf()
    const manager = new CertificateManager({
      store: unreachableStore(new Error('The client is offline')),
      onCertificate: () => undefined,
      logger,
    })
    await manager.refresh()
    // The certificate of the deployment is not wrong: the state that
    // holds it is not there.
    expect(warnings.join('\n')).toContain(
      'the shared state is not reachable, and the certificate of the deployment lives in it'
    )
    expect(warnings.join('\n')).toContain('The client is offline')
  })

  test('a failure that is not a connection is named in the log', async () => {
    const { logger, warnings } = warningsOf()
    const manager = new CertificateManager({
      store: unreachableStore(new Error('the value is not a certificate')),
      onCertificate: () => undefined,
      logger,
    })
    await manager.refresh()
    expect(warnings.join('\n')).toContain('the certificate of the deployment could not be read')
  })
})
