/**
 * The TLS of the deployment.
 *
 * The domain owns the certificate of the deployment: the certificate the
 * gateway serves, the store it lives in, and the authority it comes from.
 */

export {
  certificateOfFile,
  coversName,
  expiresWithin,
  parseCertificate,
  type DeploymentCertificate,
} from './certificate'

export { AcmeCertificates } from './acme'

export { MemoryCertificateStore, type CertificateStore } from './store'
