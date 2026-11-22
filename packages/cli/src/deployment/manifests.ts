/** Kubernetes: the relay's manifests, and what kubectl does with them. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './runtime.ts'

/** What a manifest is rendered from: the image, the addresses, and the database it reads. */
type ManifestOptions = {
  image: string
  publicUrl: string
  oidcIssuer: string
  databaseHost: string
  databaseName: string
  databasePort: string
  namespace?: string
}

/**
 * The first of the values that is given: the flag the operator wrote, then the setting that
 * was saved, then the default. A value that is empty is a value: it is the operator's, and
 * it is what is asked about.
 */
export function firstGiven(...values: (string | undefined | null)[]): string {
  for (const value of values) if (value !== undefined && value !== null) return value
  return ''
}

/** The image the relay runs: the operator's own, and never one of the placeholders. */
function checkImage(options: ManifestOptions): void {
  if (!options.image || options.image.includes('YOUR_REGISTRY') || /[\s\0]/.test(options.image))
    throw new Error('--image or PLATFORM_IMAGE must specify your built/pushed image')
}

/** The address the site is served from: an HTTPS address, and nothing else. */
function checkSite(options: ManifestOptions): void {
  if (!options.publicUrl) throw new Error('--public-url or PUBLIC_URL is required')
  const url = new URL(options.publicUrl)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Kubernetes PUBLIC_URL must be an HTTPS URL without credentials')
}

/** The issuer the readers sign in through: an address, and nothing else. */
function checkIssuer(options: ManifestOptions): void {
  if (!options.oidcIssuer) throw new Error('--oidc-issuer or OIDC_ISSUER is required')
  const issuer = new URL(options.oidcIssuer)
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search)
    throw new Error('Kubernetes OIDC_ISSUER must be an HTTPS URL without credentials')
}

/** The database the relay reads: a host, a name, and a port. */
function checkDatabase(options: ManifestOptions): void {
  if (!options.databaseHost || options.databaseHost === 'postgres.example.com')
    throw new Error('--database-host or DATABASE_HOST is required')
  // The relay is told where to connect in one argument: a host name, an IPv4 address, or an
  // IPv6 address in brackets, and nothing that could become another argument.
  if (!/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/.test(options.databaseHost))
    throw new Error('--database-host must be a host name or an IP address')
  if (!options.databaseName || options.databaseName.includes('\0'))
    throw new Error('Invalid database name')
  if (
    !/^\d+$/.test(options.databasePort) ||
    Number(options.databasePort) < 1 ||
    Number(options.databasePort) > 65535
  )
    throw new Error('Invalid database port')
}

/**
 * What the manifests need, checked before anything is rendered: an address that cannot be
 * right is refused here, and the deployment is never half-written.
 */
function checkManifest(options: ManifestOptions, namespace: string): void {
  checkImage(options)
  checkSite(options)
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63)
    throw new Error('Invalid namespace')
  checkIssuer(options)
  checkDatabase(options)
}

export function renderKubernetes(options: ManifestOptions): string {
  const namespace = options.namespace ?? 'default'
  checkManifest(options, namespace)
  return readFileSync(join(ROOT, 'deploy/k8s/deployment.yaml'), 'utf8')
    .replaceAll(
      'metadata:\n  name: platform',
      `metadata:\n  namespace: ${JSON.stringify(namespace)}\n  name: platform`
    )
    .replace('YOUR_REGISTRY/platform-relay:2.3.0', JSON.stringify(options.image))
    .replace('"https://platform.example.com"', JSON.stringify(options.publicUrl))
    .replace(
      '"db.YOUR_DOMAIN:5432"',
      JSON.stringify(`${options.databaseHost}:${options.databasePort}`)
    )
    .replace(
      '{ name: DATABASE_NAME, value: platform }',
      `{ name: DATABASE_NAME, value: ${JSON.stringify(options.databaseName)} }`
    )
}
