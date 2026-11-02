/**
 * The adapters of the domain of the TLS.
 *
 * The adapters are the concrete clients of the world: the server of the
 * shared state and the authority of the certificates.
 */

export { AcmeAuthority } from './acme-authority'

export { RedisCertificateStore } from './redis-certificates'
